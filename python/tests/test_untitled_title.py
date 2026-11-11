"""Titles: an empty title falls back to "Untitled", never the raw URL."""

from __future__ import annotations

from app.ingestion.pipeline import UNTITLED_TITLE, prepare_raw_ingest

ARXIV_URL = "https://arxiv.org/abs/2304.10041"
# Long, clearly AI-related, English text so the ingest passes its own gates.
AI_TEXT = (
    "This paper studies reinforcement learning policy synthesis for continuous "
    "control systems. The large language model agent proposes formal policies "
    "that are not validated, which may fail under real-world deployment. "
) * 4


def test_untitled_when_no_title():
    result = prepare_raw_ingest(AI_TEXT, url=ARXIV_URL, title="")
    assert result["title"] == UNTITLED_TITLE
    assert result["title"] != ARXIV_URL


def test_keeps_a_real_title():
    result = prepare_raw_ingest(
        AI_TEXT,
        url=ARXIV_URL,
        title="Reinforcement Learning Policy Synthesis Fails to Guarantee Specs",
    )
    assert result["title"] == (
        "Reinforcement Learning Policy Synthesis Fails to Guarantee Specs"
    )
