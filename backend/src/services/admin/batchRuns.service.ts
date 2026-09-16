import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.js";
import { batchRunItems } from "../../schema/batchRuns/batchRunItems.js";
import { batchRuns } from "../../schema/batchRuns/batchRuns.js";
import { ingestLinks } from "../../schema/ingestLinks/ingestLinks.js";
import { jobs } from "../../schema/jobs/jobs.js";
import { normalizeUrl } from "../../utils/fetchUtils.js";
import { HttpError } from "../../utils/httpError.js";
import {
  getServicesStatus,
  startDiscoveryProcess,
} from "./discoveryManager.service.js";
import {
  resolveSelectedReportRefs,
  type ReportItemRef,
} from "./etlReportUploads.service.js";
import {
  resolveExtractedItemRefsByIds,
  type ExtractedItemRef,
} from "./ingestLinks.service.js";
import { getLlmModelConfig, setLlmModel, syncPythonLlmModel } from "./llmModelConfig.service.js";
import { enqueueReportRefs } from "./reportsEnqueue.service.js";
import {
  ensureWorkerProcessRunning,
  requestWorkerServiceStart,
} from "./workerManager.service.js";
import { withUsModelPrefix } from "../../utils/bedrockModelId.js";

export type StartBatchRunInput = {
  modelId?: string;
  ingestLinkIds?: number[];
  ingestLinkItemIds?: number[];
  uploadIds?: number[];
  reportIds?: number[];
  excludeReportIds?: number[];
};

export type BatchRunItemProcessingStatus =
  | "pending"
  | "running"
  | "done"
  | "failed";

export type BatchRunCounts = {
  total: number;
  pending: number;
  running: number;
  done: number;
  failed: number;
};

export type BatchRunItemDto = {
  id: number;
  serial: number;
  sourceType: "rss" | "etl";
  ingestLinkId: number | null;
  ingestLinkItemId: number | null;
  feedName: string | null;
  uploadId: number | null;
  reportId: number | null;
  url: string;
  title: string | null;
  status: string;
  /** Normalized ingest job state for UI: pending, running, done, or failed. */
  processingStatus: BatchRunItemProcessingStatus;
  errorMessage: string | null;
  createdAt: string;
};

export type BatchRunDto = {
  id: number;
  modelName: string;
  modelLabel: string | null;
  status: string;
  disabled: boolean;
  rssItemCount: number;
  etlItemCount: number;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  counts: BatchRunCounts;
  items?: BatchRunItemDto[];
};

function emptyBatchCounts(total = 0): BatchRunCounts {
  return {
    total,
    pending: total,
    running: 0,
    done: 0,
    failed: 0,
  };
}

function countsFromItemDtos(items: BatchRunItemDto[]): BatchRunCounts {
  const counts = emptyBatchCounts(0);
  counts.total = items.length;
  for (const item of items) {
    counts[item.processingStatus] += 1;
  }
  return counts;
}

function toBatchRunDto(
  row: typeof batchRuns.$inferSelect,
  items?: BatchRunItemDto[],
  counts?: BatchRunCounts,
): BatchRunDto {
  const fallbackTotal = row.rssItemCount + row.etlItemCount;
  return {
    id: row.id,
    modelName: row.modelName,
    modelLabel: row.modelLabel,
    status: row.status,
    disabled: Boolean(row.disabled),
    rssItemCount: row.rssItemCount,
    etlItemCount: row.etlItemCount,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    counts:
      counts ??
      (items ? countsFromItemDtos(items) : emptyBatchCounts(fallbackTotal)),
    ...(items ? { items } : {}),
  };
}

function normalizeJobToProcessingStatus(
  jobStatus: string,
): BatchRunItemProcessingStatus {
  const status = jobStatus.toLowerCase();
  if (status === "pending") return "pending";
  if (status === "running") return "running";
  if (status === "done" || status === "completed" || status === "skipped") {
    return "done";
  }
  if (status === "error" || status === "failed") return "failed";
  return "pending";
}

function resolveItemProcessingStatus(
  item: typeof batchRunItems.$inferSelect,
  jobStatus: string | null,
): BatchRunItemProcessingStatus {
  if (item.status === "failed") return "failed";
  if (jobStatus) return normalizeJobToProcessingStatus(jobStatus);
  return "pending";
}

async function resolveLatestJobStatusesForItems(
  items: Array<typeof batchRunItems.$inferSelect>,
): Promise<Map<number, string | null>> {
  const statusByItemId = new Map<number, string | null>();
  if (items.length === 0) return statusByItemId;

  const batchIds = [
    ...new Set(items.map((item) => item.batchRunId).filter((id) => id > 0)),
  ];

  const rssItemIds = [
    ...new Set(
      items
        .filter((item) => item.sourceType === "rss" && item.ingestLinkItemId != null)
        .map((item) => item.ingestLinkItemId as number),
    ),
  ];

  const etlUrls = [
    ...new Set(
      items
        .filter((item) => item.sourceType === "etl")
        .map((item) => {
          try {
            return normalizeUrl(item.url);
          } catch {
            return item.url.trim();
          }
        })
        .filter(Boolean),
    ),
  ];

  const latestByBatchAndIngest = new Map<string, string>();
  const latestByBatchAndUrl = new Map<string, string>();
  if (batchIds.length > 0) {
    const batchJobs = await db
      .select({
        batchRunId: jobs.batchRunId,
        ingestLinkItemId: jobs.ingestLinkItemId,
        url: jobs.url,
        status: jobs.status,
        id: jobs.id,
      })
      .from(jobs)
      .where(inArray(jobs.batchRunId, batchIds))
      .orderBy(desc(jobs.id));

    for (const job of batchJobs) {
      if (job.batchRunId == null) continue;
      if (job.ingestLinkItemId != null) {
        const ingestKey = `${job.batchRunId}:${job.ingestLinkItemId}`;
        if (!latestByBatchAndIngest.has(ingestKey)) {
          latestByBatchAndIngest.set(ingestKey, job.status);
        }
      }
      const rawUrlKey = `${job.batchRunId}:${job.url}`;
      if (!latestByBatchAndUrl.has(rawUrlKey)) {
        latestByBatchAndUrl.set(rawUrlKey, job.status);
      }
      try {
        const normalizedKey = `${job.batchRunId}:${normalizeUrl(job.url)}`;
        if (!latestByBatchAndUrl.has(normalizedKey)) {
          latestByBatchAndUrl.set(normalizedKey, job.status);
        }
      } catch {
        // URL may already be stored in a form normalizeUrl rejects.
      }
    }
  }

  const latestJobByIngestItemId = new Map<number, string>();
  if (rssItemIds.length > 0) {
    const rssJobs = await db
      .select({
        ingestLinkItemId: jobs.ingestLinkItemId,
        status: jobs.status,
        id: jobs.id,
      })
      .from(jobs)
      .where(inArray(jobs.ingestLinkItemId, rssItemIds))
      .orderBy(desc(jobs.id));

    for (const job of rssJobs) {
      if (job.ingestLinkItemId == null) continue;
      if (latestJobByIngestItemId.has(job.ingestLinkItemId)) continue;
      latestJobByIngestItemId.set(job.ingestLinkItemId, job.status);
    }
  }

  const latestJobByUrl = new Map<string, string>();
  if (etlUrls.length > 0) {
    const etlJobs = await db
      .select({
        url: jobs.url,
        status: jobs.status,
        id: jobs.id,
      })
      .from(jobs)
      .where(inArray(jobs.url, etlUrls))
      .orderBy(desc(jobs.id));

    for (const job of etlJobs) {
      if (latestJobByUrl.has(job.url)) continue;
      latestJobByUrl.set(job.url, job.status);
    }
  }

  for (const item of items) {
    let jobStatus: string | null = null;

    if (item.sourceType === "rss" && item.ingestLinkItemId != null) {
      jobStatus =
        latestByBatchAndIngest.get(`${item.batchRunId}:${item.ingestLinkItemId}`) ??
        latestJobByIngestItemId.get(item.ingestLinkItemId) ??
        null;
    } else if (item.sourceType === "etl") {
      let normalized = item.url.trim();
      try {
        normalized = normalizeUrl(item.url);
      } catch {
        normalized = item.url.trim();
      }
      jobStatus =
        latestByBatchAndUrl.get(`${item.batchRunId}:${item.url}`) ??
        latestByBatchAndUrl.get(`${item.batchRunId}:${normalized}`) ??
        latestJobByUrl.get(normalized) ??
        latestJobByUrl.get(item.url.trim()) ??
        null;
    }

    statusByItemId.set(item.id, jobStatus);
  }

  return statusByItemId;
}

function toItemDto(
  row: typeof batchRunItems.$inferSelect,
  jobStatus: string | null = null,
  serial = 1,
): BatchRunItemDto {
  return {
    id: row.id,
    serial,
    sourceType: row.sourceType,
    ingestLinkId: row.ingestLinkId,
    ingestLinkItemId: row.ingestLinkItemId,
    feedName: row.feedName,
    uploadId: row.uploadId,
    reportId: row.reportId,
    url: row.url,
    title: row.title,
    status: row.status,
    processingStatus: resolveItemProcessingStatus(row, jobStatus),
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
  };
}

async function mapItemsToDto(
  items: Array<typeof batchRunItems.$inferSelect>,
): Promise<BatchRunItemDto[]> {
  const jobStatuses = await resolveLatestJobStatusesForItems(items);
  const ordered = [...items].sort((a, b) => a.id - b.id);
  return ordered.map((item, index) =>
    toItemDto(item, jobStatuses.get(item.id) ?? null, index + 1),
  );
}

async function countsByBatchRunId(
  batchIds: number[],
): Promise<Map<number, BatchRunCounts>> {
  const countsById = new Map<number, BatchRunCounts>();
  for (const id of batchIds) {
    countsById.set(id, emptyBatchCounts(0));
  }
  if (batchIds.length === 0) return countsById;

  const items = await db
    .select()
    .from(batchRunItems)
    .where(inArray(batchRunItems.batchRunId, batchIds));

  const jobStatuses = await resolveLatestJobStatusesForItems(items);
  for (const item of items) {
    const counts = countsById.get(item.batchRunId);
    if (!counts) continue;
    counts.total += 1;
    counts[resolveItemProcessingStatus(item, jobStatuses.get(item.id) ?? null)] += 1;
  }

  return countsById;
}

type BatchRunRow = typeof batchRuns.$inferSelect;

let activationLock: Promise<BatchRunRow | null> | null = null;

function resolveRequestedModelIdentity(modelId: string): {
  modelName: string;
  modelLabel: string;
} {
  const trimmed = modelId.trim();
  const config = getLlmModelConfig();
  const option =
    config.options.find((entry) => entry.id === trimmed) ??
    (config.modelId === trimmed
      ? { id: config.modelId, label: config.modelLabel }
      : null);

  return {
    modelName: option?.id ?? trimmed,
    modelLabel: option?.label ?? trimmed,
  };
}

async function syncBatchRunStatus(batchId: number): Promise<BatchRunRow | null> {
  const [batch] = await db
    .select()
    .from(batchRuns)
    .where(eq(batchRuns.id, batchId))
    .limit(1);

  if (!batch || batch.disabled || batch.status !== "running") {
    return batch ?? null;
  }

  const items = await db
    .select()
    .from(batchRunItems)
    .where(eq(batchRunItems.batchRunId, batchId))
    .orderBy(asc(batchRunItems.id));

  if (items.length === 0) {
    return batch;
  }

  const itemDtos = await mapItemsToDto(items);
  const processingStatuses = itemDtos.map((item) => item.processingStatus);
  const hasActive = processingStatuses.some(
    (status) => status === "pending" || status === "running",
  );

  if (hasActive) {
    return batch;
  }

  const doneCount = processingStatuses.filter((status) => status === "done").length;
  const failedCount = processingStatuses.filter(
    (status) => status === "failed",
  ).length;

  let finalStatus: "completed" | "partial" | "failed";
  if (doneCount === 0) {
    finalStatus = "failed";
  } else if (failedCount > 0) {
    finalStatus = "partial";
  } else {
    finalStatus = "completed";
  }

  const completedAt = new Date();
  const [updated] = await db
    .update(batchRuns)
    .set({
      status: finalStatus,
      completedAt,
      updatedAt: completedAt,
    })
    .where(eq(batchRuns.id, batchId))
    .returning();

  return updated ?? batch;
}

async function findRunningBatchRow(): Promise<BatchRunRow | null> {
  const [row] = await db
    .select()
    .from(batchRuns)
    .where(and(eq(batchRuns.status, "running"), eq(batchRuns.disabled, false)))
    .orderBy(asc(batchRuns.createdAt))
    .limit(1);

  if (!row) return null;

  const synced = await syncBatchRunStatus(row.id);
  if (synced && synced.status === "running" && !synced.disabled) {
    return synced;
  }

  // Current batch finished — start the next queued batch if any.
  await tryActivateNextPendingBatch();

  const [nextRunning] = await db
    .select()
    .from(batchRuns)
    .where(and(eq(batchRuns.status, "running"), eq(batchRuns.disabled, false)))
    .orderBy(asc(batchRuns.createdAt))
    .limit(1);

  return nextRunning ?? null;
}

export async function getActiveBatchRun(): Promise<BatchRunDto | null> {
  const row = await findRunningBatchRow();
  return row ? toBatchRunDto(row) : null;
}

/** True while a batch run is actively processing (model locked, URLs in flight). */
export async function hasRunningBatchRun(): Promise<boolean> {
  const [row] = await db
    .select({ id: batchRuns.id })
    .from(batchRuns)
    .where(eq(batchRuns.status, "running"))
    .limit(1);
  return row != null;
}

async function ensureBatchWorkerRunning(): Promise<void> {
  ensureWorkerProcessRunning();
  await requestWorkerServiceStart();
}

function logBatchRunUrls(input: {
  batchId: number;
  modelName: string;
  modelLabel: string | null;
  rssRefs: Array<{ url: string }>;
  etlRefs: Array<{ url: string }>;
  mode: "started" | "queued" | "activated";
}): void {
  const label = input.modelLabel?.trim() || input.modelName;
  const prefix = `[batch-worker] batch #${input.batchId} ${input.mode} model=${label} (${input.modelName})`;

  for (const ref of input.rssRefs) {
    console.log(`${prefix} [RSS] url=${ref.url}`);
  }
  for (const ref of input.etlRefs) {
    console.log(`${prefix} [ETL] url=${ref.url}`);
  }
}

async function enqueueBatchSources(input: {
  batchId: number;
  rssRefs: Array<ExtractedItemRef & { feedName: string | null }>;
  etlRefs: ReportItemRef[];
}): Promise<{
  rssStarted: boolean;
  etlStarted: boolean;
  errors: string[];
}> {
  const errors: string[] = [];
  let rssStarted = false;
  let etlStarted = false;

  if (input.rssRefs.length > 0) {
    try {
      startDiscoveryProcess({
        ingestLinkIds: [
          ...new Set(input.rssRefs.map((ref) => ref.ingestLinkId)),
        ],
        ingestLinkItemIds: input.rssRefs.map((ref) => ref.id),
        batchRunId: input.batchId,
      });
      await ensureBatchWorkerRunning();
      await db
        .update(batchRunItems)
        .set({ status: "started" })
        .where(
          and(
            eq(batchRunItems.batchRunId, input.batchId),
            eq(batchRunItems.sourceType, "rss"),
          ),
        );
      rssStarted = true;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not start RSS discovery.";
      errors.push(message);
      await db
        .update(batchRunItems)
        .set({ status: "failed", errorMessage: message })
        .where(
          and(
            eq(batchRunItems.batchRunId, input.batchId),
            eq(batchRunItems.sourceType, "rss"),
          ),
        );
    }
  }

  if (input.etlRefs.length > 0) {
    try {
      await enqueueReportRefs(input.etlRefs, { batchRunId: input.batchId });
      await ensureBatchWorkerRunning();
      await db
        .update(batchRunItems)
        .set({ status: "started" })
        .where(
          and(
            eq(batchRunItems.batchRunId, input.batchId),
            eq(batchRunItems.sourceType, "etl"),
          ),
        );
      etlStarted = true;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not start ETL reports.";
      errors.push(message);
      await db
        .update(batchRunItems)
        .set({ status: "failed", errorMessage: message })
        .where(
          and(
            eq(batchRunItems.batchRunId, input.batchId),
            eq(batchRunItems.sourceType, "etl"),
          ),
        );
    }
  }

  return { rssStarted, etlStarted, errors };
}

export type RunningBatchModelRef = {
  batchId: number;
  modelName: string;
  modelLabel: string | null;
};

function modelIdentityKey(modelName: string): string {
  return withUsModelPrefix(modelName).toLowerCase();
}

async function resolveBatchModelById(
  batchRunId: number,
): Promise<RunningBatchModelRef | null> {
  const [row] = await db
    .select({
      batchId: batchRuns.id,
      modelName: batchRuns.modelName,
      modelLabel: batchRuns.modelLabel,
    })
    .from(batchRuns)
    .where(eq(batchRuns.id, batchRunId))
    .limit(1);

  return row ?? null;
}

export async function resolveRunningBatchForJob(input: {
  ingestLinkItemId?: number | null;
  url: string;
}): Promise<RunningBatchModelRef | null> {
  if (input.ingestLinkItemId != null) {
    const [row] = await db
      .select({
        batchId: batchRuns.id,
        modelName: batchRuns.modelName,
        modelLabel: batchRuns.modelLabel,
      })
      .from(batchRunItems)
      .innerJoin(batchRuns, eq(batchRuns.id, batchRunItems.batchRunId))
      .where(
        and(
          eq(batchRunItems.ingestLinkItemId, input.ingestLinkItemId),
          eq(batchRuns.status, "running"),
        ),
      )
      .orderBy(asc(batchRuns.createdAt))
      .limit(1);

    if (row) return row;
  }

  let normalizedUrl = input.url.trim();
  try {
    normalizedUrl = normalizeUrl(input.url);
  } catch {
    // keep trimmed url
  }

  const rows = await db
    .select({
      batchId: batchRuns.id,
      modelName: batchRuns.modelName,
      modelLabel: batchRuns.modelLabel,
      itemUrl: batchRunItems.url,
    })
    .from(batchRunItems)
    .innerJoin(batchRuns, eq(batchRuns.id, batchRunItems.batchRunId))
    .where(eq(batchRuns.status, "running"))
    .orderBy(asc(batchRuns.createdAt));

  for (const row of rows) {
    let itemUrl = row.itemUrl.trim();
    try {
      itemUrl = normalizeUrl(row.itemUrl);
    } catch {
      // keep trimmed url
    }
    if (itemUrl === normalizedUrl) {
      return {
        batchId: row.batchId,
        modelName: row.modelName,
        modelLabel: row.modelLabel,
      };
    }
  }

  return null;
}

/**
 * Before extraction, switch the worker/Python LLM to the model assigned on the
 * running batch for this URL (not whatever was last selected in Controls).
 */
export async function ensureAssignedBatchModelForJob(input: {
  batchRunId?: number | null;
  ingestLinkItemId?: number | null;
  url: string;
}): Promise<RunningBatchModelRef | null> {
  const batch =
    (input.batchRunId != null
      ? await resolveBatchModelById(input.batchRunId)
      : null) ?? (await resolveRunningBatchForJob(input));
  if (!batch) {
    console.warn(
      `[batch-worker] no batch model found for url=${input.url} batchRunId=${input.batchRunId ?? "—"} ingestLinkItemId=${input.ingestLinkItemId ?? "—"} — extraction will use the global Controls model`,
    );
    return null;
  }

  const synced = await syncPythonLlmModel(batch.modelName);
  if (!synced) {
    console.warn(
      `[batch-worker] could not sync Python to batch #${batch.batchId} model=${batch.modelName} before url=${input.url}`,
    );
  }

  try {
    await setLlmModel(batch.modelName);
  } catch (err) {
    console.warn(
      `[batch-worker] could not apply batch #${batch.batchId} model=${batch.modelName} in worker env: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  console.log(
    `[batch-worker] using batch #${batch.batchId} assigned model=${batch.modelLabel || batch.modelName} (${batch.modelName}) for url=${input.url}`,
  );

  return batch;
}

async function applyModelForBatch(modelName: string) {
  let model;
  try {
    model = await setLlmModel(modelName);
  } catch (err) {
    throw HttpError.badRequest(
      err instanceof Error
        ? err.message
        : "Could not apply the selected model for this batch.",
    );
  }

  if (model.pythonSynced === false) {
    throw HttpError.badRequest(
      "Model was saved but Python sync failed. Fix LLM sync, then retry the batch.",
    );
  }

  return model;
}

async function activatePendingBatch(
  batch: BatchRunRow,
): Promise<BatchRunRow | null> {
  const items = await db
    .select()
    .from(batchRunItems)
    .where(eq(batchRunItems.batchRunId, batch.id))
    .orderBy(asc(batchRunItems.id));

  const rssRefs = items
    .filter(
      (item) =>
        item.sourceType === "rss" &&
        item.ingestLinkItemId != null &&
        item.ingestLinkId != null,
    )
    .map((item) => ({
      id: item.ingestLinkItemId as number,
      ingestLinkId: item.ingestLinkId as number,
      url: item.url,
      feedName: item.feedName,
    }));

  const etlRefs = items
    .filter(
      (item) =>
        item.sourceType === "etl" &&
        item.reportId != null &&
        item.uploadId != null,
    )
    .map((item) => ({
      id: item.reportId as number,
      uploadId: item.uploadId as number,
      url: item.url,
      title: item.title,
    }));

  if (rssRefs.length === 0 && etlRefs.length === 0) {
    const failedAt = new Date();
    const [failed] = await db
      .update(batchRuns)
      .set({
        status: "failed",
        errorMessage: "Queued batch has no URLs to process.",
        completedAt: failedAt,
        updatedAt: failedAt,
      })
      .where(eq(batchRuns.id, batch.id))
      .returning();
    return failed ?? null;
  }

  try {
    await applyModelForBatch(batch.modelName);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not apply batch model.";
    const failedAt = new Date();
    const [failed] = await db
      .update(batchRuns)
      .set({
        status: "failed",
        errorMessage: message,
        completedAt: failedAt,
        updatedAt: failedAt,
      })
      .where(eq(batchRuns.id, batch.id))
      .returning();
    return failed ?? null;
  }

  logBatchRunUrls({
    batchId: batch.id,
    modelName: batch.modelName,
    modelLabel: batch.modelLabel,
    rssRefs,
    etlRefs,
    mode: "activated",
  });

  const { rssStarted, etlStarted, errors } = await enqueueBatchSources({
    batchId: batch.id,
    rssRefs,
    etlRefs,
  });

  const anyOk = rssStarted || etlStarted;
  const now = new Date();

  if (!anyOk) {
    const [failed] = await db
      .update(batchRuns)
      .set({
        status: "failed",
        errorMessage: errors.join(" ") || "Could not enqueue queued batch.",
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(batchRuns.id, batch.id))
      .returning();
    return failed ?? null;
  }

  const [updated] = await db
    .update(batchRuns)
    .set({
      status: "running",
      startedAt: now,
      completedAt: null,
      errorMessage: errors.length > 0 ? errors.join(" ") : null,
      updatedAt: now,
    })
    .where(eq(batchRuns.id, batch.id))
    .returning();

  if (updated) {
    await ensureBatchWorkerRunning();
  }

  return updated ?? batch;
}

async function tryActivateNextPendingBatch(): Promise<BatchRunRow | null> {
  if (activationLock) {
    return activationLock;
  }

  activationLock = (async () => {
    let activated: BatchRunRow | null = null;

    while (true) {
      const [running] = await db
        .select()
        .from(batchRuns)
        .where(and(eq(batchRuns.status, "running"), eq(batchRuns.disabled, false)))
        .orderBy(asc(batchRuns.createdAt))
        .limit(1);
      if (running) return activated ?? running;

      const [pending] = await db
        .select()
        .from(batchRuns)
        .where(and(eq(batchRuns.status, "pending"), eq(batchRuns.disabled, false)))
        .orderBy(asc(batchRuns.createdAt))
        .limit(1);
      if (!pending) return activated;

      const claimedAt = new Date();
      const [claimed] = await db
        .update(batchRuns)
        .set({
          status: "running",
          startedAt: claimedAt,
          updatedAt: claimedAt,
        })
        .where(
          and(
            eq(batchRuns.id, pending.id),
            eq(batchRuns.status, "pending"),
            eq(batchRuns.disabled, false),
          ),
        )
        .returning();

      if (!claimed) return activated;

      const result = await activatePendingBatch(claimed);
      if (result && result.status === "running") {
        return result;
      }
      // Activation failed — try the next queued batch.
      activated = result;
    }
  })().finally(() => {
    activationLock = null;
  });

  return activationLock;
}

export async function refreshBatchRunStatusForJob(input: {
  ingestLinkItemId?: number | null;
  url: string;
}): Promise<void> {
  const batchIds = new Set<number>();

  if (input.ingestLinkItemId != null) {
    const rows = await db
      .select({ batchRunId: batchRunItems.batchRunId })
      .from(batchRunItems)
      .innerJoin(batchRuns, eq(batchRuns.id, batchRunItems.batchRunId))
      .where(
        and(
          eq(batchRunItems.ingestLinkItemId, input.ingestLinkItemId),
          eq(batchRuns.status, "running"),
        ),
      );
    for (const row of rows) {
      batchIds.add(row.batchRunId);
    }
  }

  let normalizedUrl = input.url.trim();
  try {
    normalizedUrl = normalizeUrl(input.url);
  } catch {
    // keep trimmed url
  }

  const urlRows = await db
    .select({ batchRunId: batchRunItems.batchRunId, url: batchRunItems.url })
    .from(batchRunItems)
    .innerJoin(batchRuns, eq(batchRuns.id, batchRunItems.batchRunId))
    .where(eq(batchRuns.status, "running"));

  for (const row of urlRows) {
    let itemUrl = row.url.trim();
    try {
      itemUrl = normalizeUrl(row.url);
    } catch {
      // keep trimmed url
    }
    if (itemUrl === normalizedUrl) {
      batchIds.add(row.batchRunId);
    }
  }

  let finishedAny = false;
  for (const batchId of batchIds) {
    const before = await db
      .select({ status: batchRuns.status })
      .from(batchRuns)
      .where(eq(batchRuns.id, batchId))
      .limit(1);
    const synced = await syncBatchRunStatus(batchId);
    if (
      before[0]?.status === "running" &&
      synced &&
      synced.status !== "running"
    ) {
      finishedAny = true;
    }
  }

  if (finishedAny) {
    const activated = await tryActivateNextPendingBatch();
    if (activated?.status === "running") {
      await ensureBatchWorkerRunning();
    }
  }
}

async function resolveRssRefs(input: StartBatchRunInput): Promise<
  Array<ExtractedItemRef & { feedName: string | null }>
> {
  const itemIds = input.ingestLinkItemIds ?? [];
  if (itemIds.length === 0) return [];

  const refs = await resolveExtractedItemRefsByIds(itemIds);
  const linkIds = [...new Set(refs.map((ref) => ref.ingestLinkId))];
  const feedRows =
    linkIds.length > 0
      ? await db
          .select({
            id: ingestLinks.id,
            suggestedName: ingestLinks.suggestedName,
            url: ingestLinks.url,
          })
          .from(ingestLinks)
          .where(inArray(ingestLinks.id, linkIds))
      : [];
  const feedNameById = new Map(
    feedRows.map((row) => [
      row.id,
      row.suggestedName?.trim() || row.url || null,
    ]),
  );

  return refs.map((ref) => ({
    ...ref,
    feedName: feedNameById.get(ref.ingestLinkId) ?? null,
  }));
}

async function resolveEtlRefs(input: StartBatchRunInput): Promise<ReportItemRef[]> {
  const requestedReportIds = input.reportIds ?? [];
  const requestedUploadIds = input.uploadIds ?? [];
  const excludeReportIds = input.excludeReportIds ?? [];

  if (requestedReportIds.length === 0 && requestedUploadIds.length === 0) {
    return [];
  }

  const { refs } = await resolveSelectedReportRefs({
    uploadIds: requestedUploadIds,
    reportIds: requestedReportIds,
    excludeReportIds,
  });
  return refs;
}

export async function startBatchRun(input: StartBatchRunInput): Promise<{
  batch: BatchRunDto;
  message: string;
  services: ReturnType<typeof getServicesStatus>;
}> {
  const rssRefs = await resolveRssRefs(input);
  const etlRefs = await resolveEtlRefs(input);

  if (rssRefs.length === 0 && etlRefs.length === 0) {
    throw HttpError.badRequest(
      "Select at least one RSS feed URL or ETL report URL to run.",
    );
  }

  const requestedModelId =
    input.modelId?.trim() || getLlmModelConfig().modelId?.trim() || "";
  if (!requestedModelId) {
    throw HttpError.badRequest(
      "No LLM model is active. Set a model in System services first.",
    );
  }

  const modelIdentity = resolveRequestedModelIdentity(requestedModelId);
  const activeBatch = await findRunningBatchRow();
  const now = new Date();

  // Queue behind the active batch — do not switch model or enqueue yet.
  if (activeBatch) {
    const [batch] = await db
      .insert(batchRuns)
      .values({
        modelName: modelIdentity.modelName,
        modelLabel: modelIdentity.modelLabel,
        status: "pending",
        rssItemCount: rssRefs.length,
        etlItemCount: etlRefs.length,
        updatedAt: now,
      })
      .returning();

    if (!batch) {
      throw HttpError.internal("Could not queue batch run.");
    }

    const itemRows: Array<typeof batchRunItems.$inferInsert> = [
      ...rssRefs.map((ref) => ({
        batchRunId: batch.id,
        sourceType: "rss" as const,
        ingestLinkId: ref.ingestLinkId,
        ingestLinkItemId: ref.id,
        feedName: ref.feedName,
        url: ref.url,
        status: "pending" as const,
      })),
      ...etlRefs.map((ref) => ({
        batchRunId: batch.id,
        sourceType: "etl" as const,
        uploadId: ref.uploadId,
        reportId: ref.id,
        url: ref.url,
        title: ref.title,
        status: "pending" as const,
      })),
    ];

    if (itemRows.length > 0) {
      await db.insert(batchRunItems).values(itemRows);
    }

    const items = await db
      .select()
      .from(batchRunItems)
      .where(eq(batchRunItems.batchRunId, batch.id))
      .orderBy(asc(batchRunItems.id));

    const activeLabel =
      activeBatch.modelLabel?.trim() || activeBatch.modelName || "its model";
    const parts: string[] = [];
    if (rssRefs.length > 0)
      parts.push(`${rssRefs.length} RSS URL${rssRefs.length === 1 ? "" : "s"}`);
    if (etlRefs.length > 0)
      parts.push(
        `${etlRefs.length} ETL report${etlRefs.length === 1 ? "" : "s"}`,
      );

    logBatchRunUrls({
      batchId: batch.id,
      modelName: modelIdentity.modelName,
      modelLabel: modelIdentity.modelLabel,
      rssRefs,
      etlRefs,
      mode: "queued",
    });

    return {
      batch: toBatchRunDto(batch, await mapItemsToDto(items)),
      message: `Batch #${batch.id} queued with ${modelIdentity.modelLabel} (${parts.join(" + ")}). It will start automatically after Batch #${activeBatch.id} finishes (${activeLabel}).`,
      services: getServicesStatus(),
    };
  }

  // No active batch — apply model and start immediately.
  const model = await applyModelForBatch(requestedModelId);

  const [batch] = await db
    .insert(batchRuns)
    .values({
      modelName: model.modelId || modelIdentity.modelName,
      modelLabel: model.modelLabel || modelIdentity.modelLabel,
      status: "running",
      rssItemCount: rssRefs.length,
      etlItemCount: etlRefs.length,
      startedAt: now,
      updatedAt: now,
    })
    .returning();

  if (!batch) {
    throw HttpError.internal("Could not create batch run.");
  }

  const itemRows: Array<typeof batchRunItems.$inferInsert> = [
    ...rssRefs.map((ref) => ({
      batchRunId: batch.id,
      sourceType: "rss" as const,
      ingestLinkId: ref.ingestLinkId,
      ingestLinkItemId: ref.id,
      feedName: ref.feedName,
      url: ref.url,
      status: "pending" as const,
    })),
    ...etlRefs.map((ref) => ({
      batchRunId: batch.id,
      sourceType: "etl" as const,
      uploadId: ref.uploadId,
      reportId: ref.id,
      url: ref.url,
      title: ref.title,
      status: "pending" as const,
    })),
  ];

  if (itemRows.length > 0) {
    await db.insert(batchRunItems).values(itemRows);
  }

  const { rssStarted, etlStarted, errors } = await enqueueBatchSources({
    batchId: batch.id,
    rssRefs,
    etlRefs,
  });

  const bothRequested = rssRefs.length > 0 && etlRefs.length > 0;
  const bothOk = rssStarted && etlStarted;
  const anyOk = rssStarted || etlStarted;
  const enqueueErrors = errors.length > 0 ? errors.join(" ") : null;
  const finalStatus = anyOk ? "running" : "failed";
  const finishedAt = anyOk ? null : new Date();

  const [updated] = await db
    .update(batchRuns)
    .set({
      status: finalStatus,
      errorMessage: enqueueErrors,
      completedAt: finishedAt,
      updatedAt: finishedAt ?? new Date(),
    })
    .where(eq(batchRuns.id, batch.id))
    .returning();

  const items = await db
    .select()
    .from(batchRunItems)
    .where(eq(batchRunItems.batchRunId, batch.id))
    .orderBy(asc(batchRunItems.id));

  const parts: string[] = [];
  if (rssStarted)
    parts.push(`${rssRefs.length} RSS URL${rssRefs.length === 1 ? "" : "s"}`);
  if (etlStarted)
    parts.push(`${etlRefs.length} ETL report${etlRefs.length === 1 ? "" : "s"}`);

  const message =
    parts.length > 0
      ? bothRequested && !bothOk
        ? `Batch #${batch.id} started with ${model.modelLabel || model.modelId} (${parts.join(" + ")}). Some sources failed to enqueue.`
        : `Batch #${batch.id} started with ${model.modelLabel || model.modelId}: ${parts.join(" + ")}. URLs will run under this model until all jobs finish.`
      : `Batch #${batch.id} failed to start.`;

  if (!anyOk) {
    throw HttpError.badRequest(errors.join(" ") || message);
  }

  logBatchRunUrls({
    batchId: batch.id,
    modelName: model.modelId || modelIdentity.modelName,
    modelLabel: model.modelLabel || modelIdentity.modelLabel,
    rssRefs,
    etlRefs,
    mode: "started",
  });

  await ensureBatchWorkerRunning();

  return {
    batch: toBatchRunDto(updated ?? batch, await mapItemsToDto(items)),
    message,
    services: getServicesStatus(),
  };
}

export async function listBatchRuns(limit = 25): Promise<BatchRunDto[]> {
  const capped = Math.min(Math.max(limit, 1), 100);
  let rows = await db
    .select()
    .from(batchRuns)
    .orderBy(desc(batchRuns.createdAt))
    .limit(capped);

  const runningIds = rows
    .filter((row) => row.status === "running" && !row.disabled)
    .map((row) => row.id);

  let finishedAny = false;
  if (runningIds.length > 0) {
    for (const batchId of runningIds) {
      const synced = await syncBatchRunStatus(batchId);
      if (synced && synced.status !== "running") {
        finishedAny = true;
      }
    }
  }

  const hasPending = rows.some(
    (row) => row.status === "pending" && !row.disabled,
  );
  if (finishedAny || (hasPending && runningIds.length === 0)) {
    await tryActivateNextPendingBatch();
  }

  if (runningIds.length > 0 || finishedAny || hasPending) {
    rows = await db
      .select()
      .from(batchRuns)
      .orderBy(desc(batchRuns.createdAt))
      .limit(capped);
  }

  if (rows.some((row) => row.status === "running" && !row.disabled)) {
    await ensureBatchWorkerRunning();
  }

  const countsById = await countsByBatchRunId(rows.map((row) => row.id));
  return rows.map((row) => {
    const counted = countsById.get(row.id);
    const fallbackTotal = row.rssItemCount + row.etlItemCount;
    return toBatchRunDto(
      row,
      undefined,
      counted && counted.total > 0
        ? counted
        : emptyBatchCounts(fallbackTotal),
    );
  });
}

export async function getBatchRunById(id: number): Promise<BatchRunDto> {
  const [existing] = await db
    .select()
    .from(batchRuns)
    .where(eq(batchRuns.id, id))
    .limit(1);

  if (!existing) {
    throw HttpError.notFound(`Batch run #${id} was not found.`);
  }

  const row = (await syncBatchRunStatus(id)) ?? existing;

  if (existing.status === "running" && row.status !== "running") {
    const activated = await tryActivateNextPendingBatch();
    if (activated?.status === "running") {
      await ensureBatchWorkerRunning();
    }
  } else if (row.status === "running") {
    await ensureBatchWorkerRunning();
  }

  const items = await db
    .select()
    .from(batchRunItems)
    .where(eq(batchRunItems.batchRunId, id))
    .orderBy(asc(batchRunItems.id));

  return toBatchRunDto(row, await mapItemsToDto(items));
}

const BATCH_DISABLED_JOB_REASON = "Batch disabled";

/** Pause a queued or processing batch so it can be enabled later. */
export async function disableBatchRun(id: number): Promise<{
  id: number;
  status: string;
  disabled: boolean;
}> {
  const [batch] = await db
    .select({
      id: batchRuns.id,
      status: batchRuns.status,
      disabled: batchRuns.disabled,
    })
    .from(batchRuns)
    .where(eq(batchRuns.id, id))
    .limit(1);

  if (!batch) {
    throw HttpError.notFound(`Batch run #${id} was not found.`);
  }

  if (batch.disabled) {
    throw HttpError.conflict("This batch is already disabled.");
  }

  if (batch.status !== "pending" && batch.status !== "running") {
    throw HttpError.conflict(
      "Only queued or processing batches can be disabled.",
    );
  }

  const wasRunning = batch.status === "running";
  const now = new Date();

  await db
    .update(jobs)
    .set({
      status: "skipped",
      errorMessage: BATCH_DISABLED_JOB_REASON,
      updatedAt: now,
    })
    .where(
      and(
        eq(jobs.batchRunId, id),
        inArray(jobs.status, ["pending", "running"]),
      ),
    );

  const [updated] = await db
    .update(batchRuns)
    .set({
      disabled: true,
      status: "pending",
      updatedAt: now,
    })
    .where(eq(batchRuns.id, id))
    .returning({
      id: batchRuns.id,
      status: batchRuns.status,
      disabled: batchRuns.disabled,
    });

  if (wasRunning) {
    const activated = await tryActivateNextPendingBatch();
    if (activated?.status === "running") {
      await ensureBatchWorkerRunning();
    }
  }

  return updated ?? { ...batch, disabled: true, status: "pending" };
}

/** Re-enable a disabled batch so it can queue and run again. */
export async function enableBatchRun(id: number): Promise<{
  id: number;
  status: string;
  disabled: boolean;
}> {
  const [batch] = await db
    .select({
      id: batchRuns.id,
      status: batchRuns.status,
      disabled: batchRuns.disabled,
    })
    .from(batchRuns)
    .where(eq(batchRuns.id, id))
    .limit(1);

  if (!batch) {
    throw HttpError.notFound(`Batch run #${id} was not found.`);
  }

  if (!batch.disabled) {
    throw HttpError.conflict("This batch is not disabled.");
  }

  const now = new Date();

  await db
    .update(jobs)
    .set({
      status: "pending",
      errorMessage: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(jobs.batchRunId, id),
        eq(jobs.status, "skipped"),
        eq(jobs.errorMessage, BATCH_DISABLED_JOB_REASON),
      ),
    );

  const [updated] = await db
    .update(batchRuns)
    .set({
      disabled: false,
      status: "pending",
      completedAt: null,
      updatedAt: now,
    })
    .where(eq(batchRuns.id, id))
    .returning({
      id: batchRuns.id,
      status: batchRuns.status,
      disabled: batchRuns.disabled,
    });

  const activated = await tryActivateNextPendingBatch();
  if (activated?.status === "running") {
    await ensureBatchWorkerRunning();
  }

  return updated ?? { ...batch, disabled: false, status: "pending" };
}

/** @deprecated Use disableBatchRun. Kept so existing DELETE clients pause instead of removing. */
export async function deleteBatchRun(id: number): Promise<{
  id: number;
  status: string;
}> {
  return disableBatchRun(id);
}
