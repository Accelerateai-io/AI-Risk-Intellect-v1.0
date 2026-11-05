"""Independent verifier pass (BUG-06).

A second model call receives the source text and the extracted record and
answers the publication checks. The same checks are used for a first
extraction and for a retry output:

* claim_is_demonstrated            - the risk is an observed result or real
                                     incident, not a speculation written as fact
* mitigations_reflected            - safeguards, validation and limitations the
                                     source describes are reflected in the record
* not_attributed_to_proposed_method - the risk is the problem the source
                                     documents, not the method it proposes
* severity_within_evidence         - likelihood / impact and their rationale do
                                     not go beyond what the source supports

Any failed check becomes a review reason ("Verifier: ...") that routes the
record to the Review queue; the record is still stored. The grader is a
different call from the extractor and may be a different model
(VERIFIER_MODEL). Prompt building and response parsing are pure functions so
they are unit-testable without Bedrock.
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
    "evidence_labels_match",
    "classification_consistent",
    "simulation_scope_respected",
    "sensitive_claims_supported",
    "scope_within_source",
)

CHECK_LABELS: dict[str, str] = {
    "claim_is_demonstrated": "the risk is stated as demonstrated but the source only speculates",
    "mitigations_reflected": "safeguards or limitations in the source are not reflected",
    "not_attributed_to_proposed_method": "the risk is attributed to the method the source proposes",
    "severity_within_evidence": "likelihood or impact goes beyond the evidence",
    "evidence_labels_match": "a demonstrated label is used for an inference or for prior work",
    "classification_consistent": "the domain or risk labels disagree with the explanation",
    "simulation_scope_respected": "a simulation or uncertified estimate is written as a real-world incident",
    "sensitive_claims_supported": "a healthcare or physical-safety claim is not supported by the source",
    "scope_within_source": "the record generalizes beyond the tasks the source tested",
}

REASON_PREFIX = "Verifier:"

# Source text handed to the verifier. Beyond this, head + tail are sent.
DEFAULT_MAX_SOURCE_CHARS = 150_000

VERIFIER_SYSTEM_PROMPT = """You are an independent evidence auditor for AI risk records.

You receive a SOURCE document and a RECORD that another system extracted from
it. Decide, for each check, whether the RECORD is faithful to the SOURCE.
Judge only against the SOURCE text given. Silence in the source is not
evidence of absence.

Checks:
1. claim_is_demonstrated: true when the record's risk is something the
   source reports as observed, measured or as a real incident, OR the record
   itself marks it as hypothesized and writes it as a suggestion. False when a
   speculation, limitation or future-work remark is written as an observed
   fact, or when evidence_type says "demonstrated" without a result to back it.
2. mitigations_reflected: true when every safeguard, validation, control,
   limitation or mitigation the source describes is reflected in
   mitigations_in_source / proposed_mitigation, or the source describes none.
   False when the record says "not described in source" or omits a safeguard
   that the source does describe, or claims a safeguard is absent.
3. not_attributed_to_proposed_method: true when the risk is the problem the
   source documents. False when the record blames the method, tool or system
   the source proposes or evaluates for the problem it was built to solve.
4. severity_within_evidence: true when likelihood and impact and their
   rationale sentences are supported by the source and consistent with the
   record's own evidence_type. False when the rationale cites consequences,
   deployments, populations or harms the source does not describe, or when
   the rationale is about a different topic than the record's title.
5. evidence_labels_match: true when a demonstrated finding is an observed or
   measured result in the SOURCE, and inferences are marked as implications.
   False when "demonstrated" is used for a speculation, or when the record
   presents a finding the SOURCE attributes to prior work as its own result.
6. classification_consistent: true when the domain, primary risk, and
   secondary risk describe the same harm as the explanation. False when they
   disagree, including a fairness or protected-group label the explanation
   does not support.
7. simulation_scope_respected: true when a simulation, counterfactual, or
   uncertified estimate stays labeled as such. False when it is written as a
   deployed incident, a certified probability, or real-world harm.
8. sensitive_claims_supported: true when every healthcare or physical-safety
   claim (patients, clinicians, mortality, injury, safety-critical equipment)
   is quoted from the SOURCE or explicitly hedged as a possible consequence.
   False when patient impact or physical harm is stated as fact without that
   support. Silence in the source is not evidence of harm.
9. scope_within_source: true when capability and fairness claims stay inside
   the tasks the SOURCE tested. False when a task-specific result is
   generalized to a broader ability or to a protected-group finding the
   SOURCE did not test.

These checks apply equally to a first extraction and to a retry output.

Also give grounding_score: a 0 to 1 estimate of how much of the record's
description and rationale is directly supported by the source, and list any
unsupported_claims (short quotes from the RECORD).

Return ONLY a JSON object:
{
  "claim_is_demonstrated": {"pass": true|false, "reason": "one sentence"},
  "mitigations_reflected": {"pass": true|false, "reason": "one sentence"},
  "not_attributed_to_proposed_method": {"pass": true|false, "reason": "one sentence"},
  "severity_within_evidence": {"pass": true|false, "reason": "one sentence"},
  "evidence_labels_match": {"pass": true|false, "reason": "one sentence"},
  "classification_consistent": {"pass": true|false, "reason": "one sentence"},
  "simulation_scope_respected": {"pass": true|false, "reason": "one sentence"},
  "sensitive_claims_supported": {"pass": true|false, "reason": "one sentence"},
  "scope_within_source": {"pass": true|false, "reason": "one sentence"},
  "grounding_score": 0.0,
  "unsupported_claims": ["..."]
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
) -> list[dict]:
    """Converse content blocks: source first (cacheable), then the record."""
    blocks: list[dict] = [
        {"text": "=== SOURCE ===\n" + _source_slice(source_text, max_source_chars)},
    ]
    if cache_source:
        blocks.append({"cachePoint": {"type": "default"}})
    blocks.append(
        {
            "text": "=== RECORD ===\n"
            + json.dumps(record_summary(record), ensure_ascii=False, indent=1)
            + "\n\nRun every check and return the JSON object."
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


def parse_verifier_response(text: str) -> dict:
    """Normalise the model's answer. Never raises; missing checks are None."""
    from app.llm.json_parse import parse_llm_json

    try:
        raw = parse_llm_json(text or "")
    except Exception:
        raw = {}
    if not isinstance(raw, dict):
        raw = {}

    checks: dict[str, dict] = {}
    for name in VERIFIER_CHECKS:
        entry = raw.get(name)
        if isinstance(entry, dict):
            ok = _as_bool(entry.get("pass"))
            reason = str(entry.get("reason") or "").strip()
        else:
            ok = _as_bool(entry)
            reason = ""
        checks[name] = {"pass": ok, "reason": reason}

    score: Optional[float]
    try:
        score = float(raw.get("grounding_score"))
        score = max(0.0, min(1.0, score))
    except (TypeError, ValueError):
        score = None

    claims_raw = raw.get("unsupported_claims")
    claims = [str(c).strip() for c in claims_raw if str(c).strip()] if isinstance(claims_raw, list) else []

    return {
        "checks": checks,
        "grounding_score": score,
        "unsupported_claims": claims[:10],
        "parsed": bool(raw),
    }


def verifier_review_reasons(result: dict, *, grounding_min: float) -> list[str]:
    reasons: list[str] = []
    checks = result.get("checks") or {}
    for name in VERIFIER_CHECKS:
        entry = checks.get(name) or {}
        if entry.get("pass") is False:
            label = CHECK_LABELS[name]
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
) -> dict:
    """Run the verifier once. Returns the result dict with review_reasons.

    ``generate_text(system, blocks, max_tokens=, temperature=, model_id=)``
    returns (text, model_used, usage). Never raises: a transport failure
    yields a result whose only reason says the verifier did not run.
    """
    blocks = build_verifier_blocks(
        record, source_text, max_source_chars=max_source_chars, cache_source=cache_source
    )
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
        return {
            "ran": False,
            "error": str(exc)[:200],
            "checks": {},
            "grounding_score": None,
            "unsupported_claims": [],
            "review_reasons": [f"{REASON_PREFIX} did not run - {str(exc)[:120]}"],
        }
    result = parse_verifier_response(text)
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
