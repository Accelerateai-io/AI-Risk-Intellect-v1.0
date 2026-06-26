"""Port of app.ingestion.filters — soft 404 and AI-topic classification."""

from __future__ import annotations

import re
from typing import Any

from .errors import SkipIngest

BOT_BLOCK_SKIP_MESSAGE = (
    "Site blocked automated access (Cloudflare or bot protection page)"
)

BOT_BLOCK_HTML_PATTERNS = [
    re.compile(r"just a moment", re.I),
    re.compile(r"enable javascript and cookies to continue", re.I),
    re.compile(r"please enable js(?:\s+and disable any ad blocker)?", re.I),
    re.compile(r"challenges\.cloudflare\.com", re.I),
    re.compile(r"cf-browser-verification", re.I),
    re.compile(r"checking your browser", re.I),
    re.compile(r"attention required!?\s*\|\s*cloudflare", re.I),
    re.compile(r"cf-challenge", re.I),
    re.compile(r"ddos protection by cloudflare", re.I),
    re.compile(r"performing security verification", re.I),
    re.compile(r"please wait while we verify", re.I),
    re.compile(r"__cf_chl", re.I),
    re.compile(r"datadome", re.I),
]

BOT_BLOCK_EXTRACTED_PATTERNS = [
    re.compile(r"^enable javascript and cookies to continue$", re.I),
    re.compile(r"^checking your browser before accessing", re.I),
    re.compile(r"^please enable cookies", re.I),
    re.compile(r"please enable js(?:\s+and disable any ad blocker)?", re.I),
]

BOT_BLOCK_SIGNAL_RE = re.compile(
    r"cloudflare|javascript|cookies|challenge|verify|enable js|ad blocker|datadome",
    re.I,
)

NOT_AI_RELATED_SKIP_MESSAGE = "not ai related"

__all__ = [
    "SkipIngest",
    "BOT_BLOCK_SKIP_MESSAGE",
    "NOT_AI_RELATED_SKIP_MESSAGE",
    "detect_bot_block_page",
    "excluded_non_ai_topic_skip_reason",
    "looks_like_soft_404",
    "classify_ai_related",
]

SOFT_404_PAT = re.compile(
    r"(404|not\s+found|page\s+not\s+found|page\s+removed|gone|error\s+404)",
    re.I,
)

AI_INCLUDE = [
    re.compile(r"\b(openai|chatgpt|gpt-4|gpt-3|gemini|anthropic|claude|copilot|deepseek)\b", re.I),
    re.compile(r"\b(ai|artificial intelligence)\b", re.I),
    re.compile(r"\b(llms?|large language model|language model)\b", re.I),
    re.compile(r"\b(machine learning|ml|deep learning|neural network)\b", re.I),
    re.compile(
        r"\b(embedding|token|inference|fine[- ]?tuning|rlhf|safety|alignment)\b",
        re.I,
    ),
    re.compile(r"\b(prompt|prompt injection|jailbreak|hallucination|red teaming)\b", re.I),
    re.compile(r"\b(model weights?|training data|dataset|inference api)\b", re.I),
    re.compile(r"\b(privacy|pii|data leakage|governance|compliance) in (ai|ml)\b", re.I),
]

AI_EXCLUDE = [
    re.compile(r"\b(sports|football|basketball|baseball|soccer|golf|tennis)\b", re.I),
    re.compile(r"\b(recipes?|cooking|travel|tourism|celebrity|fashion|beauty)\b", re.I),
    re.compile(r"\b(stock photos?|coupon|promo|giveaway)\b", re.I),
]


def detect_bot_block_page(
    html: str,
    *,
    extracted_text: str | None = None,
    http_status: int | None = None,
) -> str | None:
    """Return a skip message when HTML looks like a bot-protection challenge page."""
    sample = (html or "")[:12_000]
    if sample and any(p.search(sample) for p in BOT_BLOCK_HTML_PATTERNS):
        return BOT_BLOCK_SKIP_MESSAGE

    extracted = (extracted_text or "").strip()
    if extracted and any(p.search(extracted) for p in BOT_BLOCK_EXTRACTED_PATTERNS):
        return BOT_BLOCK_SKIP_MESSAGE

    if (
        http_status in (401, 403, 429)
        and extracted
        and len(extracted) < 500
        and BOT_BLOCK_SIGNAL_RE.search(f"{sample} {extracted}")
    ):
        return BOT_BLOCK_SKIP_MESSAGE

    return None


def looks_like_soft_404(
    html: str,
    status: int,
    *,
    extracted_text: str | None = None,
    min_text_bytes: int = 500,
) -> bool:
    if status in (404, 410, 451):
        return True
    if html and SOFT_404_PAT.search((html or "")[:2000]):
        return True
    if extracted_text is not None and len(extracted_text.strip()) < min_text_bytes:
        return True
    return False


def _hit_count(text: str, patterns: list[re.Pattern[str]]) -> int:
    low = (text or "").lower()
    return sum(1 for p in patterns if p.search(low))


def _topic_blob(*, url: str = "", title: str = "", text: str = "") -> str:
    return " ".join(
        part.strip() for part in (title, url, text) if part and part.strip()
    ).strip()


def excluded_non_ai_topic_skip_reason(
    *,
    url: str = "",
    title: str = "",
    text: str = "",
) -> str | None:
    """Return skip reason when sports/travel/recipes/etc. appear without enough AI context."""
    blob = _topic_blob(url=url, title=title, text=text)
    if not blob:
        return None
    exclude_hits = _hit_count(blob, AI_EXCLUDE)
    if exclude_hits == 0:
        return None

    include_hits = _hit_count(blob, AI_INCLUDE)
    threshold = 2
    if include_hits - exclude_hits >= threshold:
        return None

    head_blob = _topic_blob(url=url, title=title)
    if head_blob and _hit_count(head_blob, AI_INCLUDE) >= 1:
        return None

    return NOT_AI_RELATED_SKIP_MESSAGE


def classify_ai_related(
    text: str,
    *,
    title: str = "",
    url: str = "",
    include_threshold: int = 2,
) -> tuple[bool, dict[str, Any]]:
    blob = _topic_blob(url=url, title=title, text=text)
    include_hits = _hit_count(blob, AI_INCLUDE)
    exclude_hits = _hit_count(blob, AI_EXCLUDE)
    ok = exclude_hits == 0 and (include_hits - exclude_hits) >= include_threshold
    details = {
        "include_hits": include_hits,
        "exclude_hits": exclude_hits,
        "threshold": include_threshold,
    }
    return ok, details
