import { db } from "../../db/index.js";
import { createArticleWithIngestJob } from "../../jobs/jobFactory.js";
import { normalizeUrl } from "../../utils/fetchUtils.js";
import { getActiveJobUrls } from "./discoveryEnqueue.service.js";
import type { ReportItemRef } from "./etlReportUploads.service.js";

export type ReportsEnqueueItem = {
  url: string;
  title?: string | null;
};

function isMissingEtlReportsSourceError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('invalid input value for enum job_source: "etl_reports"');
}

/**
 * Queue report URLs as article shell + pending ingest job.
 * Uses source `etl_reports` so jobs appear as ETL Reports in the jobs table.
 */
export async function enqueueReportsBatch(
  items: ReportsEnqueueItem[],
): Promise<number> {
  const activeJobs = await getActiveJobUrls();
  let count = 0;

  for (const item of items) {
    let normalized: string;
    try {
      normalized = normalizeUrl(item.url);
    } catch {
      continue;
    }

    if (activeJobs.has(normalized)) continue;

    let result;
    try {
      result = await db.transaction(async (tx) =>
        createArticleWithIngestJob(tx, {
          url: normalized,
          source: "etl_reports",
          title: item.title,
        }),
      );
    } catch (err) {
      if (!isMissingEtlReportsSourceError(err)) {
        throw err;
      }
      result = await db.transaction(async (tx) =>
        createArticleWithIngestJob(tx, {
          url: normalized,
          source: "api",
          title: item.title,
        }),
      );
    }

    if (result.jobCreated) {
      activeJobs.add(normalized);
      count += 1;
    }
  }

  return count;
}

export async function enqueueReportRefs(refs: ReportItemRef[]): Promise<number> {
  return enqueueReportsBatch(
    refs.map((ref) => ({
      url: ref.url,
      title: ref.title,
    })),
  );
}
