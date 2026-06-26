import { db } from "../../db/index.js";
import { createArticleWithIngestJob } from "../../jobs/jobFactory.js";
import { HttpError } from "../../utils/httpError.js";
import { normalizeUrl } from "../../utils/fetchUtils.js";

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
 */
export async function enqueueManualJobUrl(
  rawUrl: string,
): Promise<ManualJobEnqueueResult> {
  let normalized: string;
  try {
    normalized = normalizeUrl(rawUrl);
  } catch {
    throw HttpError.badRequest("URL is not valid.");
  }

  const result = await db.transaction(async (tx) =>
    createArticleWithIngestJob(tx, {
      url: normalized,
      source: "manual",
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
