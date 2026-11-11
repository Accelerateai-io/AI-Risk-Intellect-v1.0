"""Port of app.ingestion.extract_text — HTML, PDF, and raw text extraction."""

from __future__ import annotations

import html as html_module
import io
import re
from html.parser import HTMLParser

# Landmark and boilerplate containers. These are page chrome, not the article.
_DROP_TAGS = frozenset(
    {"script", "style", "noscript", "svg", "iframe", "nav", "footer", "form", "aside"}
)
_VOID_TAGS = frozenset(
    {
        "area",
        "base",
        "br",
        "col",
        "embed",
        "hr",
        "img",
        "input",
        "link",
        "meta",
        "param",
        "source",
        "track",
        "wbr",
    }
)
# Whole class/id segments (split on whitespace, then "-" / "_"). "tag-ai" and
# "category-news" are taxonomy markers on the article itself and must not match.
_CHROME_SEGMENTS = frozenset(
    {
        "sidebar",
        "menu",
        "nav",
        "navbar",
        "navigation",
        "breadcrumb",
        "breadcrumbs",
        "tagcloud",
        "tags",
        "categories",
        "comments",
        "comment",
        "pagination",
        "pager",
        "cookie",
        "widget",
        "footer",
    }
)
_CHROME_ROLES = frozenset(
    {"navigation", "contentinfo", "banner", "complementary"}
)
_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def _attr_map(attrs: list[tuple[str, str | None]]) -> dict[str, str]:
    out: dict[str, str] = {}
    for key, value in attrs:
        out[key.lower()] = value or ""
    return out


def _segments(blob: str) -> list[str]:
    segments: list[str] = []
    for token in blob.split():
        segments.extend(part for part in re.split(r"[-_]+", token.lower()) if part)
    return segments


def _is_comment_article(tag: str, attrs: dict[str, str]) -> bool:
    if tag != "article":
        return False
    return "comment" in _segments(f"{attrs.get('class', '')} {attrs.get('id', '')}")


def _is_chrome(tag: str, attrs: dict[str, str], *, in_article: bool, in_main: bool) -> bool:
    """True when this element is navigation, a tag list, or other page chrome."""
    if tag in _DROP_TAGS:
        return True
    if tag == "header" and not in_article and not in_main:
        return True
    if tag in {"article", "main", "body"}:
        return _is_comment_article(tag, attrs)
    role = attrs.get("role", "").strip().lower()
    if role in _CHROME_ROLES:
        return True
    return any(
        segment in _CHROME_SEGMENTS
        for segment in _segments(f"{attrs.get('class', '')} {attrs.get('id', '')}")
    )


class _MainContentFinder(HTMLParser):
    """Record the primary article/main/body span and outermost chrome ranges."""

    def __init__(self, html: str, line_starts: list[int]) -> None:
        super().__init__(convert_charrefs=False)
        self.html = html
        self.line_starts = line_starts
        self.stack: list[dict[str, object]] = []
        self.cuts: list[tuple[int, int]] = []
        self.article_span: tuple[int, int] | None = None
        self.main_span: tuple[int, int] | None = None
        self.body_span: tuple[int, int] | None = None

    def _pos(self) -> int:
        line, offset = self.getpos()
        if line <= 0:
            return 0
        return self.line_starts[line - 1] + offset

    def _end_of_tag(self) -> int:
        start = self._pos()
        close = self.html.find(">", start)
        return len(self.html) if close < 0 else close + 1

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self._open(tag.lower(), _attr_map(attrs), self._pos(), self._end_of_tag())

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self._open(tag.lower(), _attr_map(attrs), self._pos(), self._end_of_tag(), void=True)

    def _open(
        self,
        tag: str,
        attrs: dict[str, str],
        start: int,
        end: int,
        *,
        void: bool = False,
    ) -> None:
        parent = self.stack[-1] if self.stack else None
        in_article = bool(parent and parent["in_article"])
        in_main = bool(parent and parent["in_main"])
        chrome = _is_chrome(tag, attrs, in_article=in_article, in_main=in_main)
        suppressed = bool(parent and parent["suppressed"]) or chrome
        frame_article = in_article or (tag == "article" and not _is_comment_article(tag, attrs))
        frame_main = in_main or tag == "main"
        frame_body = bool(parent and parent["in_body"]) or tag == "body"
        primary_article = frame_article and not in_article and self.article_span is None
        primary_main = frame_main and not in_main and self.main_span is None
        if void or tag in _VOID_TAGS:
            if chrome and not (parent and parent["suppressed"]):
                self.cuts.append((start, end))
            return
        self.stack.append(
            {
                "tag": tag,
                "start": start,
                "chrome": chrome,
                "suppressed": suppressed,
                "parent_suppressed": bool(parent and parent["suppressed"]),
                "in_article": frame_article,
                "in_main": frame_main,
                "in_body": frame_body,
                "primary_article": primary_article,
                "primary_main": primary_main,
            }
        )
        if tag == "body" and self.body_span is None:
            self.body_span = (start, len(self.html))

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        end = self._end_of_tag()
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index]["tag"] != tag:
                continue
            frame = self.stack[index]
            del self.stack[index:]
            if frame["chrome"] and not frame["parent_suppressed"]:
                self.cuts.append((int(frame["start"]), end))
            if frame.get("primary_article") and self.article_span is None:
                self.article_span = (int(frame["start"]), end)
            if frame.get("primary_main") and self.main_span is None:
                self.main_span = (int(frame["start"]), end)
            break
        if tag == "body" and self.body_span is not None:
            self.body_span = (self.body_span[0], end)


def _line_starts(html: str) -> list[int]:
    starts = [0]
    for match in re.finditer(r"\n", html):
        starts.append(match.end())
    return starts


def _apply_cuts(text: str, cuts: list[tuple[int, int]]) -> str:
    if not cuts:
        return text
    ordered = sorted(cuts)
    parts: list[str] = []
    cursor = 0
    for start, end in ordered:
        start = max(0, min(start, len(text)))
        end = max(start, min(end, len(text)))
        if end <= cursor:
            continue
        if start > cursor:
            parts.append(text[cursor:start])
        cursor = max(cursor, end)
    parts.append(text[cursor:])
    return "".join(parts)


def _visible_text(html: str) -> str:
    without_scripts = re.sub(r"<(script|style|noscript)[\s\S]*?</\1>", " ", html, flags=re.I)
    return _WS_RE.sub(" ", _TAG_RE.sub(" ", without_scripts)).strip()


def isolate_main_content_html(html: str) -> str:
    """Keep the article (or main/body) and drop identifiable page chrome.

    Navigation, footers, sidebars, comment blocks, and tag/category lists are
    removed so a later relevance check scores the article rather than the
    surrounding page. The original document is returned when no content region
    can be isolated.
    """
    source = html or ""
    if not source.strip():
        return source
    finder = _MainContentFinder(source, _line_starts(source))
    try:
        finder.feed(source)
        finder.close()
    except Exception:
        return source
    span = finder.article_span or finder.main_span or finder.body_span
    if not span:
        return source
    start, end = span
    cuts = [(cut_start - start, cut_end - start) for cut_start, cut_end in finder.cuts if cut_start >= start and cut_end <= end and cut_end > cut_start]
    piece = _apply_cuts(source[start:end], cuts)
    if not _visible_text(piece):
        return source
    return f"<!DOCTYPE html><html><body>{piece}</body></html>"


def extract_from_html(html: str) -> str:
    if not (html or "").strip():
        return ""
    scoped = isolate_main_content_html(html)
    try:
        from trafilatura import extract

        text = extract(
            scoped,
            include_comments=False,
            include_tables=False,
            favor_precision=True,
        )
        if text:
            return html_module.unescape(text.strip())
    except Exception:
        pass

    # Fallback: strip tags from the article region, not the whole page.
    cleaned = re.sub(r"<script[\s\S]*?</script>", " ", scoped, flags=re.I)
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
