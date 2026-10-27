"""Source-text preprocessing before extraction (BUG-05).

Full papers now arrive from the arXiv PDF resolver (BUG-09). Two things in a
full paper hurt extraction and cost tokens without adding evidence:

* the reference list, which on dev produced a likelihood rationale about a
  *cited* paper ("whether ChatGPT-generated code is correct") on a record
  about GRPO reward variance (R-06);
* appendices after the references.

``trim_for_extraction`` cuts the text at the reference heading when that
heading sits in the second half of the document, and reports what it did so
the decision is stored on the record. Pure function, no I/O.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# A heading line that starts the reference list. Anchored to a line start and
# bounded so "see references in Section 3" never matches.
_REFERENCES_RE = re.compile(
    r"(?im)^\s*(?:\d+\.?\s*|[ivx]+\.?\s*)?(references|bibliography|works cited|reference list)\s*:?\s*$"
)

# Reference lists in PDF-extracted text often lose the heading line. Fall back
# to the first run of numbered bibliographic entries ("[1] Author, ...") in
# the tail of the document.
_NUMBERED_ENTRY_RE = re.compile(r"(?m)^\s*\[\d{1,3}\]\s+\S")

# Only trim when the heading is this far into the text, so a paper whose
# abstract merely mentions "References" is never cut in half.
_MIN_POSITION_RATIO = 0.4


@dataclass(frozen=True)
class TrimResult:
    text: str
    original_chars: int
    trimmed_chars: int
    references_removed: bool
    method: str  # "heading" | "numbered_entries" | "none"

    def to_meta(self) -> dict:
        return {
            "original_chars": self.original_chars,
            "trimmed_chars": self.trimmed_chars,
            "references_removed": self.references_removed,
            "method": self.method,
        }


def _find_reference_start(text: str) -> tuple[int, str] | None:
    n = len(text)
    if n == 0:
        return None
    floor = int(n * _MIN_POSITION_RATIO)

    # Prefer the LAST heading match past the floor: a paper may cite a
    # section called "References" in its own body text, but the real list
    # is the final one.
    last_heading: int | None = None
    for m in _REFERENCES_RE.finditer(text):
        if m.start() >= floor:
            last_heading = m.start()
    if last_heading is not None:
        return last_heading, "heading"

    # Numbered entries: need at least three in a row within the tail.
    matches = [m.start() for m in _NUMBERED_ENTRY_RE.finditer(text) if m.start() >= floor]
    if len(matches) >= 3:
        # Require the first three to be reasonably close (a dense list).
        if matches[2] - matches[0] < 2_000:
            return matches[0], "numbered_entries"
    return None


def trim_for_extraction(text: str) -> TrimResult:
    """Return ``text`` without its reference list and anything after it."""
    original = text or ""
    found = _find_reference_start(original)
    if found is None:
        return TrimResult(
            text=original,
            original_chars=len(original),
            trimmed_chars=len(original),
            references_removed=False,
            method="none",
        )
    cut, method = found
    trimmed = original[:cut].rstrip()
    # Never return an empty or absurdly short body.
    if len(trimmed) < 500:
        return TrimResult(
            text=original,
            original_chars=len(original),
            trimmed_chars=len(original),
            references_removed=False,
            method="none",
        )
    return TrimResult(
        text=trimmed,
        original_chars=len(original),
        trimmed_chars=len(trimmed),
        references_removed=True,
        method=method,
    )


def head_and_tail(text: str, head_chars: int, tail_chars: int) -> tuple[str, str]:
    """Opening and closing slices of a document (abstract/intro, conclusion).

    Used by the synthesis call so the final record is anchored on the parts of
    a paper that state the problem and the limitations, whatever the chunk
    boundaries were.
    """
    body = text or ""
    if len(body) <= head_chars + tail_chars:
        return body, ""
    return body[:head_chars], body[-tail_chars:]
