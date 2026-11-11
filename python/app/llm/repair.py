# app/repair.py
"""
Repair and validation utilities for the new 21-field risk schema.
"""
import re
from typing import List, Dict, Tuple, Optional
from datetime import datetime

from app.risk_processing.description_utils import (
    normalize_narrative_text,
    snippet_as_description,
)


SENTENCE_END = (".", "!", "?")


# ---------------------------------------------------------
# Taxonomy normalization
# ---------------------------------------------------------
# Production data analysis (data/risks-20260412-004617.xlsx, 6,066 rows)
# revealed many free-text variants of the same underlying enum value:
#
#   Risk_Type_Detected examples:
#     "Algorithmic Bias" (223 rows) vs "Algorithmic bias" (33) vs
#     "Bias and Discrimination" (33) vs "bias_and_discrimination"
#     "Technical/Performance Risk" (455) vs "Technical Performance Risk" (35)
#
# This normalizer collapses variants to a canonical form so downstream
# analytics, dedup, and OWASP catalog lookups work correctly.

# Canonical forms keyed by a fingerprint produced by `_fingerprint()`.
_RISK_TYPE_CANONICAL = {
    "algorithmicbias": "Algorithmic Bias",
    "biasdiscrimination": "Algorithmic Bias",
    "biasanddiscrimination": "Algorithmic Bias",
    "discriminationbias": "Algorithmic Bias",
    "technicalperformancerisk": "Technical/Performance Risk",
    "performancerisk": "Technical/Performance Risk",
    "technicalrisk": "Technical/Performance Risk",
    "systemfailure": "System Failure",
    "systemfailures": "System Failure",
    "misinformation": "Misinformation",
    "disinformation": "Misinformation",
    "hallucination": "Misinformation",
    "hallucinations": "Misinformation",
    "dataleak": "Data Leakage",
    "dataleakage": "Data Leakage",
    "privacyleakage": "Data Leakage",
    "privacybreach": "Data Leakage",
    "promptinjection": "Prompt Injection",
    "promptinjections": "Prompt Injection",
    "modelpoisoning": "Model Poisoning",
    "trainingdatapoisoning": "Model Poisoning",
    "extractionerror": "Extraction Error",
}


def _fingerprint(s: str) -> str:
    """Lowercase + alpha-only fingerprint for fuzzy enum matching.

    "Algorithmic Bias" / "Algorithmic bias" / "algorithmic-bias" all map to
    "algorithmicbias" so they collapse into a single canonical form.
    """
    if not isinstance(s, str):
        return ""
    return re.sub(r"[^a-z]", "", s.lower())


def _normalize_taxonomy_value(value: str, canonical_map: dict) -> str:
    """Return the canonical enum value for `value`, or the original if no match.

    Tries (in order):
      1. Exact fingerprint match against canonical_map keys
      2. rapidfuzz token-set ratio (if installed) for near-matches
      3. Fallback: return original string unchanged
    """
    if not isinstance(value, str) or not value.strip():
        return value
    fp = _fingerprint(value)
    if fp in canonical_map:
        return canonical_map[fp]
    # Optional fuzzy matching when rapidfuzz is available.
    try:
        from rapidfuzz import process, fuzz
        match = process.extractOne(
            fp, list(canonical_map.keys()), scorer=fuzz.token_set_ratio,
            score_cutoff=85,
        )
        if match:
            return canonical_map[match[0]]
    except ImportError:
        pass
    return value


def _coerce_int(x, default=0):
    try:
        return int(x)
    except Exception:
        return default


def _clamp01(x, default=0.5):
    try:
        v = float(x)
    except Exception:
        return float(default)
    if v < 0.0: return 0.0
    if v > 1.0: return 1.0
    return v


VALID_LOSS_CATEGORIES = [
    "Productivity",
    "Response",
    "Replacement",
    "Fines & Judgments",
    "Competitive Advantage",
    "Reputation",
]
_LOSS_CATEGORY_BY_FINGERPRINT = {
    _fingerprint(c): c for c in VALID_LOSS_CATEGORIES
}

_NULLISH_STRINGS = {"", "unknown", "n/a", "na", "none", "null", "not specified", "not applicable"}


def _clamp_scale_1_5(x) -> Optional[int]:
    """Coerce to an int on the 1-5 scale; None when there is no numeric signal."""
    if x is None or isinstance(x, bool):
        return None
    if isinstance(x, str):
        s = x.strip()
        if not s or s.lower() in _NULLISH_STRINGS:
            return None
        try:
            v = int(round(float(s)))
        except Exception:
            match = re.search(r"\b([1-5])\b", s)
            if not match:
                return None
            v = int(match.group(1))
        if v < 1:
            return 1
        if v > 5:
            return 5
        return v
    try:
        v = int(round(float(x)))
    except Exception:
        return None
    if v < 1:
        return 1
    if v > 5:
        return 5
    return v


def severity_band_from_score(score: Optional[int]) -> Optional[str]:
    if score is None:
        return None
    if score >= 17:
        return "Critical"
    if score >= 10:
        return "High"
    if score >= 5:
        return "Medium"
    return "Low"


def _repair_risk_scoring(scoring) -> dict:
    """Normalize the model's risk_scoring block; severity is always recomputed."""
    if not isinstance(scoring, dict):
        scoring = {}
    likelihood = _clamp_scale_1_5(scoring.get("likelihood"))
    impact = _clamp_scale_1_5(scoring.get("impact"))
    loss_categories = []
    raw_categories = scoring.get("loss_categories")
    if isinstance(raw_categories, list):
        for c in raw_categories:
            canonical = _LOSS_CATEGORY_BY_FINGERPRINT.get(_fingerprint(str(c)))
            if canonical and canonical not in loss_categories:
                loss_categories.append(canonical)
    severity = likelihood * impact if likelihood is not None and impact is not None else None
    return {
        "likelihood": likelihood,
        "likelihood_reasoning": str(scoring.get("likelihood_reasoning") or "").strip(),
        "impact": impact,
        "impact_reasoning": str(scoring.get("impact_reasoning") or "").strip(),
        "loss_categories": loss_categories,
        "severity_score": severity,
        "severity_band": severity_band_from_score(severity),
    }


def _clean_product(value) -> Optional[str]:
    """Strip placeholder product/vendor values down to None."""
    if not isinstance(value, str):
        return None
    v = value.strip()
    if v.lower() in _NULLISH_STRINGS:
        return None
    return v[:256]


_SILENCE_MITIGATION = "not described in source"


def _silence_mitigation_only(entries: list) -> bool:
    """True when every entry is the allowed absence phrase and the list is not empty."""
    if not entries:
        return False
    for entry in entries:
        if not isinstance(entry, str):
            return False
        norm = entry.strip().rstrip(".").strip().lower()
        if norm != _SILENCE_MITIGATION:
            return False
    return True


_METHOD_TOKEN_RE = re.compile(r"[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*")
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")


def _method_tokens(text: str) -> list[str]:
    """Case-folded words, with punctuation stripped and hyphenated compounds kept."""
    return [m.group(0).lower() for m in _METHOD_TOKEN_RE.finditer(text or "")]


def _quoted_method_sentence(proposed: str, source_text: str) -> Optional[str]:
    """Verbatim source sentence that describes a paraphrased proposed method.

    A paraphrase such as "two-stage framework with foundation-correspondence-guided
    grasp" shares no five-word span with the paper, so it must not be copied as
    a mitigation. A sentence qualifies only when it contains one of the proposal's
    hyphenated terms and at least one other content word from the proposal.
    """
    proposed_tokens = [t for t in _method_tokens(proposed) if len(t) >= 5]
    anchors = [t for t in proposed_tokens if "-" in t and len(t) >= 8]
    if not anchors or not source_text:
        return None
    best: Optional[str] = None
    best_score = 0
    for sentence in _SENTENCE_SPLIT_RE.split(source_text):
        sentence = sentence.strip()
        if len(sentence.split()) < 5:
            continue
        present = set(_method_tokens(sentence))
        anchor_hits = [t for t in anchors if t in present]
        if not anchor_hits:
            continue
        other_hits = [t for t in proposed_tokens if t not in anchors and t in present]
        if not other_hits:
            continue
        score = len(set(anchor_hits)) + len(set(other_hits))
        if score > best_score:
            best = sentence
            best_score = score
    return best


def _reconcile_cited_method(risk: dict, source_text: str) -> bool:
    """Replace a silence-only mitigation list when the source describes the method.

    Copies proposed_mitigation itself only when that string has a five-word
    source span. A paraphrase is not copied. When the paper still describes
    the method, the silence phrase is replaced by the verbatim source sentence.
    Does nothing when proposed_mitigation is empty, the list names a real
    safeguard, or the source does not describe the method.
    """
    proposed = risk.get("proposed_mitigation")
    if not isinstance(proposed, str) or not proposed.strip():
        return False
    mitigations = risk.get("mitigations_in_source")
    if not isinstance(mitigations, list) or not _silence_mitigation_only(mitigations):
        return False
    from app.verification.evidence_rules import check_citation

    source = source_text or ""
    if check_citation(proposed, source).get("ok"):
        risk["mitigations_in_source"] = [proposed.strip()]
        return True
    sentence = _quoted_method_sentence(proposed, source)
    if not sentence or not check_citation(sentence, source).get("ok"):
        return False
    risk["mitigations_in_source"] = [sentence]
    return True


def _repair_against_schema(obj: dict, source_text: str) -> dict:
    """Repair and validate extraction object against new 21-field schema."""
    obj = obj or {}
    risk = obj.get("risk") or {}
    controls = obj.get("controls") or []
    
    # Required fields for new schema (risk_id will be generated by backend)
    if not risk.get("risk_title") or len(risk.get("risk_title", "")) < 5:
        risk["risk_title"] = source_text[:100].strip() or "AI Risk Detected"
    
    desc = str(risk.get("description") or "").strip()
    if len(desc) < 10:
        risk["description"] = snippet_as_description(source_text)
    else:
        risk["description"] = normalize_narrative_text(desc)
    
    if not risk.get("attack_vector"):
        risk["attack_vector"] = "Attack vector to be determined"
    
    if not risk.get("observable_indicators"):
        risk["observable_indicators"] = "Indicators to be identified"
    
    if not risk.get("data_to_identify_risk"):
        risk["data_to_identify_risk"] = "Data requirements to be specified"
    
    if not risk.get("evidence_sources"):
        risk["evidence_sources"] = "Source article"
    
    if not risk.get("intent") or risk.get("intent") not in ["Malicious", "Accidental", "Systemic", "Unknown"]:
        risk["intent"] = "Unknown"
    
    if not risk.get("timing"):
        risk["timing"] = "Timing to be determined"
    
    if not risk.get("risk_type_detected"):
        risk["risk_type_detected"] = "AI Risk"
    else:
        # Collapse free-text variants ("Algorithmic Bias" / "Algorithmic bias" /
        # "Bias and Discrimination") into a single canonical form. See
        # _RISK_TYPE_CANONICAL above for the mapping rationale.
        risk["risk_type_detected"] = _normalize_taxonomy_value(
            risk["risk_type_detected"], _RISK_TYPE_CANONICAL
        )
    
    # Ensure primary_risk is one of the valid enum values
    VALID_PRIMARY = ["Technical Risks", "Operational Risks", "Business Risks"]
    PRIMARY_KEYWORD_MAP = {
        # Technical
        "technical": "Technical Risks", "performance": "Technical Risks",
        "security": "Technical Risks", "privacy": "Technical Risks",
        "data": "Technical Risks", "model": "Technical Risks",
        "ai": "Technical Risks", "system": "Technical Risks",
        "bias": "Technical Risks", "hallucin": "Technical Risks",
        "misinformation": "Technical Risks", "disinformation": "Technical Risks",
        "safety": "Technical Risks", "robustness": "Technical Risks",
        # Operational
        "operational": "Operational Risks", "compliance": "Operational Risks",
        "legal": "Operational Risks", "regulatory": "Operational Risks",
        "vendor": "Operational Risks", "third": "Operational Risks",
        # Business
        "business": "Business Risks", "financial": "Business Risks",
        "reputat": "Business Risks", "ethical": "Business Risks",
        "strateg": "Business Risks",
    }
    current_primary = risk.get("primary_risk") or ""
    if current_primary not in VALID_PRIMARY:
        lower = current_primary.lower()
        mapped = next((v for k, v in PRIMARY_KEYWORD_MAP.items() if k in lower), "Technical Risks")
        risk["primary_risk"] = mapped
    
    if not risk.get("secondary_risks") or risk.get("secondary_risks") in ["None", "SECONDARY_RISKS", "string"]:
        risk["secondary_risks"] = "Technical/Performance Risk"
    
    # Validate that secondary risk matches primary category
    primary = risk.get("primary_risk")
    secondary = risk.get("secondary_risks")
    
    # Define valid mappings
    valid_secondary_for_primary = {
        "Technical Risks": [
            "Security Risk",
            "Privacy Risk", 
            "Technical/Performance Risk",
            "Data Risk"
        ],
        "Operational Risks": [
            "Compliance/Regulatory Risk",
            "Legal/Liability Risk",
            "Third-Party/Vendor Risk"
        ],
        "Business Risks": [
            "Business/Financial Risk",
            "Reputational Risk",
            "Ethical Risk",
            "Strategic Risk"
        ]
    }
    
    # Fix mismatched secondary risks
    if primary in valid_secondary_for_primary:
        if secondary not in valid_secondary_for_primary[primary]:
            # Secondary doesn't match primary - fix it
            if primary == "Technical Risks":
                risk["secondary_risks"] = "Technical/Performance Risk"
            elif primary == "Operational Risks":
                risk["secondary_risks"] = "Compliance/Regulatory Risk"
            elif primary == "Business Risks":
                risk["secondary_risks"] = "Business/Financial Risk"
    
    # Fix domains if it's an array (LLM mistake) - take first value
    domains = risk.get("domains")
    if isinstance(domains, list):
        risk["domains"] = domains[0] if domains else "7. AI System Safety, Failures, & Limitations"
    elif not domains or domains == "None" or domains in ["DOMAIN", "DOMAINS", "string"]:
        risk["domains"] = "7. AI System Safety, Failures, & Limitations"
    
    # Add sector and industry if missing (required fields)
    if not risk.get("sector") or risk.get("sector") not in ["Public", "Private", "Non-Profit"]:
        risk["sector"] = "Private"  # Default to Private sector
    
    if not risk.get("industry") or len(risk.get("industry", "")) < 3:
        # Default industry based on sector
        if risk.get("sector") == "Public":
            risk["industry"] = "Federal Government (US)"
        elif risk.get("sector") == "Non-Profit":
            risk["industry"] = "Research & Think Tanks"
        else:
            risk["industry"] = "Technology & Software"
    
    # Evidence-discipline fields required by the schema (BUG-01/02/03). Backfill
    # conservative defaults so a model output that omits them still validates and
    # is stored; the evidence rules may then add a review reason. The only
    # permitted negative for mitigations is "not described in source".
    _VALID_SOURCE_TYPES = {
        "empirical_study", "position_paper", "survey",
        "incident_report", "news", "vendor_doc",
    }
    _VALID_EVIDENCE_TYPES = {"demonstrated", "hypothesized", "mitigation_target"}
    _VALID_PAPER_STANCES = {
        "documents_problem", "proposes_mitigation", "evaluates_system",
        "surveys", "not_applicable",
    }
    defaulted_fields: List[str] = []
    if risk.get("source_type") not in _VALID_SOURCE_TYPES:
        risk["source_type"] = "position_paper"
        defaulted_fields.append("source_type")
    if risk.get("evidence_type") not in _VALID_EVIDENCE_TYPES:
        # Conservative default: treat unknown evidence as hypothesized.
        risk["evidence_type"] = "hypothesized"
        defaulted_fields.append("evidence_type")
    if risk.get("paper_stance") not in _VALID_PAPER_STANCES:
        risk["paper_stance"] = "documents_problem"
        defaulted_fields.append("paper_stance")
    if "demonstrated_finding" not in risk:
        risk["demonstrated_finding"] = None
        defaulted_fields.append("demonstrated_finding")
    if "stated_implication" not in risk:
        risk["stated_implication"] = None
        defaulted_fields.append("stated_implication")
    if "proposed_mitigation" not in risk:
        risk["proposed_mitigation"] = None
        defaulted_fields.append("proposed_mitigation")
    mits = risk.get("mitigations_in_source")
    if isinstance(mits, str):
        mits = [mits]
    cleaned_mits = [m for m in mits if isinstance(m, str) and m.strip()] if isinstance(mits, list) else []
    if not cleaned_mits:
        risk["mitigations_in_source"] = ["not described in source"]
        defaulted_fields.append("mitigations_in_source")
    else:
        risk["mitigations_in_source"] = cleaned_mits

    # A silence phrase next to a method that is actually quoted in the source is a
    # contradiction, not evidence of absence. Replace only that case. A genuine
    # "not described in source" list stays when the method is missing or unquoted.
    if _reconcile_cited_method(risk, source_text):
        if "mitigations_in_source" in defaulted_fields:
            defaulted_fields.remove("mitigations_in_source")
        meta = obj.setdefault("_meta", {})
        if not isinstance(meta, dict):
            meta = {}
            obj["_meta"] = meta
        meta["mitigations_reconciled"] = True

    # Record which evidence fields were defaulted so the extraction path can
    # route the record to review and skip the likelihood cap for a defaulted
    # evidence_type (an artificial default must not silently lower a real score).
    if defaulted_fields:
        meta = obj.setdefault("_meta", {})
        if not isinstance(meta, dict):
            meta = {}
            obj["_meta"] = meta
        existing = meta.get("defaulted_fields") or []
        if not isinstance(existing, list):
            existing = []
        meta["defaulted_fields"] = existing + [
            f for f in defaulted_fields if f not in existing
        ]

    # Controls with clamped scores
    fixed_controls: List[Dict] = []
    if isinstance(controls, list):
        for c in controls:
            fixed_controls.append({
                "control_ref": (c.get("control_ref") or "GEN-000"),
                "name": (c.get("name") or "General mitigations"),
                "why": (c.get("why") or "Addresses the identified risk with standard safeguards."),
                "score": _clamp01(c.get("score"), default=0.5),
            })
    
    # If no controls, add a default one
    if not fixed_controls:
        fixed_controls = [{
            "control_ref": "GEN-000",
            "name": "General risk mitigation",
            "why": "Standard safeguards to address identified risk",
            "score": 0.5
        }]
    
    # Facts-only contract (workflow v2). Drop self-grading if the model still
    # emits it so a fabricated total_score cannot become the quality gate.
    # Rows already stored are not rewritten by this function.
    obj.pop("analysis", None)
    obj.pop("justification", None)
    if isinstance(risk, dict):
        risk.pop("matching_keywords", None)

    obj["risk_scoring"] = _repair_risk_scoring(obj.get("risk_scoring"))

    risk["ai_product_name"] = _clean_product(risk.get("ai_product_name"))
    risk["ai_product_vendor"] = (
        _clean_product(risk.get("ai_product_vendor"))
        if risk["ai_product_name"] is not None
        else None
    )

    obj["risk"] = risk
    obj["controls"] = fixed_controls
    meta = obj.setdefault("_meta", {})
    if not isinstance(meta, dict):
        meta = {}
        obj["_meta"] = meta
    meta["extraction_contract"] = "facts_v2"
    return obj

# --- Compatibility shim for local_llm.generate_json() ---
def repair_extraction_obj(obj: dict, source_text: str, schema: dict = None) -> dict:
    """
    Backwards-compatible wrapper so callers can import `repair_extraction_obj`.
    `schema` is currently unused by the repair logic.
    """
    return _repair_against_schema(obj, source_text)
