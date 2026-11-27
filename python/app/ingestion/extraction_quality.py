"""Deterministic article-extraction quality score.

The score decides whether extracted text may go to the risk-classification
model. It is not an LLM confidence value. Missing evidence stays low.

Rubric (100 points):

- URL and content consistency (0-20). Shared words between the URL slug and
  the text. No URL means 0.
- Title and content consistency (0-20). Title words found in the text. No
  title, or the placeholder "Untitled", means 0.
- Article relevance (0-20). Bot-block, cookie, and navigation boilerplate
  scores 0. A normal article scores 20.
- Completeness (0-20). Under 200 characters is 0, under 800 is 10, otherwise 20.
- Readability (0-20). Share of letters and spaces. Mostly markup or symbols is low.
"""

from __future__ import annotations

import re
from typing import Any

from .filters import detect_bot_block_page

_WORD_RE = re.compile(r"[a-z0-9]{4,}")
_BOILER_RE = re.compile(
    r"\b(cookie policy|accept all cookies|subscribe to our newsletter|"
    r"advertisement|skip to content|enable javascript)\b",
    re.I,
)


def _words(value: str) -> set[str]:
    return set(_WORD_RE.findall((value or "").lower().replace("_", " ").replace("-", " ")))


def _overlap_score(left: set[str], right: set[str]) -> int:
    if not left or not right:
        return 0
    shared = len(left & right)
    if shared >= 3:
        return 20
    if shared >= 1:
        return 10
    return 0


def score_extraction(
    *,
    url: str = "",
    title: str = "",
    text: str = "",
    html: str = "",
) -> dict[str, Any]:
    body = (text or "").strip()
    reasons: list[str] = []

    url_score = _overlap_score(_words(url), _words(body))
    if not (url or "").strip():
        url_score = 0
        reasons.append("no URL to compare with the article")
    elif url_score == 0:
        reasons.append("URL slug does not appear in the extracted text")

    title_clean = (title or "").strip()
    if not title_clean or title_clean.lower() == "untitled":
        title_score = 0
        reasons.append("no title to compare with the article")
    else:
        title_score = _overlap_score(_words(title_clean), _words(body))
        if title_score == 0:
            reasons.append("title words do not appear in the extracted text")

    blocked = detect_bot_block_page(html or body, extracted_text=body)
    boiler = bool(_BOILER_RE.search(body[:1500])) and len(body) < 800
    if blocked or boiler or not body:
        relevance = 0
        reasons.append(blocked or "extracted text looks like navigation, ads, or a block page")
    else:
        relevance = 20

    length = len(body)
    if length < 200:
        completeness = 0
        reasons.append("extracted text is too short to be a complete article")
    elif length < 800:
        completeness = 10
        reasons.append("extracted text may be truncated")
    else:
        completeness = 20

    if not body:
        readability = 0
    else:
        letters = sum(1 for ch in body if ch.isalpha() or ch.isspace())
        ratio = letters / len(body)
        readability = 20 if ratio >= 0.75 else 10 if ratio >= 0.5 else 0
        if readability == 0:
            reasons.append("extracted text is not readable prose")

    parts = {
        "url_content": url_score,
        "title_content": title_score,
        "relevance": relevance,
        "completeness": completeness,
        "readability": readability,
    }
    score = sum(parts.values())
    # A zero on any part means something could not be verified. That cannot pass.
    if any(value == 0 for value in parts.values()):
        score = min(score, 79)
    return {"score": score, "parts": parts, "reasons": reasons}
