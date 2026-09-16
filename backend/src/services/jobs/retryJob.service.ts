import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { jobs } from "../../schema/jobs/jobs.js";
import { HttpError } from "../../utils/httpError.js";
import { getLlmModelConfig } from "../admin/llmModelConfig.service.js";
import {
  clearUrlDoNotExecute,
  getUrlExecutionBlock,
  isUrlDoNotExecute,
} from "./urlExecutionBlocks.service.js";

export type RetryJobOptions = {
  /** Remove the URL block and run the job (Jobs → Execute). */
  allowDoNotExecute?: boolean;
  modelName?: string | null;
  modelLabel?: string | null;
};

const JOB_MODEL_NAME_MAX = 128;
const JOB_MODEL_LABEL_MAX = 256;
const TERMINAL_STATUSES = new Set([
  "done",
  "skipped",
  "error",
  "failed",
  "completed",
]);
const ACTIVE_STATUSES = new Set(["pending", "running"]);

function clip(value: string | null, max: number): string | null {
  if (!value) return null;
  return value.length <= max ? value : value.slice(0, max);
}

function isMissingJobColumnError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    /does not exist/i.test(message) &&
    /model_name|model_label|ingest_link_item/i.test(message)
  );
}

function databaseErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/value too long/i.test(message)) {
    return "The model id is too long to save on this job.";
  }
  if (/does not exist/i.test(message)) {
    return "Jobs schema is missing a required column. Restart the API so schema updates can apply.";
  }
  return message.trim() || "Failed to requeue job.";
}

function resolveRetryModel(input: {
  requestedName?: string | null;
  requestedLabel?: string | null;
  assignedName?: string | null;
  assignedLabel?: string | null;
  jobName?: string | null;
  jobLabel?: string | null;
}): { modelName: string | null; modelLabel: string | null } {
  const config = getLlmModelConfig();
  const requestedName = input.requestedName?.trim() || null;
  if (requestedName) {
    const option = config.options.find(
      (item) => item.id.toLowerCase() === requestedName.toLowerCase(),
    );
    return {
      modelName: clip(option?.id ?? requestedName, JOB_MODEL_NAME_MAX),
      modelLabel: clip(
        input.requestedLabel?.trim() || option?.label || requestedName,
        JOB_MODEL_LABEL_MAX,
      ),
    };
  }

  const assignedName = input.assignedName?.trim() || input.jobName?.trim() || null;
  if (assignedName) {
    return {
      modelName: clip(assignedName, JOB_MODEL_NAME_MAX),
      modelLabel: clip(
        input.assignedLabel?.trim() ||
          input.jobLabel?.trim() ||
          assignedName,
        JOB_MODEL_LABEL_MAX,
      ),
    };
  }

  const liveName = config.modelId?.trim() || null;
  return {
    modelName: clip(liveName, JOB_MODEL_NAME_MAX),
    modelLabel: clip(config.modelLabel?.trim() || liveName, JOB_MODEL_LABEL_MAX),
  };
}

type JobRow = {
  id: number;
  status: string;
  url: string;
  modelName: string | null;
  modelLabel: string | null;
  ingestLinkItemId: number | null;
};

async function loadJobForRetry(jobId: number): Promise<JobRow | null> {
  try {
    const [job] = await db
      .select({
        id: jobs.id,
        status: jobs.status,
        url: jobs.url,
        modelName: jobs.modelName,
        modelLabel: jobs.modelLabel,
        ingestLinkItemId: jobs.ingestLinkItemId,
      })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);
    return job ?? null;
  } catch (err) {
    if (!isMissingJobColumnError(err)) throw err;
    const [job] = await db
      .select({
        id: jobs.id,
        status: jobs.status,
        url: jobs.url,
      })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);
    if (!job) return null;
    return {
      ...job,
      modelName: null,
      modelLabel: null,
      ingestLinkItemId: null,
    };
  }
}

/** Reset a terminal job to pending so the worker can process it again. */
export async function retryJob(
  jobId: number,
  options?: RetryJobOptions,
): Promise<{
  id: number;
  status: string;
  modelName: string | null;
  modelLabel: string | null;
}> {
  const job = await loadJobForRetry(jobId);

  if (!job) {
    throw HttpError.notFound("Job not found.");
  }

  const status = job.status.toLowerCase();
  let blocked = false;
  try {
    blocked = await isUrlDoNotExecute(job.url);
  } catch (err) {
    if (!options?.allowDoNotExecute) throw err;
    blocked = true;
  }
  if (blocked && !options?.allowDoNotExecute) {
    throw HttpError.conflict(
      "This URL is marked do not execute. The LLM will not run for it.",
    );
  }

  if (!options?.allowDoNotExecute && !TERMINAL_STATUSES.has(status)) {
    throw HttpError.conflict(
      `Job is already ${job.status}. Wait for it to finish or stop the worker.`,
    );
  }

  const alreadyQueued = ACTIVE_STATUSES.has(status);
  if (options?.allowDoNotExecute && !alreadyQueued && !TERMINAL_STATUSES.has(status)) {
    throw HttpError.conflict(
      `Job is already ${job.status}. Wait for it to finish or stop the worker.`,
    );
  }

  let block: Awaited<ReturnType<typeof getUrlExecutionBlock>> = null;
  try {
    block = await getUrlExecutionBlock(job.url);
  } catch {
    block = null;
  }
  if (blocked || options?.allowDoNotExecute) {
    try {
      await clearUrlDoNotExecute(job.url);
    } catch (err) {
      throw HttpError.internal(databaseErrorMessage(err));
    }
  }

  const model = resolveRetryModel({
    requestedName: options?.modelName,
    requestedLabel: options?.modelLabel,
    assignedName: block?.modelName,
    assignedLabel: block?.modelLabel,
    jobName: job.modelName,
    jobLabel: job.modelLabel,
  });

  const modelFields = {
    ...(model.modelName ? { modelName: model.modelName } : {}),
    ...(model.modelLabel ? { modelLabel: model.modelLabel } : {}),
  };

  let updated: {
    id: number;
    status: string;
    modelName: string | null;
    modelLabel: string | null;
  } | undefined;

  try {
    const [row] = await db
      .update(jobs)
      .set({
        ...(alreadyQueued ? {} : { status: "pending" as const }),
        errorMessage: null,
        updatedAt: new Date(),
        ...modelFields,
      })
      .where(eq(jobs.id, jobId))
      .returning({
        id: jobs.id,
        status: jobs.status,
        modelName: jobs.modelName,
        modelLabel: jobs.modelLabel,
      });
    updated = row;
  } catch (err) {
    if (!isMissingJobColumnError(err)) {
      throw HttpError.internal(databaseErrorMessage(err));
    }
    const [row] = await db
      .update(jobs)
      .set({
        ...(alreadyQueued ? {} : { status: "pending" as const }),
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId))
      .returning({
        id: jobs.id,
        status: jobs.status,
      });
    if (row) {
      updated = {
        ...row,
        modelName: model.modelName,
        modelLabel: model.modelLabel,
      };
    }
  }

  if (!updated) {
    throw HttpError.internal("Failed to requeue job.");
  }

  try {
    const { refreshBatchRunStatusForJob } = await import(
      "../admin/batchRuns.service.js"
    );
    await refreshBatchRunStatusForJob({
      ingestLinkItemId: job.ingestLinkItemId,
      url: job.url,
    });
  } catch {
    // Batch refresh is best-effort; the job is already pending.
  }

  return updated;
}

/**
 * Jobs → Execute / Controls Apply & run URL.
 * Unblocks the URL and requeues it like any other pending ingest job.
 */
export async function executeJobById(
  jobId: number,
  options?: { modelName?: string | null; modelLabel?: string | null },
): Promise<{
  id: number;
  status: string;
  modelName: string | null;
  modelLabel: string | null;
}> {
  const job = await loadJobForRetry(jobId);
  if (!job) {
    throw HttpError.notFound("Job not found.");
  }

  try {
    await clearUrlDoNotExecute(job.url);
  } catch (err) {
    throw HttpError.internal(databaseErrorMessage(err));
  }

  const live = getLlmModelConfig();
  const requestedName =
    options?.modelName?.trim() || live.modelId?.trim() || null;
  const requestedLabel =
    options?.modelLabel?.trim() ||
    live.modelLabel?.trim() ||
    requestedName;
  const saveName =
    requestedName && requestedName.length <= JOB_MODEL_NAME_MAX
      ? requestedName
      : null;
  const saveLabel = clip(requestedLabel, JOB_MODEL_LABEL_MAX);
  const keepRunning = job.status.toLowerCase() === "running";
  const modelFields = {
    ...(saveName ? { modelName: saveName } : {}),
    ...(saveLabel ? { modelLabel: saveLabel } : {}),
  };

  let updated: {
    id: number;
    status: string;
    modelName: string | null;
    modelLabel: string | null;
  } | undefined;

  const setPending = {
    ...(keepRunning ? {} : { status: "pending" as const }),
    errorMessage: null,
    updatedAt: new Date(),
  };

  try {
    const [row] = await db
      .update(jobs)
      .set({ ...setPending, ...modelFields })
      .where(eq(jobs.id, jobId))
      .returning({
        id: jobs.id,
        status: jobs.status,
        modelName: jobs.modelName,
        modelLabel: jobs.modelLabel,
      });
    updated = row;
  } catch (err) {
    if (
      !isMissingJobColumnError(err) &&
      !/value too long/i.test(err instanceof Error ? err.message : String(err))
    ) {
      throw HttpError.internal(databaseErrorMessage(err));
    }
    const [row] = await db
      .update(jobs)
      .set(setPending)
      .where(eq(jobs.id, jobId))
      .returning({
        id: jobs.id,
        status: jobs.status,
      });
    if (row) {
      updated = {
        ...row,
        modelName: saveName,
        modelLabel: saveLabel,
      };
    }
  }

  if (!updated) {
    throw HttpError.internal("Failed to requeue job.");
  }

  try {
    const { refreshBatchRunStatusForJob } = await import(
      "../admin/batchRuns.service.js"
    );
    await refreshBatchRunStatusForJob({
      ingestLinkItemId: job.ingestLinkItemId,
      url: job.url,
    });
  } catch {
    // Batch refresh is best-effort; the job is already pending.
  }

  return updated;
}
