import { SkipIngest } from "./errors.js";

export { SkipIngest };

/** Shown on the Jobs page when a site serves a bot-protection challenge instead of content. */
export const BOT_BLOCK_SKIP_MESSAGE =
  "Site blocked automated access (Cloudflare or bot protection page)";

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

  const status = options?.httpStatus;
  if (
    status != null &&
    [401, 403, 429].includes(status) &&
    extracted.length > 0 &&
    extracted.length < 500 &&
    BOT_BLOCK_SIGNAL_RE.test(`${sample} ${extracted}`)
  ) {
    return BOT_BLOCK_SKIP_MESSAGE;
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
  /\b(ai|artificial intelligence)\b/i,
  /\b(llms?|large language model|language model)\b/i,
  /\b(machine learning|ml|deep learning|neural network)\b/i,
  /\b(embedding|token|inference|fine[- ]?tuning|rlhf|safety|alignment)\b/i,
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

function topicBlob(parts: {
  url?: string;
  title?: string;
  text?: string;
}): string {
  return [parts.title, parts.url, parts.text]
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
