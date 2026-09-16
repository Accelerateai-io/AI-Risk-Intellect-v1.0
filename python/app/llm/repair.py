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


def _self_assessment_reasoning_present(self_assessment: dict) -> bool:
    for key in (
        "context_clarity_reasoning",
        "keyword_reasoning",
        "tagging_reasoning",
        "evidence_reasoning",
    ):
        if str(self_assessment.get(key) or "").strip():
            return True
    return False


def _sum_self_assessment_subscores(self_assessment: dict) -> int:
    return (
        _coerce_int(self_assessment.get("context_clarity_score"), 0)
        + _coerce_int(self_assessment.get("keyword_score"), 0)
        + _coerce_int(self_assessment.get("tagging_accuracy_score"), 0)
        + _coerce_int(self_assessment.get("evidence_strength_score"), 0)
    )


def _apply_default_self_assessment_scores(self_assessment: dict) -> None:
    self_assessment["context_clarity_score"] = 30
    self_assessment["context_clarity_reasoning"] = "Default reasoning"
    self_assessment["keyword_score"] = 10
    self_assessment["keyword_reasoning"] = "Default keyword analysis"
    self_assessment["tagging_accuracy_score"] = 15
    self_assessment["tagging_reasoning"] = "Default tagging analysis"
    self_assessment["evidence_strength_score"] = 10
    self_assessment["evidence_reasoning"] = "Default evidence analysis"
    self_assessment["evidence_strength_breakdown"] = {
        "directness": 3,
        "specificity": 3,
        "taxonomy_alignment": 3,
    }
    self_assessment["total_score"] = min(100, _sum_self_assessment_subscores(self_assessment))

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


def _repair_against_schema(obj: dict, source_text: str) -> dict:
    """Repair and validate extraction object against new 21-field schema."""
    obj = obj or {}
    risk = obj.get("risk") or {}
    controls = obj.get("controls") or []
    analysis = obj.get("analysis") or {}
    justification = obj.get("justification") or {}
    
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
    
    # Fix justification field structure
    if not isinstance(justification, dict):
        justification = {}
    
    # Fix self_assessment
    self_assessment = justification.get("self_assessment") or {}
    if not isinstance(self_assessment, dict):
        self_assessment = {}
    
    # Fix total_score - must be integer
    total_score = self_assessment.get("total_score", 0)
    self_assessment["total_score"] = _coerce_int(total_score, default=0)
    
    # Add missing score fields with defaults
    if "context_clarity_score" not in self_assessment:
        self_assessment["context_clarity_score"] = 30
    if "context_clarity_reasoning" not in self_assessment:
        self_assessment["context_clarity_reasoning"] = "Default reasoning"
    
    if "keyword_score" not in self_assessment:
        self_assessment["keyword_score"] = 10
    if "keyword_reasoning" not in self_assessment:
        self_assessment["keyword_reasoning"] = "Default keyword analysis"
    
    if "tagging_accuracy_score" not in self_assessment:
        self_assessment["tagging_accuracy_score"] = 15
    if "tagging_reasoning" not in self_assessment:
        self_assessment["tagging_reasoning"] = "Default tagging analysis"
    
    if "evidence_strength_score" not in self_assessment:
        self_assessment["evidence_strength_score"] = 10
    if "evidence_reasoning" not in self_assessment:
        self_assessment["evidence_reasoning"] = "Default evidence analysis"
    
    if "evidence_strength_breakdown" not in self_assessment:
        self_assessment["evidence_strength_breakdown"] = {
            "directness": 3,
            "specificity": 3,
            "taxonomy_alignment": 3
        }

    sub_sum = _sum_self_assessment_subscores(self_assessment)
    total = _coerce_int(self_assessment.get("total_score"), 0)
    if (
        total <= 0
        and sub_sum <= 0
        and not _self_assessment_reasoning_present(self_assessment)
    ):
        _apply_default_self_assessment_scores(self_assessment)
    elif total <= 0 and sub_sum > 0:
        self_assessment["total_score"] = min(100, sub_sum)
    
    # Fix confidence_level - must be 'high', 'medium', or 'low' (REQUIRED)
    confidence = self_assessment.get("confidence_level", "medium")
    if confidence not in ["high", "medium", "low"]:
        self_assessment["confidence_level"] = "medium"
    else:
        self_assessment["confidence_level"] = confidence
    
    justification["self_assessment"] = self_assessment
    
    # Ensure other required justification fields exist
    if not justification.get("decision_rationale"):
        justification["decision_rationale"] = "Risk classification based on article content"
    
    if not justification.get("taxonomy_mapping"):
        justification["taxonomy_mapping"] = {
            "domain_match": {
                "chosen_domain": risk.get("domains", "7. AI System Safety, Failures, & Limitations"),
                "evidence_excerpts": [],
                "keyword_matches": [],
                "confidence_reasoning": "Default classification"
            },
            "primary_risk_match": {
                "chosen_primary": risk.get("primary_risk", "Technical Risks"),
                "evidence_excerpts": [],
                "keyword_matches": [],
                "confidence_reasoning": "Default classification"
            },
            "secondary_risk_match": {
                "chosen_secondary": risk.get("secondary_risks", "Technical/Performance Risk"),
                "evidence_excerpts": [],
                "keyword_matches": [],
                "confidence_reasoning": "Default classification"
            }
        }
    
    if not justification.get("evidence_breakdown"):
        justification["evidence_breakdown"] = []
    
    # Fix analysis field (risk-specific reasoning)
    if not isinstance(analysis, dict):
        analysis = {}
    
    if not analysis.get("risk_identified"):
        analysis["risk_identified"] = f"Risk identified: {risk.get('risk_title', 'AI Risk')}"
    
    if not analysis.get("article_context"):
        analysis["article_context"] = "Article describes an AI-related incident or risk scenario."
    
    if not analysis.get("alignment_reasoning"):
        analysis["alignment_reasoning"] = "Risk classification aligns with article content and taxonomy."

    obj["risk_scoring"] = _repair_risk_scoring(obj.get("risk_scoring"))

    risk["ai_product_name"] = _clean_product(risk.get("ai_product_name"))
    risk["ai_product_vendor"] = (
        _clean_product(risk.get("ai_product_vendor"))
        if risk["ai_product_name"] is not None
        else None
    )

    obj["analysis"] = analysis
    obj["justification"] = justification
    obj["risk"] = risk
    obj["controls"] = fixed_controls
    return obj

# --- Compatibility shim for local_llm.generate_json() ---
def repair_extraction_obj(obj: dict, source_text: str, schema: dict = None) -> dict:
    """
    Backwards-compatible wrapper so callers can import `repair_extraction_obj`.
    `schema` is currently unused by the repair logic.
    """
    return _repair_against_schema(obj, source_text)
