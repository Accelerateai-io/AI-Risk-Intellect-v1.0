import dns from "node:dns/promises";
import os from "node:os";
import { extractTitleFromHtml } from "../../ingestion/extractText.js";
import {
  detectBotBlockPage,
  looksLikeSoft404,
  FETCH_FAILED_SKIP_MESSAGE,
} from "../../ingestion/filters.js";
import { isBlockedResolvedIp } from "./ipAddress.js";

import { createLogger } from "../../logger/logger.js";

const fetchLog = createLogger("fetch");

/** One Chrome identity. Client hints must match this UA. */
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const CHROME_CLIENT_HINTS: Record<string, string> = {
  "Sec-Ch-Ua": '"Chromium";v="126", "Google Chrome";v="126", "Not.A/Brand";v="24"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
};

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent": CHROME_UA,
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Upgrade-Insecure-Requests": "1",
  ...CHROME_CLIENT_HINTS,
};

/**
 * Same Chrome identity as the first request. The retry only adds a cache-busting
 * fetch site hint sites sometimes require; it does not switch to Safari.
 */
const BROWSER_RETRY_HEADERS: Record<string, string> = {
  ...DEFAULT_HEADERS,
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

/** Below this raw-body size a response is a stub/error page, not an article (B-4). */
const MIN_FETCH_BODY_CHARS = 500;

/** Browser-like headers for RSS/Atom feed fetch (many sites block bot user agents). */
export const FEED_FETCH_HEADERS: Record<string, string> = {
  "User-Agent": CHROME_UA,
  Accept:
    "application/rss+xml, application/xml, text/xml, application/atom+xml, application/octet-stream, */*",
  "Accept-Language": "en-US,en;q=0.5",
  Connection: "keep-alive",
};

export class UrlFetchError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "INVALID_URL"
      | "SSRF_BLOCKED"
      | "DNS_FAILED"
      | "NOT_FOUND"
      | "UNREACHABLE",
  ) {
    super(message);
    this.name = "UrlFetchError";
  }
}

/**
 * Normalize URL for storage and deduplication (port of `job_factory.normalize_url`).
 * Strips whitespace, adds https:// when missing, lowercases host, strips fragment.
 */
export function normalizeUrl(raw: string): string {
  let url = (raw ?? "").trim();
  if (!url) {
    throw new TypeError("URL is empty.");
  }
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  const parsed = new URL(url);
  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase();
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }
  return parsed.toString();
}

function assertUrlFormat(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UrlFetchError("URL is not valid.", "INVALID_URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UrlFetchError(
      `Invalid URL scheme: ${parsed.protocol.replace(":", "")}`,
      "INVALID_URL",
    );
  }

  if (!parsed.hostname) {
    throw new UrlFetchError("URL has no hostname", "INVALID_URL");
  }

  if (parsed.username || parsed.password) {
    throw new UrlFetchError(
      "URLs with credentials are not allowed",
      "INVALID_URL",
    );
  }

  return parsed;
}

/**
 * Validate URL format only (scheme, hostname, no credentials).
 * Skips SSRF/DNS resolution checks — used as RSS ingest fallback.
 */
export async function validateUrlBasic(url: string): Promise<void> {
  assertUrlFormat(url);
}

/**
 * Validate URL scheme and reject private/reserved IP ranges (SSRF prevention).
 * Port of `app.utils.fetch_utils.validate_url`.
 */
export async function validateUrl(url: string): Promise<void> {
  const parsed = assertUrlFormat(url);

  if (isBlockedResolvedIp(parsed.hostname)) {
    throw new UrlFetchError(
      `URL resolves to a private/reserved IP: ${parsed.hostname}`,
      "SSRF_BLOCKED",
    );
  }

  try {
    const records = await dns.lookup(parsed.hostname, {
      all: true,
      verbatim: true,
    });
    for (const record of records) {
      if (isBlockedResolvedIp(record.address)) {
        throw new UrlFetchError(
          `URL resolves to a private/reserved IP: ${record.address}`,
          "SSRF_BLOCKED",
        );
      }
    }
  } catch (err) {
    if (err instanceof UrlFetchError) throw err;
    throw new UrlFetchError(
      `Cannot resolve hostname: ${parsed.hostname}`,
      "DNS_FAILED",
    );
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type ErrnoLike = Error & { code?: string };

/** Walk nested `error.cause` chains from Node/undici fetch failures. */
function unwrapFetchError(err: unknown): unknown {
  let current: unknown = err;
  for (let depth = 0; depth < 6; depth += 1) {
    if (
      current instanceof Error &&
      current.cause != null &&
      current.cause !== current
    ) {
      current = current.cause;
      continue;
    }
    break;
  }
  return current;
}

/**
 * Turn low-level fetch/network errors into user-facing job skip messages.
 */
export function describeFetchNetworkError(err: unknown): string {
  const root = unwrapFetchError(err);
  const top = err instanceof Error ? err : new Error(String(err));
  const rootErr = root instanceof Error ? root : top;
  const code = (rootErr as ErrnoLike).code ?? (top as ErrnoLike).code;
  const message = `${top.message} ${rootErr.message}`.trim();

  if (top.name === "AbortError" || rootErr.name === "AbortError") {
    return "The site did not respond in time (connection timed out).";
  }

  if (code === "ENOTFOUND" || /getaddrinfo ENOTFOUND/i.test(message)) {
    const host = message.match(/ENOTFOUND\s+(\S+)/i)?.[1];
    return host
      ? `Cannot resolve hostname "${host}" (DNS lookup failed).`
      : "Cannot resolve hostname (DNS lookup failed).";
  }

  if (code === "EAI_AGAIN") {
    return "Temporary DNS failure — try again later.";
  }

  if (code === "ECONNREFUSED") {
    return "Connection refused — the server is not accepting connections.";
  }

  if (
    code === "ETIMEDOUT" ||
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "UND_ERR_HEADERS_TIMEOUT" ||
    code === "UND_ERR_BODY_TIMEOUT"
  ) {
    return "Connection timed out — the server took too long to respond.";
  }

  if (code === "ECONNRESET" || code === "UND_ERR_SOCKET") {
    return "Connection was reset by the server or network.";
  }

  if (
    code === "CERT_HAS_EXPIRED" ||
    code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
    code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
    /certificate|cert_|ssl|tls/i.test(message)
  ) {
    return "SSL/TLS certificate error — could not establish a secure connection.";
  }

  if (code === "ERR_INVALID_URL") {
    return "URL is not valid.";
  }

  const detail = rootErr.message.trim();
  if (detail && detail.toLowerCase() !== "fetch failed") {
    return `Could not reach the site — ${detail}`;
  }

  return "Could not reach the site — connection failed (DNS, SSL, firewall, or the server may be down).";
}

/** Normalize fetch-layer skip reasons for the Jobs info panel. */
export function formatPageFetchSkipReason(reason: string): string {
  const trimmed = reason.trim();
  if (!trimmed) {
    return "Could not fetch this URL.";
  }

  if (
    trimmed.includes("blocked automated access") ||
    trimmed.startsWith("Cannot resolve hostname") ||
    trimmed.startsWith("Could not reach the site") ||
    trimmed.startsWith("Connection ") ||
    trimmed.startsWith("The site did not respond") ||
    trimmed.startsWith("SSL/TLS") ||
    trimmed.startsWith("Temporary DNS") ||
    trimmed.startsWith("URL is not valid")
  ) {
    return trimmed;
  }

  if (trimmed.startsWith("timeout")) {
    return "The site did not respond in time (connection timed out).";
  }

  if (trimmed.startsWith("HTTP ")) {
    return `The site returned an error (${trimmed}).`;
  }

  if (trimmed.startsWith("network error:")) {
    const detail = trimmed.slice("network error:".length).trim();
    if (!detail || detail.toLowerCase() === "fetch failed") {
      return "Could not reach the site — connection failed (DNS, SSL, firewall, or the server may be down).";
    }
    return `Could not reach the site — ${detail}`;
  }

  if (trimmed.startsWith("fetch failed:")) {
    return formatPageFetchSkipReason(
      trimmed.slice("fetch failed:".length).trim(),
    );
  }

  return `Could not fetch this URL — ${trimmed}`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export type FetchHtmlResult = {
  html: string;
  extracted: string;
};

/**
 * Fetch HTML with basic soft-404 detection.
 * Port of `app.utils.fetch_utils.fetch_html`.
 */
export async function fetchHtml(
  url: string,
  timeoutMs = 15_000,
): Promise<FetchHtmlResult | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    try {
      const headRes = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
        signal: controller.signal,
        headers: DEFAULT_HEADERS,
      });
      if ([404, 410, 451].includes(headRes.status)) {
        return null;
      }
    } catch {
      // HEAD may fail on some servers; continue with GET.
    }

    const getRes = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: DEFAULT_HEADERS,
    });

    await sleep(500);

    if (getRes.status >= 400) {
      return null;
    }

    const html = await getRes.text();
    const extracted = stripHtml(html);

    if (
      looksLikeSoft404(html, getRes.status, {
        extractedText: extracted,
        minTextBytes: 500,
      })
    ) {
      return null;
    }

    return { html, extracted };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new UrlFetchError(
        "The site did not respond in time (connection timed out).",
        "UNREACHABLE",
      );
    }
    throw new UrlFetchError(describeFetchNetworkError(err), "UNREACHABLE");
  } finally {
    clearTimeout(timer);
  }
}

export type PageContent =
  | { kind: "html"; html: string; title: string }
  | { kind: "pdf"; bytes: Buffer; title: string };

export type PageFetchOutcome =
  | { ok: true; page: PageContent }
  | { ok: false; reason: string };

/** Keep a refusal status on the skip message so a later job can show it. */
function withHttpStatus(reason: string, status: number): string {
  if (status < 400 || /\bHTTP \d{3}\b/.test(reason)) return reason;
  return `${reason} (HTTP ${status})`;
}

const FETCH_TRANSPORT_ATTEMPTS = 3;
const TRANSIENT_HTTP = new Set([408, 429, 500, 502, 503, 504]);

const CDN_RESTRICTION_RE =
  /akamai|access denied|attention required|cf-ray|cloudflare|captcha|bot detection|request blocked|reference #[0-9a-f.]+/i;

function fetchEnvironment(): Record<string, string> {
  return {
    host: os.hostname(),
    nodeEnv: process.env.NODE_ENV ?? "",
    egressNote:
      "Compare this host with the machine where FTC fetches succeed. Akamai can 404 by source IP.",
  };
}

function notFoundReason(status: number, body: string, forPdf: boolean): string {
  const sample = body.slice(0, 4000);
  if (CDN_RESTRICTION_RE.test(sample)) {
    return `suspected CDN or security restriction (HTTP ${status})`;
  }
  return forPdf ? `HTTP ${status} for PDF` : `HTTP ${status}`;
}

function logFetch(details: Record<string, unknown>): void {
  fetchLog.info("page fetch", { ...fetchEnvironment(), ...details });
}
const FETCH_TIMEOUT_REASON =
  "The site did not respond in time (connection timed out).";

/**
 * Fetch page bytes for ingestion pipeline (no soft-404 / AI filter here).
 * A timeout or dropped connection is retried once with a fresh timer.
 * The job's own abort signal is not retried.
 */
export async function fetchPageContentDetailed(
  url: string,
  timeoutMs = 30_000,
  externalSignal?: AbortSignal,
): Promise<PageFetchOutcome> {
  if (externalSignal?.aborted) {
    return { ok: false, reason: FETCH_TIMEOUT_REASON };
  }

  let lastReason = FETCH_FAILED_SKIP_MESSAGE;
  for (
    let transportAttempt = 0;
    transportAttempt < FETCH_TRANSPORT_ATTEMPTS;
    transportAttempt++
  ) {
    if (externalSignal?.aborted) {
      return { ok: false, reason: FETCH_TIMEOUT_REASON };
    }
    try {
      const outcome = await fetchPageContentOnce(url, timeoutMs, externalSignal);
      if (outcome.ok) return outcome;
      const retryable =
        /^(HTTP (404|410|451)|suspected CDN)/.test(outcome.reason) ||
        /\bHTTP (408|429|500|502|503|504)\b/.test(outcome.reason);
      if (transportAttempt === FETCH_TRANSPORT_ATTEMPTS - 1 || !retryable) {
        return outcome;
      }
      await sleep(500 * 2 ** transportAttempt);
      continue;
    } catch (err) {
      if (externalSignal?.aborted) {
        return { ok: false, reason: FETCH_TIMEOUT_REASON };
      }
      const timedOut =
        err instanceof Error &&
        (err.name === "AbortError" || err.name === "TimeoutError");
      lastReason = timedOut
        ? FETCH_TIMEOUT_REASON
        : describeFetchNetworkError(err);
      if (transportAttempt === FETCH_TRANSPORT_ATTEMPTS - 1) {
        return { ok: false, reason: lastReason };
      }
    }
  }
  return { ok: false, reason: lastReason };
}

async function fetchPageContentOnce(
  url: string,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<PageFetchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (externalSignal?.aborted) {
    clearTimeout(timer);
    return { ok: false, reason: FETCH_TIMEOUT_REASON };
  }
  externalSignal?.addEventListener("abort", onExternalAbort, { once: true });

  // Blocked / denied / paywalled / tiny responses are retried ONCE with a
  // fuller browser fingerprint before the URL is given up on (B-4). If both
  // attempts look blocked the job ends as a fetch failure with no risk row.
  const headerCandidates = [DEFAULT_HEADERS, BROWSER_RETRY_HEADERS];
  try {
    let lastBlockReason = "";
    for (let attempt = 0; attempt < headerCandidates.length; attempt++) {
      const getRes = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: headerCandidates[attempt]!,
      });

      const contentType = (getRes.headers.get("content-type") ?? "")
        .toLowerCase();
      logFetch({
        url,
        attempt,
        status: getRes.status,
        finalUrl: getRes.url,
        redirected: getRes.redirected,
        contentType,
        server: getRes.headers.get("server") ?? "",
      });
      if (getRes.redirected && getRes.url) {
        try {
          await validateUrl(getRes.url);
        } catch (err) {
          const message = err instanceof Error ? err.message : "redirect blocked";
          return { ok: false, reason: message };
        }
      }
      const isPdf =
        contentType.includes("application/pdf") ||
        url.toLowerCase().split("?")[0]!.endsWith(".pdf");

      if (TRANSIENT_HTTP.has(getRes.status)) {
        lastBlockReason = `HTTP ${getRes.status}`;
        await sleep(400 * 2 ** attempt);
        continue;
      }

      if ([404, 410, 451].includes(getRes.status)) {
        const body = await getRes.text();
        lastBlockReason = notFoundReason(getRes.status, body, isPdf);
        if (attempt < headerCandidates.length - 1) continue;
        return { ok: false, reason: lastBlockReason };
      }

      if (isPdf) {
        const bytes = Buffer.from(await getRes.arrayBuffer());
        return { ok: true, page: { kind: "pdf", bytes, title: "" } };
      }

      const html = await getRes.text();

      // Judge "too small" and the paywall gate on the extracted body TEXT, not
      // the raw HTML: a page can carry kilobytes of markup/nav chrome yet have
      // almost no article text, and a full article can mention "subscribe" in
      // its footer without being a paywall. (B-4 review)
      const extractedText = stripHtml(html);
      const botBlock = detectBotBlockPage(html, {
        httpStatus: getRes.status,
        extractedText,
      });
      const tooSmall = extractedText.trim().length < MIN_FETCH_BODY_CHARS;
      if (botBlock || tooSmall) {
        const reason = botBlock
          ? botBlock
          : html.trim()
            ? FETCH_FAILED_SKIP_MESSAGE
            : "empty response body";
        lastBlockReason = withHttpStatus(reason, getRes.status);
        continue; // one retry with a browser user agent
      }

      return {
        ok: true,
        page: {
          kind: "html",
          html,
          title: extractTitleFromHtml(html),
        },
      };
    }

    return { ok: false, reason: lastBlockReason || FETCH_FAILED_SKIP_MESSAGE };
  } catch (err) {
    if (externalSignal?.aborted) {
      return { ok: false, reason: FETCH_TIMEOUT_REASON };
    }
    throw err;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}

/** @deprecated Prefer fetchPageContentDetailed for skip reasons. */
export async function fetchPageContent(
  url: string,
  timeoutMs = 30_000,
): Promise<PageContent | null> {
  const result = await fetchPageContentDetailed(url, timeoutMs);
  return result.ok ? result.page : null;
}

/** Validate + fetch; throws when URL cannot be ingested. */
export async function assertUrlFetchable(url: string): Promise<void> {
  await validateUrl(url);
  const result = await fetchHtml(url);
  if (!result) {
    throw new UrlFetchError(
      "URL returned 404, soft 404, or insufficient content.",
      "NOT_FOUND",
    );
  }
}
