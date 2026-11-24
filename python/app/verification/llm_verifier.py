"""Independent assessor (workflow v2).

A second model call, separate from extraction, reads the source and the
facts-only record and answers nine checks. A supported paraphrase passes.
Five consecutive source words are not a pass rule. The worker's decision
function, not this module, chooses the single publication outcome.
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Callable, Optional

logger = logging.getLogger("airisk")

VERIFIER_CHECKS: tuple[str, ...] = (
    "claim_is_demonstrated",
    "mitigations_reflected",
    "not_attributed_to_proposed_method",
    "severity_within_evidence",
    "evidence_type_consistent",
    "rationale_supported",
    "domain_correct",
    "primary_secondary_correct",
    "catalog_match",
)

# These failures are returned and stored. They are not review reasons.
NON_HOLDING_CHECKS = frozenset({
    "mitigations_reflected",
    "severity_within_evidence",
    "evidence_type_consistent",
    "rationale_supported",
    "domain_correct",
    "primary_secondary_correct",
})

CHECK_LABELS: dict[str, str] = {
    "claim_is_demonstrated": "the risk is stated as demonstrated but the source only speculates",
    "mitigations_reflected": "safeguards or limitations in the source are not reflected",
    "not_attributed_to_proposed_method": "the risk is attributed to the method the source proposes",
    "severity_within_evidence": "likelihood or impact goes beyond the evidence",
}

REASON_PREFIX = "Verifier:"

# Source text handed to the verifier. Beyond this, head + tail are sent.
DEFAULT_MAX_SOURCE_CHARS = 150_000

VERIFIER_SYSTEM_PROMPT = """You are an independent evidence auditor for AI risk records. You did not write the record. Do not rewrite the finding except to name a domain or category correction, or one unsupported secondary clause to drop.

You receive a SOURCE document, a RECORD extracted from it, up to five catalog candidates, and optional hints. Judge only against the SOURCE. A sentence that paraphrases the source passes when the source supports that meaning. Do not require five consecutive words copied from the source. Silence in the source is not evidence of absence.

Checks:
1. claim_is_demonstrated: pass when the record's risk is something the source reports as observed, measured, or as a real incident, OR the record marks it as hypothesized and writes it as a suggestion. Pass when evidence_type is "mitigation_target" and the source reports a measured ablation, benchmark degradation, or the effect of removing a component. That measured research result is not a failure for lack of a deployed incident. Fail when a speculation is written as an observed fact, or evidence_type is "demonstrated" without a result. Fail when the record says the authors observed, found, showed, or demonstrated a behavior that the source only says may or might happen, including when the record says the paper demonstrates it through experiments. A failure must include a source quote. Do not fail this check with an empty reason.
2. mitigations_reflected: pass when safeguards, validation, limitations, or mitigations in the source are reflected, or the source describes none.
3. not_attributed_to_proposed_method: pass when the risk is the problem the source documents, including a limitation the source reports in the method it proposes, such as a measured segmentation, depth, or simulation failure. Fail when the record blames that method for a harm the source does not report. This check does not by itself decide publication.
4. severity_within_evidence: pass when likelihood, impact, and their rationales stay within what the source reports. Fail when a rationale states patient harm, physical harm, or a deployment failure the source does not report. A sentence about improved patient care, resource allocation, better outcomes, or another hoped-for benefit does not show that harm occurred. This check does not by itself decide publication.
5. evidence_type_consistent: pass when "demonstrated" has a measured result or incident, "mitigation_target" is a fix the source proposes, and anything else is "hypothesized".
6. rationale_supported: pass when each rationale sentence is supported by a passage you can quote, including a faithful paraphrase. A benefit or improvement sentence does not support a harm rationale. This check does not by itself decide publication.
7. domain_correct: pass when the domain matches the harm. If not, return the corrected domain string. The corrected value must be one of the seven domains (Discrimination & Toxicity, Privacy & Security, Misinformation, Malicious Actors, Human-Computer Interaction, Socioeconomic & Environmental, AI System Safety, Failures, & Limitations). Never return a primary category such as Technical Risks, Operational Risks, or Business Risks.
8. primary_secondary_correct: pass when primary and secondary categories match the mechanism of harm, not a single keyword. Technical/Performance Risk is only for output quality: hallucination, inaccurate output, inconsistent responses, or performance degradation. CAPTCHA-solving accuracy, a success rate, learning a new CAPTCHA class, and simulated perturbation recovery are Technical/Performance Risk. The words CAPTCHA, bypass, evasion, or defeat alone are not Security Risk. Security Risk for a CAPTCHA system requires the source to report unauthorized access, account takeover, or credential abuse. Unauthorized agent actions, cyberattacks, prompt injection, data exposure, and system compromise are Security Risk under Technical Risks. If the record uses the wrong one, fail and return corrected_primary and corrected_secondary. Do not rewrite the finding.
9. catalog_match: best candidate id, verdict ("same mechanism", "related", or "topical only"), and percent 0 to 100. No candidate: best_id null and percent null.

Also return grounding_score 0 to 1 (share of the record the source supports, paraphrase included), quoted_support (source passages), safety_claim, and repair (one secondary clause to drop, or null). safety_claim is "real_world" when the record asserts actual or potential health or physical-safety harm in the finding or the impact, including harm that could follow from a test, benchmark, or simulation. Use "none" when the finding or impact says that harm was not reported or did not occur, including "no reported physical harm" and "no patient safety consequences". Use "research_only" when the work is research and the record does not assert that harm. Use "none" when there is no health or physical-safety claim. A measured accuracy, AUC, F1, or error count is not by itself a safety harm. When the record asserts that harm, return repair null. Do not name the harm sentence as the clause to drop.

Return ONLY this JSON object:
{
  "checks": {
    "claim_is_demonstrated": {"pass": true, "quote": "..."},
    "mitigations_reflected": {"pass": true, "quote": "..."},
    "not_attributed_to_proposed_method": {"pass": true, "quote": "..."},
    "severity_within_evidence": {"pass": true, "quote": "..."},
    "evidence_type_consistent": {"pass": true, "quote": "..."},
    "rationale_supported": {"pass": true, "quote": "..."},
    "domain_correct": {"pass": true, "corrected": ""},
    "primary_secondary_correct": {"pass": true, "corrected_primary": "", "corrected_secondary": ""},
    "catalog_match": {"best_id": "AIQ-0000", "verdict": "related", "percent": 0}
  },
  "grounding_score": 0.0,
  "quoted_support": ["..."],
  "safety_claim": "none",
  "repair": null
}
No markdown, no text outside the JSON."""

_RECORD_FIELDS = (
    "risk_title",
    "domains",
    "primary_risk",
    "secondary_risks",
    "description",
    "attack_vector",
    "observable_indicators",
    "source_type",
    "evidence_type",
    "demonstrated_finding",
    "stated_implication",
    "paper_stance",
    "proposed_mitigation",
    "mitigations_in_source",
    "ai_product_name",
)


def _source_slice(source_text: str, max_chars: int) -> str:
    text = source_text or ""
    if len(text) <= max_chars:
        return text
    head = int(max_chars * 0.6)
    tail = max_chars - head
    return text[:head] + "\n\n[... middle of document omitted ...]\n\n" + text[-tail:]


def record_summary(record: dict) -> dict:
    risk = record.get("risk") or {}
    scoring = record.get("risk_scoring") or {}
    return {
        "risk": {k: risk.get(k) for k in _RECORD_FIELDS if k in risk},
        "risk_scoring": {
            "likelihood": scoring.get("likelihood"),
            "likelihood_reasoning": scoring.get("likelihood_reasoning"),
            "impact": scoring.get("impact"),
            "impact_reasoning": scoring.get("impact_reasoning"),
        },
    }


def build_verifier_blocks(
    record: dict,
    source_text: str,
    *,
    max_source_chars: int = DEFAULT_MAX_SOURCE_CHARS,
    cache_source: bool = False,
    catalog_candidates: Optional[list] = None,
    hints: Any = None,
) -> list[dict]:
    """Converse content blocks: source first (cacheable), then the record."""
    blocks: list[dict] = [
        {"text": "=== SOURCE ===\n" + _source_slice(source_text, max_source_chars)},
    ]
    if cache_source:
        blocks.append({"cachePoint": {"type": "default"}})
    tail = {
        "record": record_summary(record),
        "catalog_candidates": catalog_candidates or [],
        "hints": hints or {},
    }
    blocks.append(
        {
            "text": "=== RECORD ===\n"
            + json.dumps(tail, ensure_ascii=False, indent=1)
            + "\n\nRun the nine checks and return the JSON object. "
            + "A supported paraphrase passes. Do not apply a five-word rule."
        }
    )
    return blocks


def _as_bool(value: Any) -> Optional[bool]:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        v = value.strip().lower()
        if v in ("true", "yes", "pass", "passed", "1"):
            return True
        if v in ("false", "no", "fail", "failed", "0"):
            return False
    return None


def _check_blob(raw: dict, name: str) -> Any:
    nested = raw.get("checks")
    if isinstance(nested, dict) and name in nested:
        return nested.get(name)
    return raw.get(name)


_FAILED_EXPLANATIONS = {
    "claim_is_demonstrated": "The source does not show this risk as a measured result or a real incident.",
    "mitigations_reflected": "Safeguards or limitations from the source are missing from the record.",
    "not_attributed_to_proposed_method": "The record blames the method the source proposes.",
    "severity_within_evidence": "The likelihood or impact goes beyond what the source reports.",
    "evidence_type_consistent": "The evidence label does not match the kind of result in the source.",
    "rationale_supported": "A likelihood or impact explanation is not supported by the source.",
    "domain_correct": "The domain does not match the harm described in the source.",
    "primary_secondary_correct": "The risk categories do not match how the harm happens.",
    "catalog_match": "No catalog entry describes this same risk.",
}


def _bare_result(reason: str) -> bool:
    text = (reason or "").strip()
    if not text:
        return True
    if text.lower() in {"failed", "check failed", "catalog judge score"}:
        return True
    return False


def _explain_failed_check(name: str, parsed: dict) -> dict:
    """A check that did not pass keeps a sentence and the evidence that supports it."""
    if parsed.get("pass") is True:
        return parsed
    stored = str(parsed.get("reason") or "").strip()
    base = stored if not _bare_result(stored) else _FAILED_EXPLANATIONS.get(
        name, f"The {name} check failed."
    )
    traces: list[str] = []
    quote = str(parsed.get("quote") or "").strip()
    if quote and quote not in base:
        traces.append(f'Source quote: "{quote}".')
    corrected = str(parsed.get("corrected") or "").strip()
    if corrected and corrected not in base:
        traces.append(f"Corrected value: {corrected}.")
    categories = " / ".join(
        part
        for part in (
            str(parsed.get("corrected_primary") or "").strip(),
            str(parsed.get("corrected_secondary") or "").strip(),
        )
        if part
    )
    if categories and categories not in base:
        traces.append(f"Corrected categories: {categories}.")
    if name == "catalog_match":
        best_id = str(parsed.get("best_id") or "").strip()
        verdict = str(parsed.get("verdict") or "").strip()
        if best_id and best_id not in base:
            traces.append(f"Closest catalog entry: {best_id}.")
        if verdict and verdict.lower() not in base.lower():
            traces.append(f"Verdict: {verdict}.")
    explanation = " ".join([base, *traces]).strip()
    if parsed.get("pass") is None:
        explanation = (
            "This check did not run, so there is no verdict to trace. " + explanation
        )
    parsed["reason"] = explanation
    return parsed


def _parse_check(name: str, entry: Any) -> dict:
    if name == "catalog_match":
        if not isinstance(entry, dict):
            return {"pass": None, "best_id": None, "verdict": None, "percent": None, "reason": "", "quote": ""}
        percent = entry.get("percent")
        try:
            percent = float(percent) if percent is not None else None
        except (TypeError, ValueError):
            percent = None
        best_id = entry.get("best_id")
        best_id = str(best_id).strip() if best_id else None
        verdict = str(entry.get("verdict") or "").strip() or None
        return _explain_failed_check(name, {
            "pass": percent is not None and percent >= 60 and bool(best_id),
            "best_id": best_id,
            "verdict": verdict,
            "percent": percent,
            "reason": str(entry.get("reason") or "").strip(),
            "quote": str(entry.get("quote") or "").strip(),
        })
    if isinstance(entry, dict):
        parsed = {
            "pass": _as_bool(entry.get("pass")),
            "reason": str(entry.get("reason") or "").strip(),
            "quote": str(entry.get("quote") or "").strip(),
        }
        for key in ("corrected", "corrected_primary", "corrected_secondary"):
            value = entry.get(key)
            if isinstance(value, str) and value.strip():
                parsed[key] = value.strip()
        return _explain_failed_check(name, parsed)
    return _explain_failed_check(
        name, {"pass": _as_bool(entry), "reason": "", "quote": ""}
    )


def parse_verifier_response(text: str) -> dict:
    """Normalise the model's answer. Never raises; missing checks are None."""
    from app.llm.json_parse import parse_llm_json

    try:
        raw = parse_llm_json(text or "")
    except Exception:
        raw = {}
    if not isinstance(raw, dict):
        raw = {}

    checks = {name: _parse_check(name, _check_blob(raw, name)) for name in VERIFIER_CHECKS}

    score: Optional[float]
    try:
        score = float(raw.get("grounding_score"))
        score = max(0.0, min(1.0, score))
    except (TypeError, ValueError):
        score = None

    quotes_raw = raw.get("quoted_support")
    if not isinstance(quotes_raw, list):
        quotes_raw = raw.get("unsupported_claims")
    quotes = [str(c).strip() for c in quotes_raw if str(c).strip()] if isinstance(quotes_raw, list) else []

    safety = str(raw.get("safety_claim") or "").strip().lower()
    if safety not in ("real_world", "research_only", "none"):
        safety = None

    repair = raw.get("repair")
    if not isinstance(repair, dict) or not str(repair.get("drop_clause") or "").strip():
        repair = None
    else:
        repair = {
            "drop_clause": str(repair.get("drop_clause")).strip(),
            "reason": str(repair.get("reason") or "").strip(),
        }

    return {
        "checks": checks,
        "grounding_score": score,
        "quoted_support": quotes[:10],
        "unsupported_claims": quotes[:10],
        "safety_claim": safety,
        "repair": repair,
        "parsed": bool(raw),
    }


def verifier_review_reasons(result: dict, *, grounding_min: float) -> list[str]:
    """Reasons for a failed main-claim check only.

    Checks 2, 4, 5, 6, 7 and 8 are stored on the result and are not reasons.
    Catalog match is not a hold. The worker decision function is the gate.
    """
    reasons: list[str] = []
    checks = result.get("checks") or {}
    for name in ("claim_is_demonstrated", "not_attributed_to_proposed_method"):
        entry = checks.get(name) or {}
        if entry.get("pass") is False:
            label = CHECK_LABELS.get(name, name)
            reason = (entry.get("reason") or "").strip()
            reasons.append(
                f"{REASON_PREFIX} {name} failed - {label}" + (f": {reason}" if reason else "")
            )
    score = result.get("grounding_score")
    if isinstance(score, (int, float)) and score < grounding_min:
        reasons.append(
            f"{REASON_PREFIX} grounding_score {score:.2f} below {grounding_min:.2f}"
        )
    if not result.get("parsed"):
        reasons.append(f"{REASON_PREFIX} no verdict - verifier response could not be parsed")
    return reasons


def run_verifier(
    record: dict,
    source_text: str,
    *,
    generate_text: Callable[..., tuple[str, str, dict]],
    model_id: Optional[str] = None,
    max_source_chars: int = DEFAULT_MAX_SOURCE_CHARS,
    cache_source: bool = False,
    grounding_min: float = 0.6,
    catalog_candidates: Optional[list] = None,
    hints: Any = None,
) -> dict:
    """Run the assessor once, plus one JSON repair if the reply does not parse.

    ``generate_text(system, blocks, max_tokens=, temperature=, model_id=)``
    returns (text, model_used, usage). Never raises: a transport failure
    yields a result whose only reason says the assessor did not run.
    """
    blocks = build_verifier_blocks(
        record,
        source_text,
        max_source_chars=max_source_chars,
        cache_source=cache_source,
        catalog_candidates=catalog_candidates,
        hints=hints,
    )

    def _empty(error: str) -> dict:
        return {
            "ran": False,
            "error": error[:200],
            "checks": {name: _parse_check(name, None) for name in VERIFIER_CHECKS},
            "grounding_score": None,
            "quoted_support": [],
            "unsupported_claims": [],
            "safety_claim": None,
            "repair": None,
            "review_reasons": [f"{REASON_PREFIX} did not run - {error[:120]}"],
            "passed": False,
        }

    try:
        text, model_used, usage = generate_text(
            VERIFIER_SYSTEM_PROMPT,
            blocks,
            max_tokens=1_500,
            temperature=0.0,
            model_id=model_id,
        )
    except Exception as exc:
        logger.warning("VERIFIER: call failed (%s)", str(exc)[:160])
        return _empty(str(exc))
    result = parse_verifier_response(text)
    if not result["parsed"]:
        try:
            text, model_used, usage = generate_text(
                VERIFIER_SYSTEM_PROMPT,
                blocks + [{"text": "The previous reply was not valid JSON. Return only the JSON object."}],
                max_tokens=1_500,
                temperature=0.0,
                model_id=model_id,
            )
            result = parse_verifier_response(text)
        except Exception as exc:
            logger.warning("VERIFIER: JSON repair failed (%s)", str(exc)[:160])
    result["ran"] = True
    result["model_used"] = model_used
    result["usage"] = usage
    result["review_reasons"] = verifier_review_reasons(result, grounding_min=grounding_min)
    result["passed"] = not result["review_reasons"]
    return result


def verifier_enabled() -> bool:
    return os.getenv("ENABLE_VERIFIER", "true").strip().lower() not in ("0", "false", "no", "off")


def verifier_model() -> Optional[str]:
    value = os.getenv("VERIFIER_MODEL", "").strip()
    return value or None


def verifier_grounding_min() -> float:
    raw = os.getenv("VERIFIER_GROUNDING_MIN", "").strip()
    try:
        value = float(raw) if raw else 0.6
    except ValueError:
        value = 0.6
    return max(0.0, min(1.0, value))


_WORD_RE = re.compile(r"\S+")
