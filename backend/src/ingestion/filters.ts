import { SkipIngest } from "./errors.js";

export { SkipIngest };

/** Shown on the Jobs page when a site serves a bot-protection challenge instead of content. */
export const BOT_BLOCK_SKIP_MESSAGE =
  "Site blocked automated access (Cloudflare or bot protection page)";

/** Shown when the fetch returned an auth/forbidden/rate-limit status (B-4). */
export const FETCH_FAILED_SKIP_MESSAGE =
  "Fetch failed: the site returned an error or access-denied response";

/** Shown when the page is a subscription / paywall interstitial (B-4). */
export const PAYWALL_SKIP_MESSAGE =
  "Site served a paywall or subscription wall instead of content";

/** Bare access-denied / forbidden error pages (no Cloudflare challenge markup). */
const ACCESS_DENIED_PATTERNS = [
  /access denied/i,
  /\b403\b[^\n]{0,20}\bforbidden\b/i,
  /\bforbidden\b/i,
  /you (?:don'?t|do not) have permission/i,
  /not authori[sz]ed/i,
  /request (?:blocked|unauthorized)/i,
  /error[\s:]*403/i,
];

/** Subscription / paywall interstitials that carry no real article body. */
const PAYWALL_PATTERNS = [
  /subscribe to (?:continue|read)/i,
  /subscribers? only/i,
  /to continue reading/i,
  /create a (?:free )?account to (?:continue|read)/i,
  /this (?:article|content|story) is (?:for|available to) subscribers/i,
  /already a subscriber\?/i,
  /metered paywall/i,
];

const BOT_BLOCK_HTML_PATTERNS = [
  /just a moment/i,
  /enable javascript and cookies to continue/i,
  /please enable js(?:\s+and disable any ad blocker)?/i,
  /challenges\.cloudflare\.com/i,
  /cf-browser-verification/i,
  /checking your browser/i,
  /attention required!?\s*\|\s*cloudflare/i,
  /cf-challenge/i,
  /ddos protection by cloudflare/i,
  /performing security verification/i,
  /please wait while we verify/i,
  /__cf_chl/i,
  /datadome/i,
];

const BOT_BLOCK_EXTRACTED_PATTERNS = [
  /^enable javascript and cookies to continue$/i,
  /^checking your browser before accessing/i,
  /^please enable cookies/i,
  /please enable js(?:\s+and disable any ad blocker)?/i,
];

const BOT_BLOCK_SIGNAL_RE =
  /cloudflare|javascript|cookies|challenge|verify|enable js|ad blocker|datadome/i;

/** Below this many chars of extracted body TEXT a paywall marker means a stub. */
const PAYWALL_MIN_BODY_CHARS = 500;

/** Crudely strip HTML to its visible text, for the paywall thinness check. */
function stripTagsToText(html: string): string {
  return (html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Detect Cloudflare and similar bot-protection challenge pages.
 * Returns a user-facing skip reason, or null when the page looks normal.
 */
export function detectBotBlockPage(
  html: string,
  options?: { extractedText?: string | null; httpStatus?: number },
): string | null {
  const sample = (html || "").slice(0, 12_000);
  if (sample && BOT_BLOCK_HTML_PATTERNS.some((p) => p.test(sample))) {
    return BOT_BLOCK_SKIP_MESSAGE;
  }

  const extracted = (options?.extractedText ?? "").trim();
  if (
    extracted &&
    BOT_BLOCK_EXTRACTED_PATTERNS.some((p) => p.test(extracted))
  ) {
    return BOT_BLOCK_SKIP_MESSAGE;
  }

  // Paywall / subscription interstitials carry no real article body. A FULL
  // article that merely mentions "subscribe" / "to continue reading" in its
  // footer has a substantial body and must pass — only treat it as a paywall
  // when the extracted body TEXT (not the raw HTML) is thin. (B-4 review)
  if (sample && PAYWALL_PATTERNS.some((p) => p.test(sample))) {
    const bodyText = (options?.extractedText ?? stripTagsToText(html)).trim();
    if (bodyText.length < PAYWALL_MIN_BODY_CHARS) {
      return PAYWALL_SKIP_MESSAGE;
    }
  }

  const status = options?.httpStatus;
  if (status != null && status >= 400) {
    // 401/403/407/429 are never real content — auth, forbidden, proxy-auth or
    // rate-limit. Previously these were skipped only when the page also matched
    // a Cloudflare keyword, so a bare "Access Denied" / "403 Forbidden" page
    // (R-24) slipped through and produced a junk risk row. Treat them as a
    // blocked fetch unconditionally (B-4).
    if ([401, 403, 407, 429].includes(status)) {
      return FETCH_FAILED_SKIP_MESSAGE;
    }
    // Other 4xx/5xx (except the pure not-found codes, which have their own
    // HTTP-status handling) count as blocked when the body also looks denied,
    // bot-challenged, or too thin to be an article.
    if (![404, 410, 451].includes(status)) {
      const blob = `${sample} ${extracted}`;
      if (
        ACCESS_DENIED_PATTERNS.some((p) => p.test(blob)) ||
        BOT_BLOCK_SIGNAL_RE.test(blob) ||
        (extracted.length > 0 && extracted.length < 500)
      ) {
        return FETCH_FAILED_SKIP_MESSAGE;
      }
    }
  }

  return null;
}

// ---------- Soft 404 / empty-content detection ----------

const SOFT_404_PAT =
  /(404|not\s+found|page\s+not\s+found|page\s+removed|gone|error\s+404)/i;

/** Detect real and "soft" 404s or nav-only pages. Port of `looks_like_soft_404`. */
export function looksLikeSoft404(
  html: string,
  status: number,
  options?: { extractedText?: string | null; minTextBytes?: number },
): boolean {
  const minTextBytes = options?.minTextBytes ?? 500;
  const extractedText = options?.extractedText;

  if (status === 404 || status === 410 || status === 451) {
    return true;
  }

  if (html && SOFT_404_PAT.test(html.slice(0, 2000) || "")) {
    return true;
  }

  if (extractedText != null && extractedText.trim().length < minTextBytes) {
    return true;
  }

  return false;
}

// ---------- Fast AI-topic classifier (regex keywords; no LLM) ----------

// Words that make "algorithm" about a decision about people, not maths or code.
const ALGORITHM_CONTEXT =
  String.raw`(?:deny|denied|denials?|decid\w*|decisions?|discriminat\w*|bias(?:ed)?` +
  String.raw`|eligib\w*|hiring|tenants?|rents?|credit|lending|loans?|pricing` +
  String.raw`|polic(?:e|ing)|benefits|surveillance|amplif\w*|feeds?|content moderation` +
  String.raw`|social media|welfare|fairness|accountab\w*)`;

// Terms that on their own mean the page is about AI. A page needs at least one
// of these to count as AI content. Generic words that also appear in recalls,
// security advisories and finance news (safety, token, inference, prompt,
// dataset...) only add weight on top of a core term. Mirrors AI_CORE in
// python/app/ingestion/filters.py.
const AI_CORE = [
  // Products and labs. Gemini only with Google/AI context (Gemini Trust is a
  // crypto exchange).
  new RegExp(
    String.raw`\b(openai|chatgpt|gpt[-‐‑ ]?\d\w*|gpts|anthropic|claude|copilot` +
    String.raw`|deepseek|grok|xai|google(?:'s)? gemini|gemini (?:ai|app|advanced|pro` +
    String.raw`|ultra|nano|flash|live|\d)|llama[- ]?\d\w*|midjourney|stable diffusion` +
    String.raw`|dall[- ·]?e|character\.ai|hugging ?face|perplexity ai|mistral ai` +
    String.raw`|google bard|bing chat|openai'?s sora|meta ai|apple intelligence)\b`,
    "i",
  ),
  // "AI" and its spellings. "A.I." is the New York Times house style.
  /\b(ai|genai|agentic|artificial[- ]intelligence)\b|\bA\.I\./i,
  // Plural "AIs" only in this case, so CISA's "AIS" (Automated Indicator
  // Sharing) and maritime AIS do not count.
  /\bAIs\b/,
  // Model and method terms.
  new RegExp(
    String.raw`\b(llms?|(?:large[- ])?language[- ]models?|machine[- ]learning` +
    String.raw`|deep[- ]learning|neural[- ]net(?:work)?s?|reinforcement learning` +
    String.raw`|diffusion models?|transformer (?:models?|architecture)` +
    String.raw`|federated learning|adversarial (?:examples?|attacks?|robustness)` +
    String.raw`|reward models?|in-context learning|chain[- ]of[- ]thought` +
    String.raw`|retrieval[- ]augmented|rlhf|prompt injection|model weights?` +
    String.raw`|training data|vlms?|vision[- ]language models?|foundation models?` +
    String.raw`|computer vision)\b`,
    "i",
  ),
  // "ML" only upper-case and only with a model word after it. A bare \bml\b
  // matched "10 mL" and "50 MG/ML" in FDA recalls.
  new RegExp(
    String.raw`\b(?:AI/ML|MLOps|ML[- ](?:models?|systems?|based|powered|driven` +
    String.raw`|pipelines?|algorithms?|engineers?))\b`,
  ),
  // Applications and harms.
  new RegExp(
    String.raw`\b(chatbots?|deepfakes?|facial[- ]recognition|face[- ]recognition` +
    String.raw`|algorithmic(?!\s+trading)|self[- ]driving|robotaxis?|driverless` +
    String.raw`|autonomous (?:vehicles?|driving|cars?|trucks?|weapons?|agents?)|waymo` +
    String.raw`|tesla(?:'s)? autopilot|full self[- ]driving|automated (?:decision` +
    String.raw`|valuation|underwriting|hiring|employment|eligibility|screening)\w*` +
    String.raw`|predictive (?:policing|analytics|algorithms?)|recommend(?:ation` +
    String.raw`|er) (?:systems?|algorithms?|engines?)|risk[- ]scoring (?:tools?` +
    String.raw`|algorithms?|models?)|voice[- ]clon\w*|synthetic (?:media|voices?` +
    String.raw`|imagery)|nudify\w*|(?:ai|machine|computer)[- ]generated` +
    String.raw`|generative (?:models?|tools?|systems?))\b`,
    "i",
  ),
  // Driver assistance, lab and model names, and detection systems that the AI
  // Incident Database tracks as AI incidents (Tesla Autopilot crashes, phantom
  // braking, ShotSpotter). Found by running the gate on the 27 Oct prod export.
  new RegExp(
    String.raw`\b(deepmind|gemini (?:robotics|omni|image|models?|api|cli|code)` +
      String.raw`|driver[- ]assist(?:ance|ed)?|automatic emergency braking|phantom braking` +
      String.raw`|gunshot detection|shotspotter|recommendation algorithms?` +
      String.raw`|amazon (?:q|nova)|tesla(?:'s)?\b[^.\n]{0,40}\bautopilot` +
      String.raw`|voice[- ]assistants?|virtual assistants?|smart speakers?` +
      String.raw`|amazon(?:'s)? alexa|alexa (?:voice|devices?|skills?))\b`,
    "i",
  ),
  // Capitalised product terms only: "the plane's autopilot" does not count.
  /\b(Autopilot|FSD|ADAS)\b/,
  // "Algorithm" only near a decision or harm word. Bare "algorithm" hits
  // dosing-algorithm recalls and CISA crypto advisories.
  new RegExp(
    String.raw`\balgorithm(?:s|ic)?\b(?!\s+trading)[^.\n]{0,60}?\b${ALGORITHM_CONTEXT}\b` +
      String.raw`|\b${ALGORITHM_CONTEXT}\b[^.\n]{0,60}?\balgorithm(?:s|ic)?\b(?!\s+trading)`,
    "i",
  ),
];

// Generic terms: they count toward the "clearly AI" threshold only when a core
// term is also present.
const AI_GENERIC = [
  /\b(embedding|token|inference|fine[- ]?tun(?:ing|ed)|safety|alignment)\b/i,
  /\b(prompt|jailbreak|hallucination|red teaming)\b/i,
  /\b(dataset|inference api)\b/i,
  /\b(privacy|pii|data leakage|governance|compliance) in (ai|ml)\b/i,
];

const AI_INCLUDE = [...AI_CORE, ...AI_GENERIC];

const AI_EXCLUDE = [
  /\b(sports|football|basketball|baseball|soccer|golf|tennis)\b/i,
  /\b(recipes?|cooking|travel|tourism|celebrity|fashion|beauty)\b/i,
  /\b(stock photos?|coupon|promo|giveaway)\b/i,
];

function hitCount(text: string, patterns: RegExp[]): number {
  // Patterns carry their own case rules (the upper-case "ML" pattern is
  // case-sensitive), so the text is not lower-cased here.
  const src = text || "";
  return patterns.reduce((n, p) => (p.test(src) ? n + 1 : n), 0);
}

export type ClassifyDetails = {
  include_hits: number;
  core_hits: number;
  exclude_hits: number;
  threshold: number;
};

/** Job skip reason when URL/title/content matches a non-AI topic pattern. */
export const NOT_AI_RELATED_SKIP_MESSAGE = "not ai related";

/**
 * Machine-readable outcome codes stored on the job (B-4). They let ops query
 * *why* a job produced no risk row without string-matching the human message.
 *   FETCH_FAIL — the page could not be fetched as real content (bot block,
 *                paywall, auth/forbidden/rate-limit, network/HTTP error, soft-404).
 *   NOT_AI     — the page was fetched fine but carries no AI-relevant risk.
 *   MERGED     — the article was attached to an existing risk; no new row.
 *   RESEARCH   — the URL is a research-paper source, out of scope for AIRI.
 */
export const JOB_SKIP_REASON_CODES = {
  FETCH_FAIL: "FETCH_FAIL",
  NOT_AI: "NOT_AI",
  MERGED: "MERGED",
  RESEARCH: "RESEARCH",
  EXTRACTION_QUALITY: "EXTRACTION_QUALITY",
} as const;

export type JobSkipReasonCode =
  (typeof JOB_SKIP_REASON_CODES)[keyof typeof JOB_SKIP_REASON_CODES];

const NOT_AI_REASON_RE =
  /not ai related|no ai-?relevant risk|no ai risk|not about ai|no ai signal/i;

// Note: deliberately excludes the job execution-time ladder message ("took more
// than N minutes without finishing") — that is a timeout outcome, not a fetch
// failure, so it classifies as neither code.
const FETCH_FAIL_REASON_RE =
  /blocked automated access|paywall|subscription wall|fetch failed|access-denied|access denied|forbidden|suspected cdn|security restriction|returned an error|could not (?:fetch|reach)|did not respond|connection (?:timed out|refused|was reset)|cannot resolve hostname|ssl\/tls|\bHTTP \d{3}\b|not found|page not found|html text too small|pdf text too small|raw text too small|too little text|empty html|empty response body/i;

/**
 * Classify a human skip reason into a stable outcome code, or null when the
 * reason is neither a fetch failure nor a not-AI outcome (e.g. a timeout ladder
 * message or a do-not-execute block). NOT_AI is checked first because a not-AI
 * message never also implies a fetch failure.
 */
export function jobSkipReasonCode(
  reason: string | null | undefined,
): JobSkipReasonCode | null {
  const text = (reason ?? "").trim();
  if (!text) return null;
  if (/^merged with existing risk$/i.test(text)) {
    return JOB_SKIP_REASON_CODES.MERGED;
  }
  if (/^research paper source\b/i.test(text)) {
    return JOB_SKIP_REASON_CODES.RESEARCH;
  }
  if (/^extraction quality\b/i.test(text)) {
    return JOB_SKIP_REASON_CODES.EXTRACTION_QUALITY;
  }
  if (NOT_AI_REASON_RE.test(text)) return JOB_SKIP_REASON_CODES.NOT_AI;
  if (FETCH_FAIL_REASON_RE.test(text)) return JOB_SKIP_REASON_CODES.FETCH_FAIL;
  return null;
}

/**
 * Tag and category lines that survive extraction ("Tags: air travel, football").
 * The label is required so a normal sentence that mentions travel is kept.
 */
const LABELED_METADATA_LIST_RE =
  /(?:^|(?<=[.!?])\s+|\n)\s*(?:blog\s+tags|tags|categories|filed\s+under)\s*:\s*[^.\n!?]*/gi;

function relevanceText(text: string | undefined): string {
  LABELED_METADATA_LIST_RE.lastIndex = 0;
  return (text ?? "").replace(LABELED_METADATA_LIST_RE, " ");
}

function topicBlob(parts: {
  url?: string;
  title?: string;
  text?: string;
}): string {
  // Underscores are word characters to \b, so "/openai_chatgpt_bug/" style
  // slugs would never match; treat them as spaces.
  const url = (parts.url ?? "").replace(/_/g, " ");
  return [parts.title, url, relevanceText(parts.text)]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .trim();
}

/**
 * Return a skip reason when the article body is about sports, travel, recipes,
 * and similar topics without enough AI context.
 * A URL or title alone is not enough: the body has to be read first, so an AI
 * article is not dropped because its address or headline mentions those words.
 */
export function getExcludedNonAiTopicSkipReason(parts: {
  url?: string;
  title?: string;
  text?: string;
}): string | null {
  if (!parts.text?.trim()) return null;
  const blob = topicBlob(parts);
  if (!blob) return null;

  const exclude_hits = hitCount(blob, AI_EXCLUDE);
  if (exclude_hits === 0) return null;

  const include_hits = hitCount(blob, AI_INCLUDE);
  const threshold = 2;
  // News pages often mention Travel/Sports/Food in nav/footer chrome. Do not skip
  // when the article itself is clearly AI-related.
  if (hitCount(blob, AI_CORE) >= 1 && include_hits - exclude_hits >= threshold) {
    return null;
  }

  const headBlob = topicBlob({ url: parts.url, title: parts.title });
  if (headBlob && hitCount(headBlob, AI_CORE) >= 1) return null;

  return NOT_AI_RELATED_SKIP_MESSAGE;
}

/**
 * True when the content carries no core AI term at all. Port of
 * `has_no_ai_signal` (the Python B-4 gate); generic words alone do not count.
 */
export function hasNoAiSignal(parts: {
  url?: string;
  title?: string;
  text?: string;
}): boolean {
  const blob = topicBlob(parts);
  if (!blob) return false;
  return hitCount(blob, AI_CORE) === 0;
}

/** Simple deterministic filter. Port of `classify_ai_related`. */
export function classifyAiRelated(
  text: string,
  options?: { title?: string; url?: string; includeThreshold?: number },
): [boolean, ClassifyDetails] {
  const title = options?.title ?? "";
  const url = options?.url ?? "";
  const threshold = options?.includeThreshold ?? 2;
  const blob = topicBlob({ title, url, text });

  const include_hits = hitCount(blob, AI_INCLUDE);
  const core_hits = hitCount(blob, AI_CORE);
  const exclude_hits = hitCount(blob, AI_EXCLUDE);
  const ok =
    exclude_hits === 0 &&
    core_hits >= 1 &&
    include_hits - exclude_hits >= threshold;

  return [ok, { include_hits, core_hits, exclude_hits, threshold }];
}
