"""B-5: abbreviation-safe sentence splitting (parity with the TS port)."""

from __future__ import annotations

from app.risk_processing.description_utils import (
    normalize_narrative_text,
    split_sentences,
)

# R-26 (ETO Scout, vol. 30) — real stored text from the golden set
# (docs/remediation/gold_set/sources/R-13765.txt and its record). "U.S." must
# never be a sentence boundary: the record's title "...in U.S. AI Models..." has
# "U.S." right before a capitalized word ("AI"), exactly the boundary the old
# naive split broke on, cutting the sentence at "U.S.".
R26_TITLE = (
    "Safety Filters in U.S. AI Models Prevent Legitimate Security Use, "
    "Forcing Reliance on Foreign Models."
)
R26_EVIDENCE = (
    "U.S.-based AI developer community Hugging Face used a Chinese AI model "
    "to complete forensic analysis after an intrusion by an autonomous "
    "attacker, because U.S. models' safety filters made them unusable."
)


def test_does_not_split_on_us_abbreviation():
    out = split_sentences("The tool was deployed by a U.S. agency. It raised concerns.")
    assert out == [
        "The tool was deployed by a U.S. agency.",
        "It raised concerns.",
    ]


def test_does_not_split_on_common_abbreviations():
    for text in (
        "See Fig. 2 for details. The next point follows.",
        "We used e.g. GPT-4 and Claude. Results varied.",
        "That is, i.e. the model failed. A fix is pending.",
        "Smith et al. reported the bug. It was fixed.",
        "Compare No. 5 and vs. the baseline. Scores rose.",
    ):
        assert len(split_sentences(text)) == 2, text


def test_decimal_numbers_do_not_split():
    assert len(split_sentences("Accuracy fell to 3.14 percent overall. That is bad.")) == 2


def test_r26_us_ai_title_is_one_sentence():
    # Real R-26 title: "U.S. AI" (S. then capital A) must not be cut at "U.S.".
    assert split_sentences(R26_TITLE) == [R26_TITLE]


def test_r26_evidence_snippet_is_one_sentence():
    # Real R-26 evidence: "U.S.-based" and "U.S. models'" stay in one sentence.
    assert split_sentences(R26_EVIDENCE) == [R26_EVIDENCE]


def test_r26_normalize_keeps_us_sentence_drops_only_trailing_fragment():
    assert normalize_narrative_text(f"{R26_TITLE} The incident further shows") == R26_TITLE
    assert normalize_narrative_text(R26_TITLE) == R26_TITLE
