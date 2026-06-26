"""Port of app.ingestion.pipeline — validate PDF and raw text for ingestion."""

from __future__ import annotations

from typing import Any

from .extract_text import extract_from_pdf, extract_from_raw
from .filters import (
    SkipIngest,
    detect_bot_block_page,
    excluded_non_ai_topic_skip_reason,
)
from .language_detect import require_detected_language


def prepare_pdf_ingest(
    pdf_bytes: bytes,
    *,
    url: str = "",
    title: str = "",
    skip_ai_check: bool = True,
) -> dict[str, Any]:
    """Same checks as ingest_pdf without DB persist (for Node bridge)."""
    del skip_ai_check  # keyword gate removed; LLM risk extraction filters content
    exclude_reason = excluded_non_ai_topic_skip_reason(url=url, title=title)
    if exclude_reason:
        raise SkipIngest(exclude_reason)

    text = extract_from_pdf(pdf_bytes)
    if len(text.strip()) < 500:
        raise SkipIngest("pdf text too small")

    exclude_reason = excluded_non_ai_topic_skip_reason(
        url=url, title=title, text=text
    )
    if exclude_reason:
        raise SkipIngest(exclude_reason)

    language = require_detected_language(text)
    details: dict[str, Any] = {"language": language}
    return {"text": text, "title": title or url, "details": details}


def prepare_html_ingest(
    html: str,
    *,
    url: str = "",
    title: str = "",
    skip_ai_check: bool = True,
) -> dict[str, Any]:
    """Extract article text from HTML (trafilatura) for the Node worker."""
    del skip_ai_check  # keyword gate removed; LLM risk extraction filters content
    from .extract_text import extract_from_html

    exclude_reason = excluded_non_ai_topic_skip_reason(url=url, title=title)
    if exclude_reason:
        raise SkipIngest(exclude_reason)

    block_reason = detect_bot_block_page(html)
    if block_reason:
        raise SkipIngest(block_reason)

    text = extract_from_html(html)
    if len(text.strip()) < 200:
        block_reason = detect_bot_block_page(html, extracted_text=text)
        if block_reason:
            raise SkipIngest(block_reason)
        raise SkipIngest("html text too small")

    exclude_reason = excluded_non_ai_topic_skip_reason(
        url=url, title=title, text=text
    )
    if exclude_reason:
        raise SkipIngest(exclude_reason)

    language = require_detected_language(text)
    details: dict[str, Any] = {"language": language}
    return {"text": text, "title": title or url, "details": details}


def prepare_raw_ingest(
    raw: str,
    *,
    url: str = "",
    title: str = "",
) -> dict[str, Any]:
    """Same checks as ingest_raw_text without DB persist (for Node bridge)."""
    exclude_reason = excluded_non_ai_topic_skip_reason(url=url, title=title)
    if exclude_reason:
        raise SkipIngest(exclude_reason)

    text = extract_from_raw(raw)
    if len(text.strip()) < 200:
        raise SkipIngest("raw text too small")

    exclude_reason = excluded_non_ai_topic_skip_reason(
        url=url, title=title, text=text
    )
    if exclude_reason:
        raise SkipIngest(exclude_reason)

    language = require_detected_language(text)
    details: dict[str, Any] = {"language": language}
    return {"text": text, "title": title or url, "details": details}


# Full pipeline stubs when persist is implemented in Python later.
def ingest_pdf(pdf_bytes: bytes, *, url: str = "", title: str = ""):
    return prepare_pdf_ingest(pdf_bytes, url=url, title=title)


def ingest_raw_text(text: str, *, url: str = "", title: str = ""):
    return prepare_raw_ingest(text, url=url, title=title)
