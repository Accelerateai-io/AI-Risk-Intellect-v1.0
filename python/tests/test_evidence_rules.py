"""Evidence-discipline rules and grounding-prompt tests (BUG-01/02/03/18/21).

Covers: TC-02 (schema rejects missing evidence_type), TC-06 ("not described in
source" is the only allowed negative), TC-08 (paper_stance enum enforced),
TC-09 (severity reasoning must contain a verifiable quote), the hypothesized
likelihood cap, and TC-43/TC-40 (prompt carries the 12 secondary categories and
the "not described in source" phrase).
"""

from __future__ import annotations

from pathlib import Path

import pytest
from jsonschema import ValidationError, validate

from app.llm.repair import repair_extraction_obj
from app.verification.evidence_rules import (
    ALLOWED_NEGATIVE,
    EVIDENCE_DEFAULTS_REASON,
    HYPOTHESIZED_CAP_REASON,
    check_citation,
    check_mitigations_negative,
    enforce_hypothesized_cap,
    verify_record,
)

_PROMPT_PATH = Path(__file__).resolve().parent.parent / "app" / "llm" / "system_prompt.txt"
_SCHEMA_PATH = (
    Path(__file__).resolve().parent.parent
    / "app"
    / "schemas"
    / "risk_extraction.schema.json"
)

SECONDARY_CATEGORIES = [
    "Security Risk",
    "Privacy Risk",
    "Technical/Performance Risk",
    "Data Risk",
    "Operational Risk",
    "Compliance/Regulatory Risk",
    "Legal/Liability Risk",
    "Third-Party/Vendor Risk",
    "Business/Financial Risk",
    "Reputational Risk",
    "Ethical Risk",
    "Strategic Risk",
]


def _load_schema() -> dict:
    import json

    with _SCHEMA_PATH.open(encoding="utf-8") as f:
        return json.load(f)


def _valid_record() -> dict:
    return {
        "risk": {
            "risk_title": "A grounded example risk title",
            "domains": "7. AI System Safety, Failures, & Limitations",
            "description": "A concise, source-grounded description of the risk.",
            "source_type": "empirical_study",
            "evidence_type": "demonstrated",
            "demonstrated_finding": "Accuracy dropped three percent in tests.",
            "stated_implication": None,
            "paper_stance": "documents_problem",
            "proposed_mitigation": None,
            "mitigations_in_source": ["not described in source"],
        },
        "risk_scoring": {
            "likelihood": 2,
            "likelihood_reasoning": "",
            "impact": 2,
            "impact_reasoning": "",
            "loss_categories": [],
        },
        "controls": [],
        "justification": {},
    }


# --------------------------------------------------------------------------
# TC-02: the schema rejects a record that is missing evidence_type.
# --------------------------------------------------------------------------
def test_tc02_schema_accepts_complete_record() -> None:
    validate(_valid_record(), _load_schema())


def test_facts_v2_schema_does_not_require_self_grading() -> None:
    schema = _load_schema()
    assert "justification" not in schema["required"]
    assert "analysis" not in schema["properties"]
    assert "justification" not in schema["properties"]
    record = _valid_record()
    record.pop("justification", None)
    validate(record, schema)


def test_facts_v2_prompt_asks_for_facts_not_self_grading() -> None:
    prompt = _PROMPT_PATH.read_text(encoding="utf-8")
    schema = prompt.split("=== OUTPUT SCHEMA ===", 1)[1]
    for banned in (
        "decision_rationale",
        "taxonomy_mapping",
        "evidence_breakdown",
        "self_assessment",
        "context_clarity_score",
        "matching_keywords",
    ):
        assert banned not in schema, banned
    assert "SELF-ASSESSMENT" not in prompt
    assert "Do not return analysis, justification" in prompt
    for kept in (
        "risk_title",
        "primary_risk",
        "secondary_risks",
        "likelihood_reasoning",
        "impact_reasoning",
        "loss_categories",
        "ai_product_name",
        "ai_product_vendor",
        "demonstrated_finding",
        "mitigations_in_source",
        "not described in source",
        "representability result",
        "unpredictable",
        "CAPTCHA-solving accuracy",
        "account takeover",
    ):
        assert kept in prompt, kept


def test_repair_strips_self_grading_and_keeps_facts() -> None:
    obj = {
        "risk": {
            "risk_title": "A grounded example risk title",
            "description": "A concise, source-grounded description of the risk.",
            "domains": "2. Privacy & Security",
            "primary_risk": "Technical Risks",
            "secondary_risks": "Privacy Risk",
            "sector": "Private",
            "industry": "Technology & Software",
            "intent": "Accidental",
            "source_type": "empirical_study",
            "evidence_type": "demonstrated",
            "demonstrated_finding": "Accuracy dropped three percent in tests.",
            "stated_implication": None,
            "paper_stance": "documents_problem",
            "proposed_mitigation": None,
            "mitigations_in_source": ["human review"],
            "ai_product_name": "ExampleModel",
            "ai_product_vendor": "ExampleCo",
        },
        "risk_scoring": {
            "likelihood": 2,
            "likelihood_reasoning": "Accuracy dropped three percent in tests.",
            "impact": 2,
            "impact_reasoning": "Accuracy dropped three percent in tests.",
            "loss_categories": ["Reputation"],
        },
        "controls": [],
        "analysis": {"risk_identified": "should be dropped"},
        "justification": {"self_assessment": {"total_score": 99}},
    }
    repaired = repair_extraction_obj(obj, "Accuracy dropped three percent in tests.")
    assert "analysis" not in repaired
    assert "justification" not in repaired
    assert repaired["_meta"]["extraction_contract"] == "facts_v2"
    assert repaired["risk"]["risk_title"] == "A grounded example risk title"
    assert repaired["risk"]["ai_product_name"] == "ExampleModel"
    assert repaired["risk"]["evidence_type"] == "demonstrated"
    assert repaired["risk_scoring"]["likelihood"] == 2
    assert repaired["risk_scoring"]["loss_categories"] == ["Reputation"]


def test_tc02_schema_rejects_missing_evidence_type() -> None:
    record = _valid_record()
    del record["risk"]["evidence_type"]
    with pytest.raises(ValidationError):
        validate(record, _load_schema())


def test_tc02_schema_rejects_bad_evidence_type_enum() -> None:
    record = _valid_record()
    record["risk"]["evidence_type"] = "guessed"
    with pytest.raises(ValidationError):
        validate(record, _load_schema())


# --------------------------------------------------------------------------
# TC-08: paper_stance enum is enforced by the schema.
# --------------------------------------------------------------------------
def test_tc08_schema_rejects_bad_paper_stance() -> None:
    record = _valid_record()
    record["risk"]["paper_stance"] = "makes_stuff_up"
    with pytest.raises(ValidationError):
        validate(record, _load_schema())


def test_tc08_schema_rejects_missing_paper_stance() -> None:
    record = _valid_record()
    del record["risk"]["paper_stance"]
    with pytest.raises(ValidationError):
        validate(record, _load_schema())


# --------------------------------------------------------------------------
# TC-06: "not described in source" is the only allowed negative mitigation.
# --------------------------------------------------------------------------
def test_tc06_allowed_negative_passes() -> None:
    record = _valid_record()
    record["risk"]["mitigations_in_source"] = ["not described in source"]
    assert check_mitigations_negative(record) is None


def test_tc06_real_mitigation_passes() -> None:
    record = _valid_record()
    record["risk"]["mitigations_in_source"] = [
        "Differential privacy with epsilon 3",
        "Human review before deployment",
    ]
    assert check_mitigations_negative(record) is None


@pytest.mark.parametrize(
    "bad",
    [
        "none",
        "No safeguards",
        "safeguards are absent",
        "oversight not present",
        "the system lacks guardrails",
        "no mitigations described",
    ],
)
def test_tc06_absence_from_silence_is_rejected(bad: str) -> None:
    record = _valid_record()
    record["risk"]["mitigations_in_source"] = [bad]
    reason = check_mitigations_negative(record)
    assert reason is not None
    assert ALLOWED_NEGATIVE in reason


def test_tc06_allowed_negative_tolerates_trailing_period() -> None:
    record = _valid_record()
    record["risk"]["mitigations_in_source"] = ["Not described in source."]
    assert check_mitigations_negative(record) is None


# --------------------------------------------------------------------------
# TC-09: severity reasoning must contain a verifiable quote from the source.
# --------------------------------------------------------------------------
SOURCE = (
    "In controlled tests on three large language models, the measured accuracy "
    "dropped three percent when inputs differed from the training distribution."
)


def test_tc09_citation_matches_five_word_span() -> None:
    reasoning = "The authors report that measured accuracy dropped three percent on shifted inputs."
    result = check_citation(reasoning, SOURCE)
    assert result["ok"] is True
    assert result["span"] is not None
    # Offsets point at the matched span inside the source text.
    assert SOURCE[result["start"] : result["end"]].lower() == result["span"].lower()
    assert "accuracy dropped three percent" in result["span"].lower()


def test_tc09_citation_rejects_uncited_reasoning() -> None:
    reasoning = "This risk is extremely dangerous and will certainly destroy the company."
    result = check_citation(reasoning, SOURCE)
    assert result["ok"] is False
    assert result["span"] is None
    assert result["start"] is None


def test_tc09_citation_requires_five_consecutive_words() -> None:
    # Four shared words in a row is not enough.
    reasoning = "measured accuracy dropped three on unrelated data entirely"
    result = check_citation(reasoning, SOURCE)
    assert result["ok"] is False


def test_tc09_citation_is_case_and_whitespace_normalised() -> None:
    reasoning = "MEASURED   ACCURACY\nDROPPED  THREE   PERCENT here"
    assert check_citation(reasoning, SOURCE)["ok"] is True


def test_tc09_verify_record_flags_uncited_reasoning() -> None:
    record = _valid_record()
    record["risk_scoring"]["likelihood_reasoning"] = (
        "Totally invented consequence with no basis in the text whatsoever here."
    )
    out = verify_record(record, SOURCE)
    assert any("Uncited likelihood_reasoning" in r for r in out["review_reasons"])
    assert out["citations"]["likelihood_reasoning"]["ok"] is False


# --------------------------------------------------------------------------
# Hypothesized likelihood cap (BUG-01).
# --------------------------------------------------------------------------
def test_cap_lowers_hypothesized_likelihood_above_two() -> None:
    record = _valid_record()
    record["risk"]["evidence_type"] = "hypothesized"
    record["risk_scoring"]["likelihood"] = 5
    reason = enforce_hypothesized_cap(record)
    assert reason == HYPOTHESIZED_CAP_REASON
    assert record["risk_scoring"]["likelihood"] == 2


def test_cap_leaves_demonstrated_likelihood_untouched() -> None:
    record = _valid_record()
    record["risk"]["evidence_type"] = "demonstrated"
    record["risk_scoring"]["likelihood"] = 5
    assert enforce_hypothesized_cap(record) is None
    assert record["risk_scoring"]["likelihood"] == 5


def test_cap_noop_when_hypothesized_already_within_cap() -> None:
    record = _valid_record()
    record["risk"]["evidence_type"] = "hypothesized"
    record["risk_scoring"]["likelihood"] = 2
    assert enforce_hypothesized_cap(record) is None
    assert record["risk_scoring"]["likelihood"] == 2


def test_verify_record_applies_cap_and_reports_reason() -> None:
    record = _valid_record()
    record["risk"]["evidence_type"] = "hypothesized"
    record["risk_scoring"]["likelihood"] = 4
    out = verify_record(record, SOURCE)
    assert HYPOTHESIZED_CAP_REASON in out["review_reasons"]
    assert record["risk_scoring"]["likelihood"] == 2


# --------------------------------------------------------------------------
# Defaulted evidence fields (repair backfill) — _meta.defaulted_fields,
# the "defaults applied" review reason, and the cap skip.
# --------------------------------------------------------------------------
def test_repair_records_defaulted_evidence_fields() -> None:
    obj = {"risk": {"risk_title": "x"}, "controls": [], "justification": {}}
    repaired = repair_extraction_obj(obj, "some source text about an AI system")
    defaulted = repaired["_meta"]["defaulted_fields"]
    for field in (
        "source_type",
        "evidence_type",
        "paper_stance",
        "demonstrated_finding",
        "stated_implication",
        "proposed_mitigation",
        "mitigations_in_source",
    ):
        assert field in defaulted


def test_repair_does_not_flag_fields_the_model_supplied() -> None:
    obj = {
        "risk": {
            "risk_title": "x",
            "source_type": "empirical_study",
            "evidence_type": "demonstrated",
            "paper_stance": "evaluates_system",
            "demonstrated_finding": "accuracy fell",
            "stated_implication": None,
            "proposed_mitigation": None,
            "mitigations_in_source": ["human review"],
        },
        "controls": [],
        "justification": {},
    }
    repaired = repair_extraction_obj(obj, "source text")
    assert "evidence_type" not in repaired.get("_meta", {}).get("defaulted_fields", [])


def test_verify_record_reports_defaults_applied_reason() -> None:
    obj = {"risk": {"risk_title": "x"}, "controls": [], "justification": {}}
    repaired = repair_extraction_obj(obj, "some source text about an AI system")
    out = verify_record(repaired, "some source text about an AI system")
    assert EVIDENCE_DEFAULTS_REASON in out["review_reasons"]


def test_cap_skipped_when_evidence_type_was_defaulted() -> None:
    # evidence_type defaulted to "hypothesized" — must NOT lower a real score.
    record = _valid_record()
    record["risk"]["evidence_type"] = "hypothesized"
    record["risk_scoring"]["likelihood"] = 5
    record["_meta"] = {"defaulted_fields": ["evidence_type"]}
    assert enforce_hypothesized_cap(record) is None
    assert record["risk_scoring"]["likelihood"] == 5


def test_cap_still_applies_when_evidence_type_was_model_provided() -> None:
    record = _valid_record()
    record["risk"]["evidence_type"] = "hypothesized"
    record["risk_scoring"]["likelihood"] = 5
    record["_meta"] = {"defaulted_fields": ["source_type"]}  # not evidence_type
    assert enforce_hypothesized_cap(record) == HYPOTHESIZED_CAP_REASON
    assert record["risk_scoring"]["likelihood"] == 2


def test_verify_record_skips_cap_for_defaulted_evidence_type() -> None:
    record = _valid_record()
    record["risk"]["evidence_type"] = "hypothesized"
    record["risk_scoring"]["likelihood"] = 4
    record["_meta"] = {"defaulted_fields": ["evidence_type"]}
    out = verify_record(record, SOURCE)
    assert HYPOTHESIZED_CAP_REASON not in out["review_reasons"]
    assert EVIDENCE_DEFAULTS_REASON in out["review_reasons"]
    assert record["risk_scoring"]["likelihood"] == 4


def test_rules_never_raise_on_garbage_input() -> None:
    assert enforce_hypothesized_cap(None) is None  # type: ignore[arg-type]
    assert check_mitigations_negative({"risk": {"mitigations_in_source": 7}}) is None
    assert check_citation("", "") == {
        "ok": False,
        "span": None,
        "start": None,
        "end": None,
    }


# --------------------------------------------------------------------------
# TC-43 / TC-40: the prompt carries the AI-Q secondary categories (all 12,
# including Operational Risk) and the "not described in source" phrase.
# --------------------------------------------------------------------------
def test_tc43_prompt_contains_all_twelve_secondary_categories() -> None:
    prompt = _PROMPT_PATH.read_text(encoding="utf-8")
    missing = [name for name in SECONDARY_CATEGORIES if name not in prompt]
    assert missing == [], f"prompt is missing secondary categories: {missing}"


def test_tc40_prompt_mentions_operational_risk_secondary() -> None:
    prompt = _PROMPT_PATH.read_text(encoding="utf-8")
    # Operational Risk as its own secondary line (BUG-16/TC-40), distinct from
    # the "Operational Risks" primary heading.
    assert "- Operational Risk:" in prompt


def test_tc40_prompt_contains_not_described_in_source_phrase() -> None:
    prompt = _PROMPT_PATH.read_text(encoding="utf-8")
    assert "not described in source" in prompt


# --------------------------------------------------------------------------
# R-28 mitigation reconciliation and unsupported-harm reasons.
# The verifier prompt and its four checks stay as they are.
# --------------------------------------------------------------------------
def test_repair_empty_mitigations_still_mean_absent() -> None:
    repaired = repair_extraction_obj(
        {"risk": {"risk_title": "A paper with no method"}, "controls": [], "justification": {}},
        "an AI paper with no method described here at all",
    )
    assert repaired["risk"]["proposed_mitigation"] is None
    assert repaired["risk"]["mitigations_in_source"] == ["not described in source"]
    assert "mitigations_in_source" in repaired["_meta"]["defaulted_fields"]
    assert repaired["_meta"].get("mitigations_reconciled") is not True


def test_repair_keeps_model_silence_phrase_when_no_method() -> None:
    repaired = repair_extraction_obj(
        {
            "risk": {
                "risk_title": "No safeguards in this paper",
                "source_type": "empirical_study",
                "evidence_type": "demonstrated",
                "paper_stance": "documents_problem",
                "demonstrated_finding": "accuracy fell",
                "stated_implication": None,
                "proposed_mitigation": None,
                "mitigations_in_source": ["not described in source"],
            },
            "controls": [],
            "justification": {},
        },
        "source text with enough words but no method quote here",
    )
    assert repaired["risk"]["mitigations_in_source"] == ["not described in source"]
    assert "mitigations_in_source" not in repaired.get("_meta", {}).get("defaulted_fields", [])
    assert repaired.get("_meta", {}).get("mitigations_reconciled") is not True


def test_reconcile_replaces_silence_when_method_is_in_source() -> None:
    source = (
        "HeteroGenManip is a task conditioned two-stage framework designed "
        "to decouple grasp from interaction"
    )
    method = "a task conditioned two-stage framework designed to decouple grasp"
    repaired = repair_extraction_obj(
        {
            "risk": {
                "risk_title": "Heterogeneous grasp failures",
                "source_type": "empirical_study",
                "evidence_type": "demonstrated",
                "paper_stance": "proposes_mitigation",
                "demonstrated_finding": "success rate fell",
                "stated_implication": None,
                "proposed_mitigation": method,
                "mitigations_in_source": ["not described in source"],
            },
            "controls": [],
            "justification": {},
        },
        source,
    )
    assert repaired["risk"]["mitigations_in_source"] == [method]
    assert "not described in source" not in repaired["risk"]["mitigations_in_source"]
    assert repaired["_meta"]["mitigations_reconciled"] is True


# Stored R-28 (arXiv 2605.10201, risk 797b417c) after the first repair.
# The model paraphrased the method, so no five-word span of proposed_mitigation
# exists in the paper, and the silence phrase was left in place.
R28_PROPOSED = (
    "Two-stage framework with foundation-correspondence-guided grasp "
    "and multi-foundation-model routing"
)
R28_SOURCE = (
    "To overcome these limitations, we propose HeteroGenManip, a task- "
    "conditioned, two-stage framework designed to decouple initial grasp "
    "from complex interaction execution. First, Foundation-Correspondence-Guided "
    "Grasp module leverages structural priors to align the initial contact state. "
    "Subsequently, Multi-Foundation-Model Diffusion Policy routes objects to "
    "category-specialized foundation models."
)


def test_r28_paraphrase_has_no_five_word_span() -> None:
    from app.verification.evidence_rules import check_citation

    assert check_citation(R28_PROPOSED, R28_SOURCE)["ok"] is False


def test_r28_paraphrased_method_replaces_silence_with_source_sentence() -> None:
    from app.verification.evidence_rules import check_citation

    repaired = repair_extraction_obj(
        {
            "risk": {
                "risk_title": "Potential for robotic manipulation failures",
                "source_type": "empirical_study",
                "evidence_type": "demonstrated",
                "paper_stance": "proposes_mitigation",
                "demonstrated_finding": "success rate fell when components were removed",
                "stated_implication": None,
                "proposed_mitigation": R28_PROPOSED,
                "mitigations_in_source": ["not described in source"],
            },
            "controls": [],
            "justification": {},
        },
        R28_SOURCE,
    )
    mitigations = repaired["risk"]["mitigations_in_source"]
    assert mitigations != ["not described in source"]
    assert mitigations != [R28_PROPOSED]
    assert "two-stage framework" in mitigations[0]
    assert check_citation(mitigations[0], R28_SOURCE)["ok"] is True
    assert repaired["_meta"]["mitigations_reconciled"] is True
    assert "mitigations_in_source" not in repaired["_meta"].get("defaulted_fields", [])


def test_reconcile_does_not_copy_method_absent_from_source() -> None:
    repaired = repair_extraction_obj(
        {
            "risk": {
                "risk_title": "Hallucinated method kept out",
                "source_type": "empirical_study",
                "evidence_type": "demonstrated",
                "paper_stance": "proposes_mitigation",
                "demonstrated_finding": "success rate fell",
                "stated_implication": None,
                "proposed_mitigation": "hallucinated quantum shield for robots in orbit",
                "mitigations_in_source": ["not described in source"],
            },
            "controls": [],
            "justification": {},
        },
        "two-stage framework designed to decouple initial grasp from interaction execution now",
    )
    assert repaired["risk"]["mitigations_in_source"] == ["not described in source"]
    assert repaired.get("_meta", {}).get("mitigations_reconciled") is not True


def test_harm_term_absent_from_source_is_a_review_reason() -> None:
    record = _valid_record()
    sentence = "Failed manipulations could damage objects or equipment"
    record["risk_scoring"]["impact_reasoning"] = sentence
    source = "two-stage framework designed to decouple initial grasp from interaction"
    out = verify_record(record, source)
    assert "Unsupported harm: 'equipment' is not in the source" in out["review_reasons"]
    assert "Unsupported harm: 'damage' is not in the source" in out["review_reasons"]
    assert record["risk_scoring"]["impact_reasoning"] == sentence

    source_with_harm = source + " and can damage objects or equipment"
    out_supported = verify_record(record, source_with_harm)
    harm_reasons = [r for r in out_supported["review_reasons"] if r.startswith("Unsupported harm:")]
    assert harm_reasons == []
    assert record["risk_scoring"]["impact_reasoning"] == sentence


def test_assessor_prompt_has_nine_checks_and_accepts_paraphrase() -> None:
    from app.verification.llm_verifier import VERIFIER_CHECKS, VERIFIER_SYSTEM_PROMPT

    assert VERIFIER_CHECKS == (
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
    assert "rationale_supported" in VERIFIER_SYSTEM_PROMPT
    assert "paraphrase" in VERIFIER_SYSTEM_PROMPT
    assert "five consecutive" in VERIFIER_SYSTEM_PROMPT
    assert "better outcomes" in VERIFIER_SYSTEM_PROMPT
    assert "does not support a harm rationale" in VERIFIER_SYSTEM_PROMPT
    assert "potential health or physical-safety harm" in VERIFIER_SYSTEM_PROMPT
    assert "return repair null" in VERIFIER_SYSTEM_PROMPT
    assert "account takeover" in VERIFIER_SYSTEM_PROMPT
