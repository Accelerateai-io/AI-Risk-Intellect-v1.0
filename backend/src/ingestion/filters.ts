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

const AI_INCLUDE = [
  /\b(openai|chatgpt|gpt-4|gpt-3|gemini|anthropic|claude|copilot|deepseek)\b/i,
  // "AIs" is the same token as "AI". Plurals are the same terms, not new topics.
  /\b(ais?|artificial intelligence)\b/i,
  /\b(llms?|large language models?|language models?)\b/i,
  /\b(machine learning|ml|deep learning|neural network)\b/i,
  /\b(embedding|token|inference|fine[- ]?tun(?:ing|ed)|rlhf|safety|alignment)\b/i,
  /\b(prompt|prompt injection|jailbreak|hallucination|red teaming)\b/i,
  /\b(model weights?|training data|dataset|inference api)\b/i,
  /\b(privacy|pii|data leakage|governance|compliance) in (ai|ml)\b/i,
];

const AI_EXCLUDE = [
  /\b(sports|football|basketball|baseball|soccer|golf|tennis)\b/i,
  /\b(recipes?|cooking|travel|tourism|celebrity|fashion|beauty)\b/i,
  /\b(stock photos?|coupon|promo|giveaway)\b/i,
];

function hitCount(text: string, patterns: RegExp[]): number {
  const low = (text || "").toLowerCase();
  return patterns.reduce((n, p) => (p.test(low) ? n + 1 : n), 0);
}

export type ClassifyDetails = {
  include_hits: number;
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
 */
export const JOB_SKIP_REASON_CODES = {
  FETCH_FAIL: "FETCH_FAIL",
  NOT_AI: "NOT_AI",
  MERGED: "MERGED",
} as const;

export type JobSkipReasonCode =
  (typeof JOB_SKIP_REASON_CODES)[keyof typeof JOB_SKIP_REASON_CODES];

const NOT_AI_REASON_RE =
  /not ai related|no ai-?relevant risk|no ai risk|not about ai|no ai signal/i;

// Note: deliberately excludes the job execution-time ladder message ("took more
// than N minutes without finishing") — that is a timeout outcome, not a fetch
// failure, so it classifies as neither code.
const FETCH_FAIL_REASON_RE =
  /blocked automated access|paywall|subscription wall|fetch failed|access-denied|access denied|forbidden|returned an error|could not (?:fetch|reach)|did not respond|connection (?:timed out|refused|was reset)|cannot resolve hostname|ssl\/tls|\bHTTP \d{3}\b|not found|page not found|html text too small|pdf text too small|raw text too small|too little text|empty html|empty response body/i;

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
  return [parts.title, parts.url, relevanceText(parts.text)]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .trim();
}

/** Return skip reason when sports/travel/recipes/etc. appear without enough AI context. */
export function getExcludedNonAiTopicSkipReason(parts: {
  url?: string;
  title?: string;
  text?: string;
}): string | null {
  const blob = topicBlob(parts);
  if (!blob) return null;

  const exclude_hits = hitCount(blob, AI_EXCLUDE);
  if (exclude_hits === 0) return null;

  const include_hits = hitCount(blob, AI_INCLUDE);
  const threshold = 2;
  // News pages often mention Travel/Sports/Food in nav/footer chrome. Do not skip
  // when the article itself is clearly AI-related.
  if (include_hits - exclude_hits >= threshold) return null;

  const headBlob = topicBlob({ url: parts.url, title: parts.title });
  if (headBlob && hitCount(headBlob, AI_INCLUDE) >= 1) return null;

  return NOT_AI_RELATED_SKIP_MESSAGE;
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
  const exclude_hits = hitCount(blob, AI_EXCLUDE);
  const ok =
    exclude_hits === 0 && include_hits - exclude_hits >= threshold;

  return [ok, { include_hits, exclude_hits, threshold }];
}
