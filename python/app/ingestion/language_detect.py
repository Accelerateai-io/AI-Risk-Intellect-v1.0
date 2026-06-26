"""Detect language of extracted text; skip ingest when detection fails."""

from __future__ import annotations

from langdetect import LangDetectException, detect

from .errors import SkipIngest

LANGUAGE_NOT_DETECTED_MESSAGE = "Language not detected by bot"

# Minimum characters required before attempting detection.
_MIN_SAMPLE_CHARS = 50


def detect_text_language(text: str) -> str | None:
    """Return ISO 639-1 language code, or None when detection is not possible."""
    sample = (text or "").strip()
    if len(sample) < _MIN_SAMPLE_CHARS:
        return None
    try:
        return detect(sample)
    except LangDetectException:
        return None


def require_detected_language(text: str) -> str:
    """Raise SkipIngest when the bot cannot detect language in extracted text."""
    lang = detect_text_language(text)
    if lang is None:
        raise SkipIngest(LANGUAGE_NOT_DETECTED_MESSAGE)
    return lang
