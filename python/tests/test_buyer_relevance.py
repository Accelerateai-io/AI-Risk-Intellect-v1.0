"""Buyer relevance verdict and prompt rules added after the 24 Nov 2026 golden retest."""
from __future__ import annotations

import json

from app.verification.llm_verifier import (
    VERIFIER_CHECKS,
    VERIFIER_SYSTEM_PROMPT,
    parse_verifier_response,
    run_verifier,
)


def _verdict(**extra) -> str:
    base = {"checks": {name: {"pass": True, "quote": "q"} for name in VERIFIER_CHECKS}}
    base["grounding_score"] = 0.9
    base.update(extra)
    return json.dumps(base)


def test_buyer_relevance_false_is_parsed():
    r = parse_verifier_response(_verdict(buyer_relevance={"pass": False, "use_case": "", "consequence": ""}))
    assert r["buyer_relevance"] == {"pass": False, "use_case": "", "consequence": ""}


def test_buyer_relevance_true_keeps_use_case_and_consequence():
    r = parse_verifier_response(
        _verdict(buyer_relevance={"pass": "true", "use_case": "hospital triage tool", "consequence": "urgent cases delayed"})
    )
    assert r["buyer_relevance"]["pass"] is True
    assert r["buyer_relevance"]["use_case"] == "hospital triage tool"


def test_missing_buyer_relevance_is_none():
    assert parse_verifier_response(_verdict())["buyer_relevance"] is None
    assert parse_verifier_response(_verdict(buyer_relevance={"use_case": "x"}))["buyer_relevance"] is None


def test_prompt_asks_for_buyer_relevance_denials_and_repair():
    assert '"buyer_relevance": {"pass": true' in VERIFIER_SYSTEM_PROMPT
    assert "rather than a deployed system failure" in VERIFIER_SYSTEM_PROMPT
    assert "return that exact clause as repair.drop_clause" in VERIFIER_SYSTEM_PROMPT


def test_run_verifier_failure_has_no_buyer_relevance():
    def boom(*_a, **_k):
        raise RuntimeError("down")

    r = run_verifier({"risk": {}}, "source", generate_text=boom)
    assert r["ran"] is False and r["buyer_relevance"] is None
