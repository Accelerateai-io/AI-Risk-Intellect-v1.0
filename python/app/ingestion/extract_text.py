"""Port of app.ingestion.extract_text — HTML, PDF, and raw text extraction."""

from __future__ import annotations

import html as html_module
import io
import re


def extract_from_html(html: str) -> str:
    if not (html or "").strip():
        return ""
    try:
        from trafilatura import extract

        text = extract(
            html,
            include_comments=False,
            include_tables=False,
            favor_precision=True,
        )
        if text:
            return html_module.unescape(text.strip())
    except Exception:
        pass

    # Fallback: strip tags
    cleaned = re.sub(r"<script[\s\S]*?</script>", " ", html, flags=re.I)
    cleaned = re.sub(r"<style[\s\S]*?</style>", " ", cleaned, flags=re.I)
    cleaned = re.sub(r"<[^>]+>", " ", cleaned)
    return re.sub(r"\s+", " ", cleaned).strip()


def extract_from_pdf(pdf_bytes: bytes) -> str:
    from pdfminer.high_level import extract_text

    text = extract_text(io.BytesIO(pdf_bytes)) or ""
    return extract_from_raw(text)


def extract_from_raw(text: str) -> str:
    if not text:
        return ""
    normalized = (
        text.replace("\r\n", "\n")
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
    )
    return re.sub(r"\s+", " ", normalized).strip()
