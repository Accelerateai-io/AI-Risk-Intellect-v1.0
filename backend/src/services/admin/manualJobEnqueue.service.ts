import { db } from "../../db/index.js";
import { createArticleWithIngestJob } from "../../jobs/jobFactory.js";
import { HttpError } from "../../utils/httpError.js";
import { normalizeUrl } from "../../utils/fetchUtils.js";
import { resolveEnqueueModel } from "./discoveryEnqueue.service.js";
import { isUrlDoNotExecute } from "../jobs/urlExecutionBlocks.service.js";

export type ManualJobEnqueueResult = {
  job: {
    id: number;
    url: string;
    status: string;
    jobType: string;
    source: string;
    createdAt: string;
  };
  created: boolean;
};

/**
 * Queue a manual ingest job for an article URL (Jobs → Enqueue).
 * SSRF / fetch / topic filters run in the worker — same as RSS and ETL.
 *
 * When `forceReprocess` is set (B-3) the job bypasses active-job dedup and the
 * worker inserts a NEW risk row linked to the one it supersedes.
 */
export async function enqueueManualJobUrl(
  rawUrl: string,
  options?: { forceReprocess?: boolean },
): Promise<ManualJobEnqueueResult> {
  let normalized: string;
  try {
    normalized = normalizeUrl(rawUrl);
  } catch {
    throw HttpError.badRequest("URL is not valid.");
  }

  const model = await resolveEnqueueModel();

  if (await isUrlDoNotExecute(normalized)) {
    throw HttpError.conflict(
      "This URL is marked do not execute. Use Execute on the job row to run it again.",
    );
  }

  const result = await db.transaction(async (tx) =>
    createArticleWithIngestJob(tx, {
      url: normalized,
      source: "manual",
      modelName: model.modelName,
      modelLabel: model.modelLabel,
      forceReprocess: options?.forceReprocess,
    }),
  );

  if (!result.jobCreated) {
    throw HttpError.conflict(
      "A pending or running job already exists for this URL.",
      {
        job: {
          id: result.job.id,
          url: result.job.url,
          status: result.job.status,
          jobType: result.job.jobType,
          source: result.job.source,
          createdAt: result.job.createdAt.toISOString(),
        },
      },
    );
  }

  return {
    job: {
      id: result.job.id,
      url: result.job.url,
      status: result.job.status,
      jobType: result.job.jobType,
      source: result.job.source,
      createdAt: result.job.createdAt.toISOString(),
    },
    created: true,
  };
}

export type BulkEnqueueItem =
  | { url: string; ok: true; jobId: number; status: string }
  | { url: string; ok: false; error: string };

export type BulkEnqueueResult = {
  total: number;
  enqueued: number;
  items: BulkEnqueueItem[];
};

/**
 * Enqueue a list of URLs in one call (B-3). Each URL is processed
 * independently so one bad URL never aborts the batch; failures are reported
 * per item. Used to re-run every golden article from scratch.
 */
export async function enqueueManualJobUrls(
  rawUrls: string[],
  options?: { forceReprocess?: boolean },
): Promise<BulkEnqueueResult> {
  const items: BulkEnqueueItem[] = [];
  let enqueued = 0;
  for (const rawUrl of rawUrls) {
    try {
      const result = await enqueueManualJobUrl(rawUrl, options);
      enqueued += 1;
      items.push({
        url: result.job.url,
        ok: true,
        jobId: result.job.id,
        status: result.job.status,
      });
    } catch (err) {
      const error =
        err instanceof HttpError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Could not enqueue this URL.";
      items.push({ url: rawUrl, ok: false, error });
    }
  }
  return { total: rawUrls.length, enqueued, items };
}
