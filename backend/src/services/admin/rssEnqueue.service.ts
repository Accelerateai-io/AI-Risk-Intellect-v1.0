import { db } from "../../db/index.js";
import { createArticleWithIngestJob } from "../../jobs/jobFactory.js";
import {
  normalizeUrl,
  validateUrl,
  UrlFetchError,
} from "../../utils/fetchUtils.js";

export type RssEnqueueResult =
  | { status: "created"; url: string }
  | { status: "skipped"; url: string; reason: string };

export async function enqueueRssUrl(
  rawUrl: string,
  title?: string | null,
): Promise<RssEnqueueResult> {
  let normalized: string;
  try {
    normalized = normalizeUrl(rawUrl);
  } catch {
    return { status: "skipped", url: rawUrl, reason: "invalid_url" };
  }

  try {
    await validateUrl(normalized);
  } catch (err) {
    const reason =
      err instanceof UrlFetchError ? err.code.toLowerCase() : "validation_failed";
    return { status: "skipped", url: normalized, reason };
  }

  const result = await db.transaction(async (tx) =>
    createArticleWithIngestJob(tx, {
      url: normalized,
      source: "rss",
      title,
    }),
  );

  if (!result.jobCreated) {
    return { status: "skipped", url: normalized, reason: "active_job_exists" };
  }

  return { status: "created", url: normalized };
}
