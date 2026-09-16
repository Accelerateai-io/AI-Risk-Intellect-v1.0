import { db } from "../../db/index.js";
import { createArticleWithIngestJob } from "../../jobs/jobFactory.js";
import { normalizeUrl } from "../../utils/fetchUtils.js";
import {
  getActiveJobUrls,
  resolveEnqueueModel,
  type EnqueueModelOptions,
} from "./discoveryEnqueue.service.js";
import type { ReportItemRef } from "./etlReportUploads.service.js";
import { isUrlDoNotExecute } from "../jobs/urlExecutionBlocks.service.js";

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
 * Snapshots the assigned LLM model onto each job at enqueue time.
 */
export async function enqueueReportsBatch(
  items: ReportsEnqueueItem[],
  options?: EnqueueModelOptions,
): Promise<number> {
  const activeJobs = await getActiveJobUrls();
  const model = await resolveEnqueueModel(options);
  let count = 0;

  for (const item of items) {
    let normalized: string;
    try {
      normalized = normalizeUrl(item.url);
    } catch {
      continue;
    }

    if (await isUrlDoNotExecute(normalized)) {
      continue;
    }

    if (activeJobs.has(normalized) && options?.batchRunId == null) continue;

    let result;
    try {
      result = await db.transaction(async (tx) =>
        createArticleWithIngestJob(tx, {
          url: normalized,
          source: "etl_reports",
          title: item.title,
          batchRunId: options?.batchRunId ?? null,
          modelName: model.modelName,
          modelLabel: model.modelLabel,
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
          batchRunId: options?.batchRunId ?? null,
          modelName: model.modelName,
          modelLabel: model.modelLabel,
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

export async function enqueueReportRefs(
  refs: ReportItemRef[],
  options?: EnqueueModelOptions,
): Promise<number> {
  return enqueueReportsBatch(
    refs.map((ref) => ({
      url: ref.url,
      title: ref.title,
    })),
    options,
  );
}
