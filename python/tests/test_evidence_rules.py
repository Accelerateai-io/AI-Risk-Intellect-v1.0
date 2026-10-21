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
