import Parser from "rss-parser";
import { FEED_FETCH_HEADERS, normalizeUrl } from "../../utils/fetchUtils.js";

const FETCH_TIMEOUT_MS = 20_000;

const parser = new Parser({
  timeout: FETCH_TIMEOUT_MS,
  headers: FEED_FETCH_HEADERS,
});

function isFileDownloadResponse(
  contentType: string,
  contentDisposition: string,
  feedUrl: string,
): boolean {
  const disposition = contentDisposition.toLowerCase();
  if (disposition.includes("attachment")) return true;

  const type = contentType.toLowerCase();
  if (
    type.includes("application/octet-stream") ||
    type.includes("application/force-download") ||
    type.includes("binary/octet-stream")
  ) {
    return true;
  }

  const path = feedUrl.toLowerCase().split("?")[0] ?? "";
  return /\.(xml|rss|atom)$/i.test(path);
}

function looksLikeFeedXml(body: string): boolean {
  const start = body.trimStart().slice(0, 512).toLowerCase();
  return (
    start.startsWith("<?xml") ||
    start.includes("<rss") ||
    start.includes("<feed") ||
    start.includes("<rdf:rdf")
  );
}

export class FeedDownloadNotXmlError extends Error {
  constructor(
    message = "Downloaded file is not XML. Expected a valid RSS or Atom feed.",
  ) {
    super(message);
    this.name = "FeedDownloadNotXmlError";
  }
}

type FeedFetchResult = {
  body: string;
  wasDownload: boolean;
};

/** Download feed content from the URL (handles attachment/file responses). */
async function fetchFeedXml(feedUrl: string): Promise<FeedFetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(feedUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: FEED_FETCH_HEADERS,
    });

    if (!res.ok) {
      if (res.status === 403) {
        throw new Error(
          "HTTP 403 Forbidden — the site blocked this request. The feed URL may require browser access.",
        );
      }
      throw new Error(
        `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`,
      );
    }

    const contentType = res.headers.get("content-type") ?? "";
    const contentDisposition = res.headers.get("content-disposition") ?? "";
    const body = await res.text();

    if (!body.trim()) {
      throw new Error("Feed response was empty.");
    }

    const isDownload = isFileDownloadResponse(
      contentType,
      contentDisposition,
      res.url || feedUrl,
    );

    if (isDownload && !looksLikeFeedXml(body)) {
      throw new FeedDownloadNotXmlError();
    }

    if (!looksLikeFeedXml(body)) {
      throw new Error("Response is not valid RSS or Atom XML.");
    }

    return { body, wasDownload: isDownload };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Request timed out after ${FETCH_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function collectItemLinks(
  items: Parser.Item[] | undefined,
): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const item of items ?? []) {
    const raw = item.link?.trim() || item.guid?.trim();
    if (!raw || !/^https?:\/\//i.test(raw)) continue;
    try {
      const normalized = normalizeUrl(raw);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      urls.push(normalized);
    } catch {
      // skip invalid item URLs
    }
  }

  return urls;
}

/**
 * Fetch RSS/Atom XML (including attachment/download responses), parse it,
 * and return unique http(s) item links (normalized).
 */
export async function parseFeedItemLinks(feedUrl: string): Promise<string[]> {
  const { body } = await fetchFeedXml(feedUrl);
  const parsed = await parser.parseString(body);
  return collectItemLinks(parsed.items);
}
