"""Severity and rationale checks: potential consequences need no quantified harm.

Cortexsce's 25 Nov test of #32 and #33 still held the Guardian deepfake record
(R-164, Ghassan's R-23) because its impact was "not supported by quantified
business harm". The rule agreed with Ghassan on 24 Nov is a plausible adverse
consequence in an identifiable buyer use case, not documented harm. These
tests pin the prompt wording; the LLM's behaviour is checked by the golden
rerun.
"""
from __future__ import annotations

from app.verification.llm_verifier import VERIFIER_SYSTEM_PROMPT

P = VERIFIER_SYSTEM_PROMPT


def _check(n: int) -> str:
    start = P.index(f"\n{n}. ")
    end = P.index(f"\n{n + 1}. ", start)
    return P[start:end]


def test_check4_allows_potential_consequence_without_quantified_harm():
    c4 = _check(4)
    assert "written as potential" in c4
    assert "No quantified, financial, or documented business harm is needed" in c4


def test_check4_still_fails_unreported_harm_types_and_scale():
    c4 = _check(4)
    assert "adds an attack technique, misuse, harm type, affected group, or scale the source does not report, even as a potential" in c4
    assert "does not by itself support a specific attack or misuse it does not report" in c4
    assert '"at scale", "widespread", or "millions of users"' in c4
    assert "already happened and the source does not report it" in c4


def test_check4_potential_consequence_excludes_patient_and_physical_harm():
    c4 = _check(4)
    assert "reputational, legal, compliance, or operational exposure" in c4
    assert "This does not cover patient or physical harm" in c4


def test_check4_keeps_existing_rules():
    c4 = _check(4)
    assert "Fail when a rationale states patient harm, physical harm, or a deployment failure the source does not report." in c4
    assert "rather than a deployed system failure" in c4
    assert c4.rstrip().endswith("This check does not by itself decide publication.")


def test_check6_accepts_quoted_basis_for_potential_consequence():
    c6 = _check(6)
    assert "allowed by check 4" in c6
    assert "needs no quote showing that the consequence occurred or was quantified" in c6
    assert "A benefit or improvement sentence does not support a harm rationale." in c6


def test_prompt_never_requires_quantified_harm():
    low = P.lower()
    for phrase in ("must be quantified", "requires quantified", "quantified harm is required"):
        assert phrase not in low
