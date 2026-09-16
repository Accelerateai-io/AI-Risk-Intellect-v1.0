"""Tests for matching_keywords normalization in repair_extraction_obj."""

from app.llm.repair import repair_extraction_obj

SOURCE = "An example article about a specific AI system failure and its impact."


def _repair(risk_fields: dict) -> dict:
    obj = {"risk": dict(risk_fields), "controls": [], "justification": {}}
    return repair_extraction_obj(obj, SOURCE)


def test_matching_keywords_list_passthrough():
    repaired = _repair({"matching_keywords": ["prompt injection", "UWB ranging"]})
    assert repaired["risk"]["matching_keywords"] == [
        "prompt injection",
        "UWB ranging",
    ]


def test_matching_keywords_string_is_split_on_commas():
    repaired = _repair({"matching_keywords": "deepfake, voice cloning , fraud"})
    assert repaired["risk"]["matching_keywords"] == [
        "deepfake",
        "voice cloning",
        "fraud",
    ]


def test_matching_keywords_capped_at_15():
    repaired = _repair({"matching_keywords": [f"kw{i}" for i in range(30)]})
    assert len(repaired["risk"]["matching_keywords"]) == 15


def test_matching_keywords_absent_stays_absent():
    repaired = _repair({})
    assert "matching_keywords" not in repaired["risk"]


def test_matching_keywords_garbage_is_dropped():
    repaired = _repair({"matching_keywords": {"not": "a list"}})
    assert "matching_keywords" not in repaired["risk"]

    repaired = _repair({"matching_keywords": ["", "  ", None]})
    assert "matching_keywords" not in repaired["risk"]


def test_prompt_contains_quality_rules():
    # Read the file directly: prompt_loader transitively imports torch via
    # local_llm, which is unavailable in lightweight test environments.
    from pathlib import Path

    prompt = (Path(__file__).parent / "system_prompt.txt").read_text()
    assert "matching_keywords" in prompt
    assert "BANNED title openings" in prompt
    assert "MANDATORY PENALTIES" in prompt
