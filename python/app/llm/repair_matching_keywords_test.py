"""Facts-only repair drops matching_keywords instead of normalising them."""

from app.llm.repair import repair_extraction_obj

SOURCE = "An example article about a specific AI system failure and its impact."


def _repair(risk_fields: dict) -> dict:
    obj = {"risk": dict(risk_fields), "controls": [], "justification": {}}
    return repair_extraction_obj(obj, SOURCE)


def test_matching_keywords_are_removed():
    for value in (
        ["prompt injection", "UWB ranging"],
        "deepfake, voice cloning , fraud",
        [f"kw{i}" for i in range(30)],
        {"not": "a list"},
        ["", "  ", None],
    ):
        repaired = _repair({"matching_keywords": value})
        assert "matching_keywords" not in repaired["risk"]


def test_matching_keywords_absent_stays_absent():
    repaired = _repair({})
    assert "matching_keywords" not in repaired["risk"]


def test_prompt_is_facts_only():
    # Read the file directly: prompt_loader transitively imports torch via
    # local_llm, which is unavailable in lightweight test environments.
    from pathlib import Path

    prompt = (Path(__file__).parent / "system_prompt.txt").read_text()
    schema = prompt.split("=== OUTPUT SCHEMA ===", 1)[1]
    for banned in (
        "decision_rationale",
        "taxonomy_mapping",
        "evidence_breakdown",
        "self_assessment",
        "context_clarity_score",
        "matching_keywords",
    ):
        assert banned not in schema
    assert "SELF-ASSESSMENT" not in prompt
    assert "risk_title" in schema
    assert "mitigations_in_source" in schema
