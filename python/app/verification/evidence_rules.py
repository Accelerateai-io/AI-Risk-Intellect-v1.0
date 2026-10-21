"""Evidence-discipline verification rules (BUG-01, BUG-02, BUG-03, BUG-04).

Pure functions, no I/O. Each rule inspects an extraction record (or plain
strings) and reports a grounding violation. The rules NEVER raise and NEVER
block storage — the extraction path attaches the returned review reasons to the
record and stores it regardless (see verify_record / the wiring in
app/extraction/extract_utils.py).

New evidence fields live inside the record under ``record["risk"]``:
source_type, evidence_type, demonstrated_finding, stated_implication,
paper_stance, proposed_mitigation, mitigations_in_source.
"""

from __future__ import annotations

import re
from typing import Any, Optional

# --- BUG-01: likelihood cap when evidence is only hypothesized ---------------
HYPOTHESIZED_CAP_REASON = "Likelihood capped: evidence is hypothesized"

# Review reason added when repair had to backfill missing evidence fields.
EVIDENCE_DEFAULTS_REASON = "Evidence fields missing - defaults applied"


def _defaulted_fields(record: dict) -> list:
    """Fields that repair backfilled, recorded under _meta.defaulted_fields."""
    if not isinstance(record, dict):
        return []
    meta = record.get("_meta")
    fields = meta.get("defaulted_fields") if isinstance(meta, dict) else None
    return fields if isinstance(fields, list) else []

# --- BUG-02: the only permitted "negative" mitigation value ------------------
ALLOWED_NEGATIVE = "not described in source"

# Phrases whose meaning is "a safeguard is absent" — forbidden because absence
# must come from the source, never from silence. Matched as whole words so a
# benign substring (e.g. "telephone") does not trip "none".
_NEGATIVE_RE = re.compile(
    r"\b(none|no\s+safeguards?|no\s+mitigations?|no\s+controls?|absent|"
    r"not\s+present|lacks?|lacking|nonexistent|non-existent)\b",
    re.IGNORECASE,
)

# --- BUG-04: citation span matching ------------------------------------------
_WORD_RE = re.compile(r"\S+")
_CITATION_MIN_WORDS = 5


def enforce_hypothesized_cap(record: dict) -> Optional[str]:
    """Cap likelihood at 2 when evidence_type is "hypothesized" (BUG-01).

    Mutates ``record["risk_scoring"]["likelihood"]`` in place when it exceeds 2
    and returns the review reason. Returns None when no change is needed.

    The cap is skipped when ``evidence_type`` was only defaulted by repair (it
    appears in ``_meta.defaulted_fields``): an artificial default must not
    silently lower a model-provided likelihood.
    """
    if not isinstance(record, dict):
        return None
    if "evidence_type" in _defaulted_fields(record):
        return None
    risk = record.get("risk") or {}
    scoring = record.get("risk_scoring")
    if not isinstance(scoring, dict):
        return None
    evidence_type = str(risk.get("evidence_type") or "").strip().lower()
    likelihood = scoring.get("likelihood")
    if (
        evidence_type == "hypothesized"
        and isinstance(likelihood, int)
        and not isinstance(likelihood, bool)
        and likelihood > 2
    ):
        scoring["likelihood"] = 2
        return HYPOTHESIZED_CAP_REASON
    return None


def check_mitigations_negative(record: dict) -> Optional[str]:
    """Reject mitigations that assert absence from silence (BUG-02).

    ``mitigations_in_source`` may only express a negative as the exact phrase
    "not described in source". Any entry meaning absence ("none", "no
    safeguards", "absent", "not present", "lacks", …) is a violation. Returns a
    review reason describing the first offending entry, or None.
    """
    if not isinstance(record, dict):
        return None
    risk = record.get("risk") or {}
    entries = risk.get("mitigations_in_source")
    if entries is None:
        return None
    if isinstance(entries, str):
        entries = [entries]
    if not isinstance(entries, list):
        return None
    for entry in entries:
        if not isinstance(entry, str):
            continue
        norm = entry.strip().rstrip(".").strip().lower()
        if not norm or norm == ALLOWED_NEGATIVE:
            continue
        if _NEGATIVE_RE.search(entry):
            return (
                "Mitigation asserts absence from silence; the only allowed "
                f'negative is "{ALLOWED_NEGATIVE}" (got: "{entry.strip()}")'
            )
    return None


def check_citation(
    reasoning: str,
    source_text: str,
    *,
    min_words: int = _CITATION_MIN_WORDS,
) -> dict:
    """Verify ``reasoning`` quotes the source (BUG-04, TC-09).

    True only when ``reasoning`` contains a span of ``min_words`` (default 5) or
    more consecutive words that also appear, in the same order, in
    ``source_text``. Comparison is case- and whitespace-normalised.

    Returns a dict::

        {"ok": bool, "span": str | None, "start": int | None, "end": int | None}

    where ``span`` is the matched text taken verbatim from ``source_text`` and
    ``start``/``end`` are its character offsets into ``source_text``. On no
    match, ``ok`` is False and the span/offsets are None.
    """
    result: dict[str, Any] = {"ok": False, "span": None, "start": None, "end": None}
    if not reasoning or not source_text:
        return result

    src_tokens = [
        (m.group(0).lower(), m.start(), m.end())
        for m in _WORD_RE.finditer(source_text)
    ]
    src_words = [tok[0] for tok in src_tokens]
    rea_words = reasoning.lower().split()
    if len(rea_words) < min_words or len(src_words) < min_words:
        return result

    # Index every source n-gram to its first start-token position.
    ngram_first: dict[tuple, int] = {}
    for j in range(len(src_words) - min_words + 1):
        gram = tuple(src_words[j : j + min_words])
        ngram_first.setdefault(gram, j)

    for i in range(len(rea_words) - min_words + 1):
        gram = tuple(rea_words[i : i + min_words])
        j = ngram_first.get(gram)
        if j is not None:
            start = src_tokens[j][1]
            end = src_tokens[j + min_words - 1][2]
            return {
                "ok": True,
                "span": source_text[start:end],
                "start": start,
                "end": end,
            }
    return result


def verify_record(record: dict, source_text: str = "") -> dict:
    """Run all evidence rules over a record; collect review reasons (no I/O).

    Returns ``{"review_reasons": [...], "citations": {...}}``. Only mutation is
    the likelihood cap from :func:`enforce_hypothesized_cap`. Never raises, so it
    is safe to call just before storing an extraction result; a failure in any
    single rule must never block storage.
    """
    reasons: list[str] = []
    citations: dict[str, Any] = {}

    if _defaulted_fields(record):
        reasons.append(EVIDENCE_DEFAULTS_REASON)

    cap = enforce_hypothesized_cap(record)
    if cap:
        reasons.append(cap)

    neg = check_mitigations_negative(record)
    if neg:
        reasons.append(neg)

    scoring = record.get("risk_scoring") if isinstance(record, dict) else None
    scoring = scoring if isinstance(scoring, dict) else {}
    for field in ("likelihood_reasoning", "impact_reasoning"):
        reasoning = scoring.get(field)
        if isinstance(reasoning, str) and reasoning.strip():
            cite = check_citation(reasoning, source_text)
            citations[field] = cite
            if source_text and not cite["ok"]:
                reasons.append(
                    f"Uncited {field}: no {_CITATION_MIN_WORDS}-word span found "
                    "in the source (BUG-04 / TC-09)"
                )

    return {"review_reasons": reasons, "citations": citations}
