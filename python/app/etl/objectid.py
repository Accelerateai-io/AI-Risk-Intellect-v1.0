"""MongoDB ObjectId validation and extraction for AIID import rows."""

from __future__ import annotations

import re

_OBJECT_ID_PATTERN = re.compile(r"^[a-fA-F0-9]{24}$")
_OBJECT_ID_WRAPPED_PATTERN = re.compile(
    r"ObjectId\s*\(\s*['\"]?([a-fA-F0-9]{24})['\"]?\s*\)",
    re.IGNORECASE,
)
_EMPTY_VALUES = frozenset({"", "null", "none", "nan", "undefined", "n/a"})


def extract_object_id(value: object) -> str | None:
    """Extract a 24-char hex ObjectId from plain or ObjectId(...) CSV values."""
    if value is None:
        return None

    text = str(value).strip()
    if not text or text.lower() in _EMPTY_VALUES:
        return None

    wrapped = _OBJECT_ID_WRAPPED_PATTERN.search(text)
    if wrapped:
        return wrapped.group(1).lower()

    if _OBJECT_ID_PATTERN.match(text):
        return text.lower()

    return None


def is_valid_object_id(value: object) -> bool:
    return extract_object_id(value) is not None


def normalize_object_id(value: object) -> str | None:
    return extract_object_id(value)
