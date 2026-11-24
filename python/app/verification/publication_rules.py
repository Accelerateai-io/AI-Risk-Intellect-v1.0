"""Publication checks from the deployment-readiness review.

These rules run on every extraction, including JSON-repair retries and a
later job retry that stores a new model output. They do not block storage.
A failed check is a review reason; the caller publishes only when every
check passes.

Each check separates what the source demonstrates from what a record infers:

* source support — a demonstrated finding must quote the source
* evidence labels — "demonstrated" is not used for a speculation
* risk classification — domain and risk labels agree with the explanation
* simulation scope — a simulation is not written as a real-world incident
* sensitive claims — healthcare and physical-safety harm need a source quote
  or an explicit hedge
"""

from __future__ import annotations

import re
from typing import Any, Optional

from app.verification.evidence_rules import check_citation

_WORD_RE = re.compile(r"[A-Za-z][A-Za-z0-9\-]{1,}")
_SENTENCE_RE = re.compile(r"[^.!?\n]+[.!?]?")
_SPECULATIVE_RE = re.compile(
    r"\b(could|might|may|perhaps|possibly|potential(?:ly)?|hypothes(?:is|ize|ise|ized)|"
    r"suggest(?:s|ed)?|possible consequence)\b",
    re.IGNORECASE,
)
_HEDGE_RE = re.compile(
    r"\b(could|might|may|perhaps|possibly|potential(?:ly)?|suggest(?:s|ed)?|"
    r"possible|if deployed|if used|conditional|would)\b",
    re.IGNORECASE,
)
_MEASURED_RE = re.compile(
    r"\d|(?:\b(?:measured|observed|experiment|simulation|percent|accuracy)\b)",
    re.IGNORECASE,
)
_SIMULATION_RE = re.compile(
    r"\b(simulations?|counterfactual|empirical estimates?|not certified|simulated)\b",
    re.IGNORECASE,
)
_REAL_WORLD_RE = re.compile(
    r"\b(real[- ]world (?:harm|incident|deployment|safety)|deployed incident|"
    r"patients were harmed|clinicians used|in clinical (?:use|practice)|"
    r"safety-critical equipment|certified probabilit(?:y|ies))\b",
    re.IGNORECASE,
)
_SENSITIVE_RE = re.compile(
    r"\b(patients?|clinicians?|clinical[- ]interpretation|clinical (?:harm|practice|use)|"
    r"mortality|diagnos\w*|healthcare|medical harm|physical (?:harm|injury|safety)|"
    r"loss of life|bodily harm|safety-critical)\b",
    re.IGNORECASE,
)
_PRIOR_RE = re.compile(
    r"prior work|previous work|previous studies|earlier work|et al\.?",
    re.IGNORECASE,
)
_DEMONSTRATED_CLAIM_RE = re.compile(
    r"\b(demonstrat\w*|this paper shows|the paper shows|established)\b",
    re.IGNORECASE,
)
_BROADER_PHRASES = (
    "flexible reasoning",
    "protected group",
    "protected-group",
    "fairness finding",
    "broader capability",
    "general reasoning ability",
)
_FAIRNESS_RE = re.compile(
    r"\b(fairness|protected[- ]group|demographic parity)\b",
    re.IGNORECASE,
)
_FAIRNESS_SOURCE_RE = re.compile(
    r"\b(fairness|protected[- ]group|demographic|bias|discriminat\w*)\b",
    re.IGNORECASE,
)
_ETHICAL_LABEL_RE = re.compile(r"ethical|discrimination|toxicity", re.IGNORECASE)
_ETHICAL_CUE_RE = re.compile(
    r"\b(bias|unfair|discriminat\w*|demographic|protected[- ]group|fairness|prejudice|toxic)\b",
    re.IGNORECASE,
)

_PRIMARY_OF_SECONDARY = {
    "security risk": "technical risks",
    "privacy risk": "technical risks",
    "technical/performance risk": "technical risks",
    "data risk": "technical risks",
    "operational risk": "operational risks",
    "compliance/regulatory risk": "operational risks",
    "legal/liability risk": "operational risks",
    "third-party/vendor risk": "operational risks",
    "business/financial risk": "business risks",
    "reputational risk": "business risks",
    "ethical risk": "business risks",
    "strategic risk": "business risks",
}

_DOMAIN_CUES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("discrimination", ("bias", "discrimination", "unfair", "prejudice", "toxic", "racist", "sexist")),
    ("privacy", ("privacy", "breach", "unauthorized", "leak", "exploit", "attack")),
    ("misinformation", ("hallucination", "misinformation", "deepfake", "fabricated")),
    ("malicious", ("malicious", "fraud", "cyberattack", "surveillance")),
    ("human-computer", ("overreliance", "automation bias", "agency", "dependency")),
    ("socioeconomic", ("inequality", "job loss", "displacement", "unemployment")),
    ("safety", ("failure", "limitation", "robustness", "unintended")),
)

_STOP = {
    "the", "and", "for", "with", "that", "this", "from", "into", "than", "when",
    "which", "their", "they", "them", "such", "also", "been", "being", "have",
    "has", "had", "was", "were", "are", "not", "but", "can", "its", "paper",
    "study", "result", "results", "shows", "showed", "shown", "demonstrated",
    "demonstrate", "risk", "model", "models",
}

_NARRATIVE_FIELDS = (
    "description",
    "risk_title",
    "attack_vector",
    "observable_indicators",
)


def _risk(record: dict) -> dict:
    risk = record.get("risk") if isinstance(record, dict) else None
    return risk if isinstance(risk, dict) else {}


def _scoring(record: dict) -> dict:
    scoring = record.get("risk_scoring") if isinstance(record, dict) else None
    return scoring if isinstance(scoring, dict) else {}


def _defaulted(record: dict) -> set[str]:
    meta = record.get("_meta") if isinstance(record, dict) else None
    fields = meta.get("defaulted_fields") if isinstance(meta, dict) else None
    if not isinstance(fields, list):
        return set()
    return {str(field) for field in fields}


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _narrative(record: dict) -> str:
    risk = _risk(record)
    scoring = _scoring(record)
    parts = [_text(risk.get(field)) for field in _NARRATIVE_FIELDS]
    parts.append(_text(risk.get("demonstrated_finding")))
    parts.append(_text(scoring.get("likelihood_reasoning")))
    parts.append(_text(scoring.get("impact_reasoning")))
    return "\n".join(part for part in parts if part)


def _explanation(record: dict) -> str:
    risk = _risk(record)
    scoring = _scoring(record)
    return " ".join(
        part
        for part in (
            _text(risk.get("description")),
            _text(scoring.get("likelihood_reasoning")),
            _text(scoring.get("impact_reasoning")),
        )
        if part
    )


def _matched_claim_supported(sentence: str, source: str, pattern: re.Pattern[str]) -> bool:
    """True when the harm phrase itself is in the source and the sentence quotes it.

    A five-word overlap on the rest of the sentence is not enough: the record
    can quote a measured result and then add an unsupported consequence.
    """
    match = pattern.search(sentence)
    if not match or not source:
        return False
    if match.group(0).lower() not in source.lower():
        return False
    return bool(check_citation(sentence, source).get("ok"))


def _sentences(text: str) -> list[str]:
    protected = re.sub(r"(\d)\.(\d)", r"\1<dot>\2", text or "")
    parts = _SENTENCE_RE.findall(protected)
    return [part.replace("<dot>", ".").strip() for part in parts if part.strip()]


def _check(name: str, reason: Optional[str]) -> dict[str, Any]:
    return {"name": name, "pass": reason is None, "reason": reason or ""}


def check_source_support(record: dict, source_text: str) -> Optional[str]:
    """A demonstrated finding must be a span of the source, not a paraphrase."""
    if not isinstance(record, dict):
        return None
    if "evidence_type" in _defaulted(record) or "demonstrated_finding" in _defaulted(record):
        return None
    risk = _risk(record)
    if _text(risk.get("evidence_type")).lower() != "demonstrated":
        return None
    finding = _text(risk.get("demonstrated_finding"))
    if not finding:
        return (
            "Evidence label mismatch: evidence_type is demonstrated without a "
            "demonstrated finding tied to the source."
        )
    if not source_text:
        return "Source support failed: no source text was available to check the finding."
    if len(finding.split()) < 5:
        return (
            "Evidence label mismatch: demonstrated_finding is too short to verify "
            "against the source."
        )
    if not check_citation(finding, source_text).get("ok"):
        return (
            "Source support failed: demonstrated_finding does not contain a "
            "five-word span from the source."
        )
    return None


def check_evidence_labels(record: dict, source_text: str = "") -> Optional[str]:
    """Do not label an inference, or a prior-work citation, as demonstrated."""
    del source_text  # the finding text itself carries the speculative wording
    if not isinstance(record, dict) or "evidence_type" in _defaulted(record):
        return None
    risk = _risk(record)
    if _text(risk.get("evidence_type")).lower() != "demonstrated":
        return None
    finding = _text(risk.get("demonstrated_finding"))
    if finding and _SPECULATIVE_RE.search(finding) and not _MEASURED_RE.search(finding):
        return (
            "Evidence label mismatch: demonstrated_finding is an inference and "
            "belongs in stated_implication."
        )
    return None


def check_risk_classification(record: dict, source_text: str = "") -> Optional[str]:
    """Domain, primary risk, and secondary risk must describe the explanation."""
    del source_text
    if not isinstance(record, dict):
        return None
    risk = _risk(record)
    primary = _text(risk.get("primary_risk")).lower()
    secondary = _text(risk.get("secondary_risks")).lower()
    if primary and secondary:
        expected = _PRIMARY_OF_SECONDARY.get(secondary)
        if expected and expected != primary:
            return (
                "Risk classification conflicts with the explanation: "
                f"'{risk.get('secondary_risks')}' is not a {risk.get('primary_risk')} label."
            )

    explanation = _explanation(record)
    if len(explanation) < 40:
        return None

    labels = " ".join(
        (
            _text(risk.get("domains")),
            _text(risk.get("secondary_risks")),
            _text(risk.get("primary_risk")),
        )
    )
    if _ETHICAL_LABEL_RE.search(labels) and not _ETHICAL_CUE_RE.search(explanation):
        return (
            "Risk classification conflicts with the explanation: the record is "
            "labeled as an ethical or discrimination risk, but the explanation "
            "does not describe unequal treatment."
        )

    domain = _text(risk.get("domains")).lower()
    if not domain:
        return None
    scores = {
        name: sum(1 for cue in cues if cue in explanation.lower())
        for name, cues in _DOMAIN_CUES
    }
    chosen = next((name for name, _cues in _DOMAIN_CUES if name in domain), None)
    if chosen is None:
        return (
            "Risk classification conflicts with the explanation: the domain "
            "is not one of the seven domains."
        )
    best_other = max((score for name, score in scores.items() if name != chosen), default=0)
    if scores.get(chosen, 0) == 0 and best_other >= 3:
        return (
            "Risk classification conflicts with the explanation: the domain "
            "does not match the harm described in the rationale."
        )
    return None


def check_simulation_scope(record: dict, source_text: str) -> Optional[str]:
    """A simulation or uncertified estimate is not a deployed incident."""
    if not isinstance(record, dict):
        return None
    source = source_text or ""
    narrative = _narrative(record)
    # "simulation" alone is common in related work. Hold only when this
    # record's own wording is a simulation, or the source describes the
    # result as a counterfactual or an uncertified empirical estimate.
    record_simulation = bool(_SIMULATION_RE.search(narrative))
    uncertified = bool(
        re.search(
            r"\b(counterfactual|empirical estimates?|not certified)\b",
            source[:6000] + "\n" + narrative,
            re.IGNORECASE,
        )
    )
    if not record_simulation and not uncertified:
        return None

    for sentence in _sentences(narrative):
        if not _REAL_WORLD_RE.search(sentence):
            continue
        if _HEDGE_RE.search(sentence):
            continue
        if _matched_claim_supported(sentence, source, _REAL_WORLD_RE):
            continue
        return (
            "Simulation result presented as a real-world or certified outcome. "
            "Label it as simulation-only and make real-world impact conditional."
        )

    scoring = _scoring(record)
    impact = scoring.get("impact")
    reasoning = _text(scoring.get("impact_reasoning"))
    if (
        isinstance(impact, int)
        and not isinstance(impact, bool)
        and impact >= 4
        and reasoning
        and not _HEDGE_RE.search(reasoning)
        and not _SIMULATION_RE.search(reasoning)
    ):
        return (
            "Simulation result assigned real-world impact. Impact must stay "
            "conditional on how the policy is used."
        )
    return None


def check_sensitive_claims(record: dict, source_text: str) -> Optional[str]:
    """Healthcare and physical-safety harm must be quoted or marked as inferred."""
    if not isinstance(record, dict):
        return None
    risk = _risk(record)
    scoring = _scoring(record)
    claim_text = "\n".join(
        part
        for part in (
            _text(risk.get("description")),
            _text(risk.get("demonstrated_finding")),
            _text(risk.get("risk_title")),
            _text(scoring.get("likelihood_reasoning")),
            _text(scoring.get("impact_reasoning")),
        )
        if part
    )
    for sentence in _sentences(claim_text):
        if not _SENSITIVE_RE.search(sentence):
            continue
        if _HEDGE_RE.search(sentence):
            continue
        if _matched_claim_supported(sentence, source_text, _SENSITIVE_RE):
            continue
        kind = (
            "physical-safety"
            if re.search(r"physical|loss of life|bodily|safety-critical", sentence, re.I)
            else "healthcare"
        )
        return (
            f"Unsupported {kind} claim: the record states harm the source does "
            "not show. Quote the source or mark it as a possible consequence."
        )
    return None


_TITLE_ABSOLUTE_RE = re.compile(
    r"\b(prevents?|preclud\w*|impossible|not possible|isn't possible|isnt possible|"
    r"scalability|real[- ]time|decision support)\b",
    re.IGNORECASE,
)


def unsupported_title_claim(title: str, source_text: str) -> Optional[str]:
    """An absolute title claim the source does not make.

    The title can name the measured limitation. It cannot say that limitation
    prevents a capability, or call it a scalability failure, unless the source
    uses those words.
    """
    text = title or ""
    source = (source_text or "").lower().replace("-", " ")
    for match in _TITLE_ABSOLUTE_RE.finditer(text):
        word = match.group(0).lower().replace("-", " ")
        if word not in source:
            return (
                "Title overstates the source: "
                f"'{match.group(0)}' is not a claim the source makes."
            )
    return None


def rewrite_overstated_title(title: str, source_text: str) -> str:
    """Drop an unsupported absolute clause from the title.

    The shortened title is kept only when it still names the subject.
    Otherwise the original title is left for the publication check to hold.
    """
    updated = title or ""
    if unsupported_title_claim(updated, source_text) is None:
        return updated
    source = (source_text or "").lower()
    if "scalability" not in source:
        updated = re.sub(r"\bscalability limitations\b", "", updated, flags=re.IGNORECASE)
        updated = re.sub(r"\bscalability\b", "", updated, flags=re.IGNORECASE)
    verb = re.search(
        r"\b(prevents?|preclud\w*|impossible|not possible|isn't possible|isnt possible)\b",
        updated,
        re.IGNORECASE,
    )
    if verb and updated[verb.start() :].lower() not in source.lower():
        updated = updated[: verb.start()]
    if re.search(r"\breal[- ]time\b|\bdecision support\b", updated, re.IGNORECASE):
        if "real time" not in source.replace("-", " "):
            updated = re.sub(r"\breal[- ]time\b", "", updated, flags=re.IGNORECASE)
        if "decision support" not in source:
            updated = re.sub(r"\bdecision support\b", "", updated, flags=re.IGNORECASE)
    updated = re.sub(r"\s{2,}", " ", updated)
    updated = re.sub(r"\s+([,.;])", r"\1", updated)
    updated = re.sub(r"\band\s+(and|in)\b", r"\1", updated, flags=re.IGNORECASE)
    updated = updated.strip(" ,;:-")
    if len(updated.split()) < 4:
        return title
    return updated


def check_title_overstatement(record: dict, source_text: str) -> Optional[str]:
    """Hold a title that states a capability the source does not deny."""
    if not isinstance(record, dict):
        return None
    return unsupported_title_claim(_text(_risk(record).get("risk_title")), source_text)


def check_claim_scope(record: dict, source_text: str) -> Optional[str]:
    """Keep claims inside the tasks the source tested, and attribute prior work."""
    if not isinstance(record, dict):
        return None
    narrative = _narrative(record)
    source = source_text or ""
    source_lower = source.lower()
    narrative_lower = narrative.lower()

    for phrase in _BROADER_PHRASES:
        if phrase in narrative_lower and phrase not in source_lower:
            return (
                "Claim extends beyond the tasks tested in the source "
                f"('{phrase}'). Keep the result inside the tested task."
            )

    if _FAIRNESS_RE.search(narrative) and not _FAIRNESS_SOURCE_RE.search(source):
        return (
            "Task-specific result presented as a protected-group fairness "
            "finding. The source does not test that claim."
        )

    attributed = check_prior_work_attribution(record, source)
    if attributed:
        return attributed
    return None


def check_prior_work_attribution(record: dict, source_text: str) -> Optional[str]:
    """A result that appears only beside a prior-work citation is not this paper's finding."""
    if not source_text or not isinstance(record, dict):
        return None
    risk = _risk(record)
    narrative = _narrative(record)
    if re.search(r"\b(prior|previous|earlier|cited)\b", narrative, re.IGNORECASE):
        return None
    demonstrated = _text(risk.get("evidence_type")).lower() == "demonstrated"
    if not demonstrated and not _DEMONSTRATED_CLAIM_RE.search(narrative):
        return None

    words = _WORD_RE.findall(narrative.lower())
    seen: set[str] = set()
    for index in range(len(words) - 3):
        gram_words = words[index : index + 4]
        content = [word for word in gram_words if word not in _STOP and len(word) >= 4]
        if len(content) < 2:
            continue
        gram = " ".join(gram_words)
        if gram in seen or gram not in source_text.lower():
            continue
        seen.add(gram)
        away_from_prior = False
        near_prior = False
        for match in re.finditer(re.escape(gram), source_text, re.IGNORECASE):
            window = source_text[max(0, match.start() - 90) : match.end() + 90]
            if _PRIOR_RE.search(window):
                near_prior = True
            else:
                away_from_prior = True
        if near_prior and not away_from_prior:
            return (
                "Prior-work finding stated as demonstrated in this source "
                f"('{gram}'). Attribute it to the cited work."
            )
    return None


def publication_review(record: dict, source_text: str = "") -> dict[str, Any]:
    """Run every publication check. Never raises."""
    spec = (
        ("source_support", check_source_support),
        ("evidence_labels", check_evidence_labels),
        ("risk_classification", check_risk_classification),
        ("simulation_scope", check_simulation_scope),
        ("sensitive_claims", check_sensitive_claims),
        ("claim_scope", check_claim_scope),
        ("title_overstatement", check_title_overstatement),
    )
    checks: list[dict[str, Any]] = []
    reasons: list[str] = []
    try:
        for name, fn in spec:
            reason = fn(record, source_text)
            checks.append(_check(name, reason))
            if reason:
                reasons.append(reason)
    except Exception as exc:  # a checker bug must not break extraction
        checks.append(_check("publication_rules", f"Publication checks did not finish: {exc}"[:200]))
        reasons.append(checks[-1]["reason"])
    return {
        "decision": "hold" if reasons else "publish",
        "checks": checks,
        "hold_reasons": reasons,
    }
