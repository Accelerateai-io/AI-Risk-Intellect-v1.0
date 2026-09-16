import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  ACTIVE_JOB_STATUSES,
  createArticleWithIngestJob,
} from "../../jobs/jobFactory.js";
import { batchRuns } from "../../schema/batchRuns/batchRuns.js";
import { jobs } from "../../schema/jobs/jobs.js";
import { createLogger } from "../../logger/index.js";
import { normalizeUrl } from "../../utils/fetchUtils.js";
import { getLlmModelConfig } from "./llmModelConfig.service.js";
import { requestWorkerServiceStart } from "./workerManager.service.js";
import { isUrlDoNotExecute } from "../jobs/urlExecutionBlocks.service.js";

const discoveryEnqueueLog = createLogger("discovery-enqueue");

function isMissingIngestRefColumnError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes('column "ingest_link_id" does not exist') ||
    message.includes('column "ingest_link_item_id" does not exist')
  );
}

function isMissingModelColumnError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes('column "model_name" does not exist') ||
    message.includes('column "model_label" does not exist')
  );
}

/** Item IDs that already have any ingest job row (any status). */
export async function getIngestLinkItemIdsWithIngestJobs(
  itemIds: number[],
): Promise<Set<number>> {
  const uniqueIds = [...new Set(itemIds)];
  if (uniqueIds.length === 0) return new Set();

  const rows = await db
    .select({ ingestLinkItemId: jobs.ingestLinkItemId })
    .from(jobs)
    .where(
      and(
        inArray(jobs.ingestLinkItemId, uniqueIds),
        eq(jobs.jobType, "ingest"),
      ),
    );

  return new Set(
    rows
      .map((row) => row.ingestLinkItemId)
      .filter((id): id is number => id != null),
  );
}

/** URLs with a pending or running job — port of Python active-job dedupe. */
export async function getActiveJobUrls(): Promise<Set<string>> {
  const rows = await db
    .select({ url: jobs.url })
    .from(jobs)
    .where(inArray(jobs.status, [...ACTIVE_JOB_STATUSES]));
  return new Set(rows.map((r) => r.url));
}

export type DiscoveryEnqueueItem = {
  url: string;
  ingestLinkId?: number | null;
  ingestLinkItemId?: number | null;
};

export type EnqueueModelOptions = {
  batchRunId?: number | null;
  modelName?: string | null;
  modelLabel?: string | null;
};

/** Prefer explicit model → batch-assigned model → live Controls model. */
export async function resolveEnqueueModel(
  options?: EnqueueModelOptions,
): Promise<{
  modelName: string | null;
  modelLabel: string | null;
}> {
  const fromOptions = options?.modelName?.trim() || null;
  if (fromOptions) {
    return {
      modelName: fromOptions,
      modelLabel: options?.modelLabel?.trim() || fromOptions,
    };
  }

  if (options?.batchRunId != null) {
    const [batch] = await db
      .select({
        modelName: batchRuns.modelName,
        modelLabel: batchRuns.modelLabel,
      })
      .from(batchRuns)
      .where(eq(batchRuns.id, options.batchRunId))
      .limit(1);
    if (batch?.modelName?.trim()) {
      return {
        modelName: batch.modelName.trim(),
        modelLabel: batch.modelLabel?.trim() || batch.modelName.trim(),
      };
    }
  }

  const config = getLlmModelConfig();
  const modelName = config.modelId?.trim() || null;
  return {
    modelName,
    modelLabel: config.modelLabel?.trim() || modelName,
  };
}

/**
 * Queue discovery URLs as article shell + pending ingest job.
 * Snapshots the LLM model onto each job so later Controls changes do not
 * rewrite extraction for URLs already in flight.
 */
export async function enqueueDiscoveryBatch(
  items: DiscoveryEnqueueItem[],
  options?: EnqueueModelOptions,
): Promise<number> {
  let count = 0;
  let skippedExisting = 0;
  let supportsIngestRefs = true;
  let supportsModelColumns = true;
  const model = await resolveEnqueueModel(options);

  for (const item of items) {
    let normalized: string;
    try {
      normalized = normalizeUrl(item.url);
    } catch {
      continue;
    }

    if (await isUrlDoNotExecute(normalized)) {
      skippedExisting += 1;
      continue;
    }

    const baseInput = {
      url: normalized,
      source: "rss" as const,
      ingestLinkId: item.ingestLinkId ?? null,
      ingestLinkItemId: item.ingestLinkItemId ?? null,
      batchRunId: options?.batchRunId ?? null,
      ...(supportsModelColumns
        ? { modelName: model.modelName, modelLabel: model.modelLabel }
        : {}),
    };

    let result;
    if (supportsIngestRefs) {
      try {
        result = await db.transaction(async (tx) =>
          createArticleWithIngestJob(tx, baseInput),
        );
      } catch (err) {
        if (supportsModelColumns && isMissingModelColumnError(err)) {
          supportsModelColumns = false;
        } else if (!isMissingIngestRefColumnError(err)) {
          throw err;
        } else {
          supportsIngestRefs = false;
        }
      }
    }

    if (!result) {
      result = await db.transaction(async (tx) =>
        createArticleWithIngestJob(tx, {
          url: normalized,
          source: "rss",
          batchRunId: options?.batchRunId ?? null,
          ...(supportsModelColumns
            ? { modelName: model.modelName, modelLabel: model.modelLabel }
            : {}),
        }),
      );
    }

    if (result.jobCreated) {
      count += 1;
    } else {
      skippedExisting += 1;
    }
  }

  if (skippedExisting > 0 && count === 0) {
    discoveryEnqueueLog.info(
      "All URLs already have ingest jobs for their feed items",
      { skippedExisting },
    );
  }

  if (count > 0 || (options?.batchRunId != null && skippedExisting > 0)) {
    discoveryEnqueueLog.info("Enqueued discovery jobs with assigned model", {
      count,
      skippedExisting,
      modelName: model.modelName,
      batchRunId: options?.batchRunId ?? null,
    });
    await requestWorkerServiceStart();
  }

  return count;
}
