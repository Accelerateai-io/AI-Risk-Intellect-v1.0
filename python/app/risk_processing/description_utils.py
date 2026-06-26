"""Narrative text helpers — complete sentences only (no mid-sentence truncation)."""

from __future__ import annotations

import re

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")
_COMPLETE_SENTENCE_END = re.compile(r'[.!?]["\')\]]*\s*$')


def word_count(text: str) -> int:
    return len(text.split())


def ends_complete_sentence(text: str) -> bool:
    cleaned = (text or "").strip()
    if not cleaned:
        return True
    return bool(_COMPLETE_SENTENCE_END.search(cleaned))


def split_sentences(text: str) -> list[str]:
    cleaned = " ".join((text or "").split())
    if not cleaned:
        return []
    parts = _SENTENCE_SPLIT.split(cleaned)
    return [part.strip() for part in parts if part.strip()]


def normalize_narrative_text(text: str) -> str:
    """Return full prose, removing only a trailing incomplete sentence fragment."""
    cleaned = " ".join((text or "").split())
    if not cleaned:
        return cleaned
    if ends_complete_sentence(cleaned):
        return cleaned

    sentences = split_sentences(cleaned)
    if len(sentences) > 1:
        complete = " ".join(sentences[:-1]).strip()
        if complete:
            return complete

    return cleaned


def snippet_as_description(
    source_text: str,
    *,
    max_sentences: int = 6,
) -> str:
    """Fallback description from article text (whole sentences only)."""
    cleaned = " ".join((source_text or "").split())
    if not cleaned:
        return "Risk description extracted from source"

    sentences = split_sentences(cleaned)
    if sentences:
        return " ".join(sentences[:max_sentences])

    return normalize_narrative_text(cleaned)


# Backwards-compatible alias used by older imports
def clamp_description_words(text: str, *, max_words: int = 100) -> str:
    del max_words
    return normalize_narrative_text(text)
