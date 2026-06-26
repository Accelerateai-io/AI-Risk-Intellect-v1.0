import { ingestHtml, ingestPdf } from "./pipeline.js";
import { SkipIngest } from "./filters.js";
import type { PersistArticleResult } from "./persist.js";
import {
  fetchPageContent,
  validateUrl,
  UrlFetchError,
} from "../utils/fetchUtils.js";

export type IngestFromUrlResult = PersistArticleResult;

/**
 * Full manual URL ingestion: SSRF check → fetch → pipeline → persist.
 */
export async function ingestFromUrl(
  url: string,
  options?: { title?: string },
): Promise<IngestFromUrlResult> {
  await validateUrl(url);

  const page = await fetchPageContent(url);
  if (!page) {
    throw new UrlFetchError(
      "URL returned 404 or could not be fetched.",
      "NOT_FOUND",
    );
  }

  const title = options?.title?.trim() || page.title || "";

  try {
    if (page.kind === "pdf") {
      return await ingestPdf(page.bytes, { url, title, source: "manual" });
    }
    return await ingestHtml(page.html, { url, title, source: "manual" });
  } catch (err) {
    if (err instanceof SkipIngest) {
      throw err;
    }
    throw err;
  }
}
