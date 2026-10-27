"""
Port of `app/utils/extract_utils.py` — LLM risk extraction with backend routing.
"""

from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Any, List, Optional, Tuple

from jsonschema import ValidationError, validate

from app.extraction.chunking import tokenize_and_chunk
from app.extraction.metrics import (
    begin_extraction,
    clear_extraction_metrics,
    get_extraction_metrics,
    record_generated_object,
)
from app.llm.repair import repair_extraction_obj
from app.risk_processing.description_utils import word_count
from app.risk_processing.merge import merge_extractions, synthesize_extractions

logger = logging.getLogger("airisk")

DEFAULT_LOCAL_MODEL_ID = "Qwen/Qwen2.5-3B-Instruct"


def _flag(name: str) -> bool:
    return os.getenv(name, "false").lower() == "true"


def _active_backend() -> str:
    if _flag("USE_BEDROCK"):
        return "bedrock"
    if _flag("USE_SAGEMAKER"):
        return "sagemaker"
    if _flag("USE_OPENAI"):
        return "openai"
    if _flag("USE_CISCO"):
        return "cisco"
    return "local"


def _resolve_generate_json():
    """Pick the backend at call time so Controls / set_model can switch to Bedrock."""
    backend = _active_backend()
    if backend == "bedrock":
        from app.llm.bedrock_llm import generate_json

        return generate_json, "bedrock"
    if backend == "sagemaker":
        from app.llm.sagemaker_llm import generate_json

        return generate_json, "sagemaker"
    if backend == "openai":
        from app.llm.openai_llm import generate_json

        return generate_json, "openai"
    if backend == "cisco":
        from app.llm.cisco_llm import generate_json

        return generate_json, "cisco"

    from app.llm.local_llm import generate_json

    return generate_json, "local"

_SCHEMA_PATH = (
    Path(__file__).resolve().parent.parent / "schemas" / "risk_extraction.schema.json"
)


def load_risk_schema() -> dict[str, Any]:
    with _SCHEMA_PATH.open(encoding="utf-8") as f:
        return json.load(f)


def get_current_model_name() -> str:
    backend = _active_backend()
    if backend == "bedrock":
        from app.llm.model_config import _bedrock_model_id

        raw = (
            os.getenv("BEDROCK_MODEL", "").strip()
            or os.getenv("BEDROCK_MODEL_ID", "").strip()
            or "claude-haiku-4-5"
        )
        return _bedrock_model_id(raw)
    if backend == "sagemaker":
        return os.getenv("SAGEMAKER_MODEL_NAME", "foundation-sec-8b")
    if backend == "openai":
        return os.getenv("OPENAI_MODEL", "gpt-5-mini")
    if backend == "cisco":
        return os.getenv("CISCO_MODEL_NAME", "foundation-sec-8b")
    return os.getenv("LOCAL_MODEL_ID", DEFAULT_LOCAL_MODEL_ID)


def reported_model(obj: dict, fallback: str = "") -> str:
    """Model that actually answered (BUG-11), else the configured model.

    The Bedrock client records ``_meta.model_used`` on every object it returns;
    when a fallback model answered, the risk row must carry that id rather
    than the configured one.
    """
    meta = obj.get("_meta") if isinstance(obj, dict) else None
    used = meta.get("model_used") if isinstance(meta, dict) else None
    if isinstance(used, str) and used.strip():
        return used.strip()
    return fallback or get_current_model_name()


def _is_stub_object(obj: dict) -> bool:
    if not isinstance(obj, dict):
        return True
    if obj.get("_source") == "stub":
        return True
    risk = obj.get("risk") or {}
    title = (risk.get("risk_title") or "").strip()
    return title in {
        "Failed Risk Extraction",
        "AI Risk Extraction Fallback",
    }


def _stub(text: str) -> dict:
    logger.warning("STUB: Creating fallback extraction object")
    return {
        "_source": "stub",
        "risk": {
            "risk_title": "AI Risk Extraction Fallback",
            "domains": "7. AI System Safety, Failures, & Limitations",
            "description": text[:500] if text else "Risk extraction failed, using fallback",
            "attack_vector": "To be determined through manual review",
            "observable_indicators": "Extraction failure indicator",
            "data_to_identify_risk": "Manual review of source content",
            "evidence_sources": "Source article",
            "intent": "Unknown",
            "timing": "Unknown",
            "risk_type_detected": "Extraction Fallback",
            "primary_risk": "Technical Risks",
            "secondary_risks": "Technical/Performance Risk",
            "sector": "Private",
            "industry": "Technology & Software",
            "ai_product_name": None,
            "ai_product_vendor": None,
            # Evidence fields required by the schema (BUG-01/02/03). Conservative
            # fallbacks: treat as hypothesized (lowest-severity direction) and
            # the only allowed negative for mitigations.
            "source_type": "position_paper",
            "evidence_type": "hypothesized",
            "demonstrated_finding": None,
            "stated_implication": None,
            "paper_stance": "documents_problem",
            "proposed_mitigation": None,
            "mitigations_in_source": ["not described in source"],
        },
        "risk_scoring": {
            "likelihood": None,
            "likelihood_reasoning": "",
            "impact": None,
            "impact_reasoning": "",
            "loss_categories": [],
            "severity_score": None,
            "severity_band": None,
        },
        "controls": [
            {
                "control_ref": "STUB-001",
                "name": "Manual Review Required",
                "why": "Automated extraction failed, human review needed",
                "score": 0.1,
            }
        ],
        "analysis": {
            "risk_identified": "Extraction process failed completely",
            "article_context": "Unable to process article content automatically",
            "alignment_reasoning": "Manual review required to properly extract and classify risk",
        },
        "justification": {
            "decision_rationale": "Extraction failed, using fallback object",
            "taxonomy_mapping": {
                "domain_match": {
                    "chosen_domain": "7. AI System Safety, Failures, & Limitations",
                    "evidence_excerpts": [],
                    "keyword_matches": [],
                    "confidence_reasoning": "Fallback classification",
                },
                "primary_risk_match": {
                    "chosen_primary": "Technical Risks",
                    "evidence_excerpts": [],
                    "keyword_matches": [],
                    "confidence_reasoning": "Fallback classification",
                },
                "secondary_risk_match": {
                    "chosen_secondary": "Technical/Performance Risk",
                    "evidence_excerpts": [],
                    "keyword_matches": [],
                    "confidence_reasoning": "Fallback classification",
                },
            },
            "evidence_breakdown": [],
            "self_assessment": {
                "total_score": 0,
                "confidence_level": "low",
            },
        },
    }


# ---------------------------------------------------------------------------
# Extraction planning (BUG-05)
# ---------------------------------------------------------------------------

# Tokens reserved for the system prompt, schema, metadata and the model's
# JSON answer when deciding whether a document fits in one call.
PROMPT_OVERHEAD_TOKENS = 9_000
ANSWER_TOKENS = 4_096
# Never fill the context window completely.
CONTEXT_SAFETY_RATIO = 0.85


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def plan_extraction(text: str, model_id: str) -> dict[str, Any]:
    """Decide between one whole-document call and chunking (pure function).

    EXTRACTION_MODE:
      auto    (default) whole document when it fits the model's context,
              otherwise large chunks + one synthesis call.
      whole   force a single call (text is truncated to the budget).
      chunked force chunking at CHUNK_MAX_TOKENS (legacy behaviour, but
              merged by synthesis instead of max-severity selection).

    Returns {"mode": "whole"|"chunked", "chunk_tokens": int, "budget_tokens":
    int, "estimated_tokens": int, "context_tokens": int, "reason": str}.
    """
    from app.llm.model_registry import context_window_tokens, estimate_tokens

    mode_env = os.getenv("EXTRACTION_MODE", "auto").strip().lower()
    context = context_window_tokens(model_id)
    budget = int(context * CONTEXT_SAFETY_RATIO) - PROMPT_OVERHEAD_TOKENS - ANSWER_TOKENS
    budget = max(budget, 4_000)
    estimated = estimate_tokens(text)

    # Chunk size when chunking is unavoidable: as large as the budget allows,
    # so a 1M-token document becomes a handful of chunks, not hundreds.
    default_chunk = max(4_000, min(budget, 60_000))
    chunk_tokens = _env_int("CHUNK_MAX_TOKENS", default_chunk)

    if mode_env == "whole":
        mode, reason = "whole", "EXTRACTION_MODE=whole"
    elif mode_env == "chunked":
        mode, reason = "chunked", "EXTRACTION_MODE=chunked"
    elif estimated <= budget:
        mode, reason = "whole", "document fits model context"
    else:
        mode, reason = "chunked", "document exceeds model context"
    return {
        "mode": mode,
        "chunk_tokens": chunk_tokens,
        "budget_tokens": budget,
        "estimated_tokens": estimated,
        "context_tokens": context,
        "reason": reason,
    }


def _truncate_to_budget(text: str, budget_tokens: int) -> str:
    from app.llm.model_registry import CHARS_PER_TOKEN

    limit = int(budget_tokens * CHARS_PER_TOKEN)
    return text if len(text) <= limit else text[:limit]


def _run_verifier_pass(obj: dict, source_text: str, meta: dict) -> None:
    from app.verification.llm_verifier import (
        run_verifier,
        verifier_enabled,
        verifier_grounding_min,
        verifier_model,
    )

    if not verifier_enabled():
        meta["verifier"] = {"ran": False, "reason": "ENABLE_VERIFIER=false"}
        return
    if _active_backend() != "bedrock":
        meta["verifier"] = {"ran": False, "reason": f"backend {_active_backend()} has no verifier"}
        return

    from app.llm.bedrock_llm import get_bedrock_client

    client = get_bedrock_client()
    result = run_verifier(
        obj,
        source_text,
        generate_text=client.generate_text,
        model_id=verifier_model(),
        cache_source=client._cache_enabled(),
        grounding_min=verifier_grounding_min(),
    )
    meta["verifier"] = result
    reasons = result.get("review_reasons") or []
    if reasons:
        verification = meta.get("verification")
        if not isinstance(verification, dict):
            verification = {"review_reasons": [], "citations": {}}
            meta["verification"] = verification
        existing = verification.get("review_reasons") or []
        verification["review_reasons"] = existing + reasons
        meta["review_reasons"] = (meta.get("review_reasons") or []) + reasons
    logger.info(
        "VERIFIER: %s (%d reasons, grounding=%s)",
        "passed" if result.get("passed") else "flagged",
        len(reasons),
        result.get("grounding_score"),
    )


def _base_system_prompt() -> str:
    from app.utils.prompt_loader import get_active_prompt

    return get_active_prompt()


def extract_over_chunks(
    text: str,
    schema: dict,
    model_id: str | None = None,
    system_prompt_override: Optional[str] = None,
    *,
    chunk_tokens: Optional[int] = None,
    title: str = "",
    source_url: str = "",
) -> list:
    generate_json, _backend = _resolve_generate_json()
    mid = model_id or get_current_model_name()
    if chunk_tokens is None:
        chunk_tokens = plan_extraction(text, mid)["chunk_tokens"]
    chunk_overlap = _env_int("CHUNK_OVERLAP", max(100, chunk_tokens // 20))

    chunks = tokenize_and_chunk(
        text,
        model_id=mid,
        max_tokens=chunk_tokens,
        overlap_tokens=chunk_overlap,
    )

    objs = []
    logger.info("EXTRACT: %d chunks of ~%d tokens", len(chunks), chunk_tokens)
    for idx, (start_char, end_char, chunk_text) in enumerate(chunks, 1):
        logger.info(
            "EXTRACT: chunk %d/%d (%d chars)",
            idx,
            len(chunks),
            len(chunk_text),
        )
        o: dict = {}
        try:
            o = generate_json(
                chunk_text,
                schema,
                title=title,
                url=source_url,
                chunk_index=idx,
                chunk_count=len(chunks),
                global_offset=start_char,
                system_prompt_override=system_prompt_override,
            )
            o = repair_extraction_obj(o, chunk_text, schema)
            validate(o, schema)
        except ValidationError:
            o = repair_extraction_obj(o, chunk_text, schema)
            validate(o, schema)
        except Exception:
            o = _stub(chunk_text)
            validate(o, schema)
        objs.append(o)

    return objs


def extract_with_auto_chunking(
    text: str,
    schema: dict,
    model_id: Optional[str] = None,
    *,
    title: str = "",
    source_url: str = "",
    system_prompt_override: Optional[str] = None,
) -> Tuple[dict, str, dict[str, int]]:
    """
    Returns (obj, source_flag, metrics).

    Whole-document single pass whenever the document fits the model's context
    window (BUG-05); otherwise large chunks merged by one synthesis call. The
    reference list is trimmed first so bibliographic entries never become
    "evidence".
    """
    started = time.perf_counter()
    begin_extraction(word_count=word_count(text))

    from app.extraction.preprocess import trim_for_extraction

    trimmed = trim_for_extraction(text)
    body = trimmed.text

    def finish(obj: dict, source_flag: str, extraction_meta: dict) -> Tuple[dict, str, dict[str, int]]:
        meta = obj.setdefault("_meta", {})
        if not isinstance(meta, dict):
            meta = {}
            obj["_meta"] = meta
        meta["extraction"] = {**extraction_meta, "preprocess": trimmed.to_meta()}
        # Backwards-compatible flag read by older tooling.
        meta["chunked"] = {
            "used": extraction_meta.get("mode") == "chunked",
            "count": extraction_meta.get("chunks", 1),
            "strategy": extraction_meta.get("merge_strategy"),
            "stub": source_flag == "stub",
        }

        # Evidence-discipline rules (BUG-01/02/03/04): attach review reasons to
        # the record but NEVER block storing it. Citations are checked against
        # the full original text, not the trimmed body.
        try:
            from app.verification.evidence_rules import verify_record

            verification = verify_record(obj, text)
            if verification["review_reasons"] or verification["citations"]:
                meta["verification"] = verification
                if verification["review_reasons"]:
                    existing = meta.get("review_reasons") or []
                    meta["review_reasons"] = existing + verification["review_reasons"]
        except Exception as exc:  # defensive: rules must never break extraction
            logger.warning("EVIDENCE_RULES: skipped (%s)", str(exc)[:150])

        # Independent verifier pass (BUG-06): a second call grades the record
        # against the source. Failed checks route to Review; storage is never
        # blocked. Skipped for stubs and for non-Bedrock backends.
        if source_flag != "stub":
            try:
                _run_verifier_pass(obj, body, meta)
            except Exception as exc:  # defensive
                logger.warning("VERIFIER: skipped (%s)", str(exc)[:150])

        duration_ms = max(1, int((time.perf_counter() - started) * 1000))
        metrics = get_extraction_metrics()
        tokens_generated = metrics.tokens_generated if metrics else 0
        if tokens_generated <= 0:
            record_generated_object(obj)
            refreshed = get_extraction_metrics()
            tokens_generated = refreshed.tokens_generated if refreshed else 0
        payload = {
            "word_count": metrics.word_count if metrics else word_count(text),
            "tokens_generated": tokens_generated,
            "duration_ms": duration_ms,
        }
        clear_extraction_metrics()
        return obj, source_flag, payload

    generate_json, backend = _resolve_generate_json()
    mid = model_id or get_current_model_name()
    plan = plan_extraction(body, mid)

    logger.info(
        "EXTRACT: backend=%s model=%s chars=%d (trimmed from %d) est_tokens=%d "
        "budget=%d mode=%s (%s)",
        backend,
        mid,
        len(body),
        len(text),
        plan["estimated_tokens"],
        plan["budget_tokens"],
        plan["mode"],
        plan["reason"],
    )
    if title:
        logger.info("   Title: %s...", title[:80])
    if source_url:
        logger.info("   URL: %s...", source_url[:80])

    base_meta = {
        "model": mid,
        "mode": plan["mode"],
        "reason": plan["reason"],
        "estimated_tokens": plan["estimated_tokens"],
        "budget_tokens": plan["budget_tokens"],
        "context_tokens": plan["context_tokens"],
        "chunks": 1,
        "llm_calls": 1,
        "merge_strategy": None,
    }

    if plan["mode"] == "whole":
        single_text = _truncate_to_budget(body, plan["budget_tokens"])
        obj: dict = {}
        try:
            obj = generate_json(
                single_text,
                schema,
                title=title,
                url=source_url,
                system_prompt_override=system_prompt_override,
            )
            if _is_stub_object(obj):
                logger.warning("EXTRACT: LLM returned stub (whole-document)")
                return finish(obj, "stub", base_meta)
            obj = repair_extraction_obj(obj, single_text, schema)
            validate(obj, schema)
            logger.info("EXTRACT: whole-document SUCCESS")
            return finish(obj, backend, base_meta)
        except ValidationError as ve:
            logger.warning("EXTRACT: validation failed, repairing: %s", str(ve)[:200])
            repaired = repair_extraction_obj(obj, single_text, schema)
            validate(repaired, schema)
            return finish(repaired, f"{backend}-repaired", {**base_meta, "repaired": True})
        except Exception as exc:
            logger.error("EXTRACT: whole-document FAILED: %s", str(exc)[:200])
            stub = _stub(single_text)
            validate(stub, schema)
            return finish(stub, "stub", base_meta)

    logger.info("EXTRACT: chunked path (%s)", plan["reason"])
    try:
        objs = extract_over_chunks(
            body,
            schema,
            mid,
            system_prompt_override=system_prompt_override,
            chunk_tokens=plan["chunk_tokens"],
            title=title,
            source_url=source_url,
        )
        stub_chunks = sum(1 for o in objs if _is_stub_object(o))
        if objs and stub_chunks == len(objs):
            logger.warning("EXTRACT: all %d chunks returned stub", len(objs))
            return finish(objs[0], "stub", {**base_meta, "chunks": len(objs), "llm_calls": len(objs)})
        if stub_chunks:
            logger.warning(
                "EXTRACT: %d/%d chunks were stubs (synthesising survivors)",
                stub_chunks,
                len(objs),
            )

        final = synthesize_extractions(
            objs,
            body,
            generate_json=generate_json,
            schema=schema,
            base_system_prompt=system_prompt_override or _base_system_prompt(),
            title=title,
            source_url=source_url,
        )
        llm_calls = len(objs) + 1
        if final is None:
            final = merge_extractions(objs)
        final = repair_extraction_obj(final, body, schema)
        validate(final, schema)
        strategy = (final.get("_meta") or {}).get("merge_strategy")

        if _is_stub_object(final):
            logger.warning("EXTRACT: merged output is stub")
            return finish(final, "stub", {**base_meta, "chunks": len(objs), "llm_calls": llm_calls})
        logger.info("EXTRACT: chunked SUCCESS (%s)", strategy)
        return finish(
            final,
            "chunked",
            {
                **base_meta,
                "chunks": len(objs),
                "llm_calls": llm_calls,
                "merge_strategy": strategy,
                "stub_chunks": stub_chunks,
            },
        )

    except Exception as exc:
        logger.error("EXTRACT: chunked FAILED: %s", str(exc)[:200])
        stub = _stub(body)
        validate(stub, schema)
        return finish(stub, "stub", {**base_meta, "failed": True})
