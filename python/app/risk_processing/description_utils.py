"""Narrative text helpers — complete sentences only (no mid-sentence truncation)."""

from __future__ import annotations

import re

# Abbreviations whose trailing period must NOT end a sentence (B-5). Keep in
# sync with backend/src/utils/normalizeNarrativeText.ts.
ABBREVIATIONS = (
    "u.s.a", "u.s", "u.k", "e.g", "i.e", "et al", "etc", "vs",
    "fig", "figs", "no", "nos", "vol", "vols", "pp", "cf", "al",
    "dr", "mr", "mrs", "ms", "prof", "sr", "jr", "st",
    "inc", "ltd", "co", "corp", "dept", "approx", "eq", "sec", "ref",
)

# Sentinel standing in for an abbreviation's period during the split, then
# swapped back to ".". A private-use code point (never in real prose) keeps the
# source text-diffable and in parity with the TS port (which dropped a NUL). (B-5)
_PLACEHOLDER = ""
_PROTECT_ABBREV = re.compile(
    r"\b(?:" + "|".join(a.replace(".", r"\.") for a in ABBREVIATIONS) + r")\.",
    re.IGNORECASE,
)
_PROTECT_INITIAL = re.compile(r"\b[A-Z]\.")  # initials: J., U., S.
_PROTECT_DECIMAL = re.compile(r"\d\.\d")  # 3.14
# Only break when the next token starts a new sentence (capital / digit / quote),
# so "U.S. agency" and "vol. 30" never split mid-abbreviation.
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[\"'(\[]?[A-Z0-9])")
_COMPLETE_SENTENCE_END = re.compile(r'[.!?]["\')\]]*\s*$')


def word_count(text: str) -> int:
    return len(text.split())


def ends_complete_sentence(text: str) -> bool:
    cleaned = (text or "").strip()
    if not cleaned:
        return True
    return bool(_COMPLETE_SENTENCE_END.search(cleaned))


def _protect_abbreviations(text: str) -> str:
    def repl(match: re.Match[str]) -> str:
        return match.group(0).replace(".", _PLACEHOLDER)

    text = _PROTECT_ABBREV.sub(repl, text)
    text = _PROTECT_INITIAL.sub(repl, text)
    text = _PROTECT_DECIMAL.sub(repl, text)
    return text


def split_sentences(text: str) -> list[str]:
    """Abbreviation-safe sentence split (B-5).

    Periods inside known abbreviations (U.S., e.g., vol., et al., …), capital
    initials, and decimals are shielded before the split, so "U.S. agency" and
    "ETO vol. 30, …" stay inside one sentence instead of fragmenting.
    """
    cleaned = " ".join((text or "").split())
    if not cleaned:
        return []
    protected = _protect_abbreviations(cleaned)
    parts = _SENTENCE_SPLIT.split(protected)
    restored = [part.replace(_PLACEHOLDER, ".").strip() for part in parts]
    return [part for part in restored if part]


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
