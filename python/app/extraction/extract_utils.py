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
from app.risk_processing.merge import merge_extractions

logger = logging.getLogger("airisk")

# ---------------------------------------------------------------------------
# LLM backend selection (matches production Python app)
# ---------------------------------------------------------------------------
USE_BEDROCK = os.getenv("USE_BEDROCK", "false").lower() == "true"
USE_SAGEMAKER = os.getenv("USE_SAGEMAKER", "false").lower() == "true"
USE_OPENAI = os.getenv("USE_OPENAI", "false").lower() == "true"
USE_CISCO = os.getenv("USE_CISCO", "false").lower() == "true"

if USE_BEDROCK:
    from app.llm.bedrock_llm import generate_json

    logger.info("Using AWS Bedrock LLM backend")
elif USE_SAGEMAKER:
    from app.llm.sagemaker_llm import generate_json

    logger.info("Using SageMaker LLM backend")
elif USE_OPENAI:
    from app.llm.openai_llm import generate_json

    logger.info("Using OpenAI LLM backend")
elif USE_CISCO:
    from app.llm.cisco_llm import generate_json

    logger.info("Using Cisco (HuggingFace) LLM backend")
else:
    from app.llm.local_llm import generate_json

    logger.info("Using local LLM backend")

from app.llm.local_llm import MODEL_ID

_SCHEMA_PATH = (
    Path(__file__).resolve().parent.parent / "schemas" / "risk_extraction.schema.json"
)


def load_risk_schema() -> dict[str, Any]:
    with _SCHEMA_PATH.open(encoding="utf-8") as f:
        return json.load(f)


def get_current_model_name() -> str:
    if USE_BEDROCK:
        from app.llm.model_config import _bedrock_model_id

        raw = (
            os.getenv("BEDROCK_MODEL", "").strip()
            or os.getenv("BEDROCK_MODEL_ID", "").strip()
            or "claude-haiku-4-5"
        )
        return _bedrock_model_id(raw)
    if USE_SAGEMAKER:
        return os.getenv("SAGEMAKER_MODEL_NAME", "foundation-sec-8b")
    if USE_OPENAI:
        return os.getenv("OPENAI_MODEL", "gpt-5-mini")
    if USE_CISCO:
        return os.getenv("CISCO_MODEL_NAME", "foundation-sec-8b")
    return os.getenv("LOCAL_MODEL_ID", MODEL_ID)


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


def extract_over_chunks(
    text: str,
    schema: dict,
    model_id: str | None = None,
    system_prompt_override: Optional[str] = None,
) -> list:
    mid = model_id or MODEL_ID
    chunk_max = int(os.getenv("CHUNK_MAX_TOKENS", "1024"))
    chunk_overlap = int(os.getenv("CHUNK_OVERLAP", "100"))

    chunks = tokenize_and_chunk(
        text,
        model_id=mid,
        max_tokens=chunk_max,
        overlap_tokens=chunk_overlap,
    )

    objs = []
    for idx, (start_char, end_char, chunk_text) in enumerate(chunks, 1):
        try:
            o = generate_json(
                chunk_text,
                schema,
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
    Returns (obj, source_flag, metrics). Uses chunking for long texts and merges results.

    Short documents (< CHUNK_THRESHOLD_CHARS): single-pass extraction.
    Long documents (>= threshold): overlapping token chunks + merge.
    """
    started = time.perf_counter()
    begin_extraction(word_count=word_count(text))

    def finish(obj: dict, source_flag: str) -> Tuple[dict, str, dict[str, int]]:
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

    use_chunking = os.getenv("USE_CHUNKING", "true").lower() in ("1", "true", "yes")
    threshold = int(os.getenv("CHUNK_THRESHOLD_CHARS", "6000"))
    mid = model_id or os.getenv("LOCAL_MODEL_ID", MODEL_ID)

    logger.info(
        "EXTRACT: Text length=%d chunking=%s threshold=%d",
        len(text),
        use_chunking,
        threshold,
    )
    if title:
        logger.info("   Title: %s...", title[:80])
    if source_url:
        logger.info("   URL: %s...", source_url[:80])

    if not (use_chunking and len(text) > threshold):
        logger.info("EXTRACT: single-pass (< %d chars)", threshold)
        obj: dict = {}
        try:
            obj = generate_json(
                text,
                schema,
                title=title,
                url=source_url,
                system_prompt_override=system_prompt_override,
            )
            if _is_stub_object(obj):
                logger.warning("EXTRACT: LLM returned stub (single-pass)")
                return finish(obj, "stub")
            obj = repair_extraction_obj(obj, text, schema)
            validate(obj, schema)
            obj.setdefault("_meta", {})["chunked"] = {"used": False}
            logger.info("EXTRACT: single-pass SUCCESS")
            return finish(obj, "local-llm")
        except ValidationError as ve:
            logger.warning("EXTRACT: validation failed, repairing: %s", str(ve)[:200])
            repaired = repair_extraction_obj(obj, text, schema)
            validate(repaired, schema)
            repaired.setdefault("_meta", {})["chunked"] = {"used": False, "repaired": True}
            return finish(repaired, "local-llm-repaired")
        except Exception as exc:
            logger.error("EXTRACT: single-pass FAILED: %s", str(exc)[:200])
            stub = _stub(text)
            validate(stub, schema)
            stub.setdefault("_meta", {})["chunked"] = {"used": False, "stub": True}
            return finish(stub, "stub")

    logger.info("EXTRACT: chunked path (> %d chars)", threshold)
    try:
        try:
            objs = extract_over_chunks(
                text,
                schema,
                mid,
                system_prompt_override=system_prompt_override,
            )
            merge_fn = merge_extractions
            strategy = "pipeline"
            logger.info("EXTRACT: chunked extraction completed, %d chunks", len(objs))
        except Exception as chunk_err:
            logger.warning(
                "EXTRACT: pipeline chunking failed, using inline: %s",
                str(chunk_err)[:100],
            )
            objs = []
            strategy = "inline"
            chunk_max = int(os.getenv("CHUNK_MAX_TOKENS", "1024"))
            chunk_overlap = int(os.getenv("CHUNK_OVERLAP", "100"))
            chunks = tokenize_and_chunk(
                text,
                model_id=mid,
                max_tokens=chunk_max,
                overlap_tokens=chunk_overlap,
            )
            logger.info("EXTRACT: processing %d chunks inline", len(chunks))
            for idx, (start_char, end_char, chunk_text) in enumerate(chunks, 1):
                logger.info(
                    "   Chunk %d/%d: chars %d-%d (%d chars)",
                    idx,
                    len(chunks),
                    start_char,
                    end_char,
                    len(chunk_text),
                )
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
                except Exception as exc:
                    logger.error("   Chunk %d FAILED: %s", idx, str(exc)[:100])
                    o = _stub(chunk_text)
                    validate(o, schema)
                objs.append(o)
            merge_fn = merge_extractions

        stub_chunks = sum(1 for o in objs if _is_stub_object(o))
        if objs and stub_chunks == len(objs):
            logger.warning("EXTRACT: all %d chunks returned stub", len(objs))
            return finish(objs[0], "stub")
        if stub_chunks:
            logger.warning(
                "EXTRACT: %d/%d chunks were stubs (merging survivors)",
                stub_chunks,
                len(objs),
            )

        logger.info("EXTRACT: merging %d chunk results", len(objs))
        merged = merge_fn(objs)
        final = merged[0] if isinstance(merged, list) else merged
        final = repair_extraction_obj(final, text, schema)

        final.setdefault("_meta", {})["chunked"] = {
            "used": True,
            "count": len(objs),
            "strategy": strategy,
            "stub_chunks": stub_chunks,
        }
        if _is_stub_object(final):
            logger.warning("EXTRACT: merged output is stub")
            return finish(final, "stub")
        logger.info("EXTRACT: chunked SUCCESS")
        return finish(final, "chunked")

    except Exception as exc:
        logger.error("EXTRACT: chunked FAILED: %s", str(exc)[:200])
        stub = _stub(text)
        validate(stub, schema)
        stub.setdefault("_meta", {})["chunked"] = {"used": True, "failed": True}
        return finish(stub, "stub")
