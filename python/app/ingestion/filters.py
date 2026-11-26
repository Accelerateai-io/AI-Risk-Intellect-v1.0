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

# B-4: below this many chars of extracted body TEXT a paywall marker is a stub.
PAYWALL_MIN_BODY_CHARS = 500

_TAG_RE = re.compile(r"<[^>]+>")
_SCRIPT_STYLE_RE = re.compile(r"<(script|style)[\s\S]*?</\1>", re.I)
_WS_RE = re.compile(r"\s+")


def _strip_tags_to_text(html: str) -> str:
    """Crudely strip HTML to visible text, for the paywall thinness check."""
    text = _SCRIPT_STYLE_RE.sub(" ", html or "")
    text = _TAG_RE.sub(" ", text)
    return _WS_RE.sub(" ", text).strip()

# B-4: auth/forbidden/rate-limit responses and paywalls carry no article body.
FETCH_FAILED_SKIP_MESSAGE = (
    "Fetch failed: the site returned an error or access-denied response"
)
PAYWALL_SKIP_MESSAGE = (
    "Site served a paywall or subscription wall instead of content"
)

ACCESS_DENIED_PATTERNS = [
    re.compile(r"access denied", re.I),
    re.compile(r"\b403\b[^\n]{0,20}\bforbidden\b", re.I),
    re.compile(r"\bforbidden\b", re.I),
    re.compile(r"you (?:don'?t|do not) have permission", re.I),
    re.compile(r"not authori[sz]ed", re.I),
    re.compile(r"request (?:blocked|unauthorized)", re.I),
    re.compile(r"error[\s:]*403", re.I),
]

PAYWALL_PATTERNS = [
    re.compile(r"subscribe to (?:continue|read)", re.I),
    re.compile(r"subscribers? only", re.I),
    re.compile(r"to continue reading", re.I),
    re.compile(r"create a (?:free )?account to (?:continue|read)", re.I),
    re.compile(r"this (?:article|content|story) is (?:for|available to) subscribers", re.I),
    re.compile(r"already a subscriber\?", re.I),
    re.compile(r"metered paywall", re.I),
]

NOT_AI_RELATED_SKIP_MESSAGE = "not ai related"

__all__ = [
    "SkipIngest",
    "BOT_BLOCK_SKIP_MESSAGE",
    "FETCH_FAILED_SKIP_MESSAGE",
    "PAYWALL_SKIP_MESSAGE",
    "NOT_AI_RELATED_SKIP_MESSAGE",
    "detect_bot_block_page",
    "excluded_non_ai_topic_skip_reason",
    "looks_like_soft_404",
    "classify_ai_related",
    "has_no_ai_signal",
]

SOFT_404_PAT = re.compile(
    r"(404|not\s+found|page\s+not\s+found|page\s+removed|gone|error\s+404)",
    re.I,
)

# Words that make "algorithm" about a decision about people, not maths or code.
_ALGORITHM_CONTEXT = (
    r"(?:deny|denied|denials?|decid\w*|decisions?|discriminat\w*|bias(?:ed)?"
    r"|eligib\w*|hiring|tenants?|rents?|credit|lending|loans?|pricing"
    r"|polic(?:e|ing)|benefits|surveillance|amplif\w*|feeds?|content moderation"
    r"|social media|welfare|fairness|accountab\w*)"
)

# Terms that on their own mean the page is about AI. A page needs at least one
# of these to count as AI content. Generic words that also appear in recalls,
# security advisories and finance news (safety, token, inference, prompt,
# dataset...) only add weight on top of a core term; on their own they used to
# keep a page that has nothing to do with AI.
AI_CORE = [
    # Products and labs. Gemini only with Google/AI context (Gemini Trust is a
    # crypto exchange).
    re.compile(
        r"\b(openai|chatgpt|gpt[-‐‑ ]?\d\w*|gpts|anthropic|claude|copilot"
        r"|deepseek|grok|xai|google(?:'s)? gemini|gemini (?:ai|app|advanced|pro"
        r"|ultra|nano|flash|live|\d)|llama[- ]?\d\w*|midjourney|stable diffusion"
        r"|dall[- ·]?e|character\.ai|hugging ?face|perplexity ai|mistral ai"
        r"|google bard|bing chat|openai'?s sora|meta ai|apple intelligence)\b",
        re.I,
    ),
    # "AI" and its spellings. "A.I." is the New York Times house style.
    re.compile(r"\b(ai|genai|agentic|artificial[- ]intelligence)\b|\bA\.I\.", re.I),
    # Plural "AIs" only in this case, so CISA's "AIS" (Automated Indicator
    # Sharing) and maritime AIS do not count.
    re.compile(r"\bAIs\b"),
    # Model and method terms.
    re.compile(
        r"\b(llms?|(?:large[- ])?language[- ]models?|machine[- ]learning"
        r"|deep[- ]learning|neural[- ]net(?:work)?s?|reinforcement learning"
        r"|diffusion models?|transformer (?:models?|architecture)"
        r"|federated learning|adversarial (?:examples?|attacks?|robustness)"
        r"|reward models?|in-context learning|chain[- ]of[- ]thought"
        r"|retrieval[- ]augmented|rlhf|prompt injection|model weights?"
        r"|training data|vlms?|vision[- ]language models?|foundation models?"
        r"|computer vision)\b",
        re.I,
    ),
    # "ML" only upper-case and only with a model word after it. A bare \bml\b
    # matched "10 mL" and "50 MG/ML" in FDA recalls.
    re.compile(
        r"\b(?:AI/ML|MLOps|ML[- ](?:models?|systems?|based|powered|driven"
        r"|pipelines?|algorithms?|engineers?))\b",
    ),
    # Applications and harms.
    re.compile(
        r"\b(chatbots?|deepfakes?|facial[- ]recognition|face[- ]recognition"
        r"|algorithmic(?!\s+trading)|self[- ]driving|robotaxis?|driverless"
        r"|autonomous (?:vehicles?|driving|cars?|trucks?|weapons?|agents?)|waymo"
        r"|tesla(?:'s)? autopilot|full self[- ]driving|automated (?:decision"
        r"|valuation|underwriting|hiring|employment|eligibility|screening)\w*"
        r"|predictive (?:policing|analytics|algorithms?)|recommend(?:ation"
        r"|er) (?:systems?|algorithms?|engines?)|risk[- ]scoring (?:tools?"
        r"|algorithms?|models?)|voice[- ]clon\w*|synthetic (?:media|voices?"
        r"|imagery)|nudify\w*|(?:ai|machine|computer)[- ]generated"
        r"|generative (?:models?|tools?|systems?))\b",
        re.I,
    ),
    # Driver assistance, lab and model names, and detection systems that the AI
    # Incident Database tracks as AI incidents (Tesla Autopilot crashes, phantom
    # braking, ShotSpotter). Found by running the gate on the 27 Oct prod export.
    re.compile(
        r"\b(deepmind|gemini (?:robotics|omni|image|models?|api|cli|code)"
        r"|driver[- ]assist(?:ance|ed)?|automatic emergency braking|phantom braking"
        r"|gunshot detection|shotspotter|recommendation algorithms?"
        r"|amazon (?:q|nova)|tesla(?:'s)?\b[^.\n]{0,40}\bautopilot"
        r"|voice[- ]assistants?|virtual assistants?|smart speakers?"
        r"|amazon(?:'s)? alexa|alexa (?:voice|devices?|skills?))\b",
        re.I,
    ),
    # Capitalised product terms only: "the plane's autopilot" does not count.
    re.compile(r"\b(Autopilot|FSD|ADAS)\b"),
    # "Algorithm" only near a decision or harm word. Bare "algorithm" hits
    # dosing-algorithm recalls and CISA crypto advisories.
    re.compile(
        rf"\balgorithm(?:s|ic)?\b(?!\s+trading)[^.\n]{{0,60}}?\b{_ALGORITHM_CONTEXT}\b"
        rf"|\b{_ALGORITHM_CONTEXT}\b[^.\n]{{0,60}}?\balgorithm(?:s|ic)?\b(?!\s+trading)",
        re.I,
    ),
]

# Generic terms: they count toward the "clearly AI" threshold only when a core
# term is also present.
AI_GENERIC = [
    re.compile(
        r"\b(embedding|token|inference|fine[- ]?tun(?:ing|ed)|safety|alignment)\b",
        re.I,
    ),
    re.compile(r"\b(prompt|jailbreak|hallucination|red teaming)\b", re.I),
    re.compile(r"\b(dataset|inference api)\b", re.I),
    re.compile(r"\b(privacy|pii|data leakage|governance|compliance) in (ai|ml)\b", re.I),
]

AI_INCLUDE = [*AI_CORE, *AI_GENERIC]

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

    # Paywall / subscription interstitials carry no real article body. A FULL
    # article that merely mentions "subscribe" / "to continue reading" in its
    # footer has a substantial body and must pass — only treat it as a paywall
    # when the extracted body TEXT (not the raw HTML) is thin. (B-4 review)
    if sample and any(p.search(sample) for p in PAYWALL_PATTERNS):
        body_text = (extracted or _strip_tags_to_text(html)).strip()
        if len(body_text) < PAYWALL_MIN_BODY_CHARS:
            return PAYWALL_SKIP_MESSAGE

    if http_status is not None and http_status >= 400:
        # Auth/forbidden/proxy-auth/rate-limit are never real content; skip them
        # unconditionally so a bare "Access Denied"/"403 Forbidden" page (R-24)
        # no longer produces a junk risk row (B-4).
        if http_status in (401, 403, 407, 429):
            return FETCH_FAILED_SKIP_MESSAGE
        # Other 4xx/5xx (except the pure not-found codes) count as blocked when
        # the body also looks denied, bot-challenged, or too thin to be an article.
        if http_status not in (404, 410, 451):
            blob = f"{sample} {extracted}"
            if (
                any(p.search(blob) for p in ACCESS_DENIED_PATTERNS)
                or BOT_BLOCK_SIGNAL_RE.search(blob)
                or (0 < len(extracted) < 500)
            ):
                return FETCH_FAILED_SKIP_MESSAGE

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
    # Patterns carry their own case rules (the upper-case "ML" pattern is
    # case-sensitive), so the text is not lower-cased here.
    return sum(1 for p in patterns if p.search(text or ""))


# Tag/category lines that survive extraction ("Tags: air travel, football").
# The label is required so a normal sentence that mentions travel is kept.
_LABELED_METADATA_LIST_RE = re.compile(
    r"(?:^|(?<=[.!?])\s+|\n)\s*(?:blog\s+tags|tags|categories|filed\s+under)\s*:\s*[^.\n!?]*",
    re.I,
)


def _relevance_text(text: str) -> str:
    """Drop labeled tag and category lists from the text scored for AI relevance."""
    return _LABELED_METADATA_LIST_RE.sub(" ", text or "")


def _topic_blob(*, url: str = "", title: str = "", text: str = "") -> str:
    # Underscores are word characters to \b, so "/openai_chatgpt_bug/" style
    # slugs would never match; treat them as spaces.
    url = (url or "").replace("_", " ")
    return " ".join(
        part.strip()
        for part in (title, url, _relevance_text(text))
        if part and part.strip()
    ).strip()


def excluded_non_ai_topic_skip_reason(
    *,
    url: str = "",
    title: str = "",
    text: str = "",
) -> str | None:
    """Skip sports/travel/recipes only after the article body has been read.

    A URL or title alone must not classify the page as NOT_AI. An AI article
    whose headline or path mentions those topics stays in the pipeline until
    its content is available.
    """
    if not (text or "").strip():
        return None
    blob = _topic_blob(url=url, title=title, text=text)
    if not blob:
        return None
    exclude_hits = _hit_count(blob, AI_EXCLUDE)
    if exclude_hits == 0:
        return None

    include_hits = _hit_count(blob, AI_INCLUDE)
    threshold = 2
    if _hit_count(blob, AI_CORE) >= 1 and include_hits - exclude_hits >= threshold:
        return None

    head_blob = _topic_blob(url=url, title=title)
    if head_blob and _hit_count(head_blob, AI_CORE) >= 1:
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
    core_hits = _hit_count(blob, AI_CORE)
    exclude_hits = _hit_count(blob, AI_EXCLUDE)
    ok = (
        exclude_hits == 0
        and core_hits >= 1
        and (include_hits - exclude_hits) >= include_threshold
    )
    details = {
        "include_hits": include_hits,
        "core_hits": core_hits,
        "exclude_hits": exclude_hits,
        "threshold": include_threshold,
    }
    return ok, details


def has_no_ai_signal(text: str, *, title: str = "", url: str = "") -> bool:
    """True when the content carries zero AI signal at all (B-4).

    It fires when no AI_CORE term matches the title/url/text. Generic words
    alone (safety, token, inference, prompt, dataset, "mL" in a dosage) do not
    count as AI signal, so an FDA recall or a non-AI security advisory is
    skipped. A page with even one core AI mention is kept.
    This is the "no AI-relevant risk" gate used to skip inserting a risk row
    for off-topic pages (e.g. a CISA KEV alert about a non-AI CVE, R-30)
    without dropping borderline AI risks.
    """
    blob = _topic_blob(url=url, title=title, text=text)
    if not blob:
        return False
    return _hit_count(blob, AI_CORE) == 0
