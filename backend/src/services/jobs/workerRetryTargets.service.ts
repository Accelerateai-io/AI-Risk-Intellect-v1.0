import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { jobs } from "../../schema/jobs/jobs.js";
import { workerRetryTargets } from "../../schema/jobs/workerRetryTargets.js";

export type WorkerRetryTargetInput = {
  jobId: number;
  url: string;
  modelName: string;
  modelLabel: string;
};

const ACTIVE_TARGET_STATUSES = new Set(["pending", "running"]);
const TARGET_STALE_MS = 15 * 60 * 1000;

function isMissingTargetTableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /does not exist/i.test(message) && /worker_retry_targets/i.test(message);
}

export async function insertWorkerRetryTargets(
  rows: WorkerRetryTargetInput[],
): Promise<void> {
  if (rows.length === 0) return;
  await db
    .insert(workerRetryTargets)
    .values(
      rows.map((row) => ({
        jobId: row.jobId,
        url: row.url,
        modelName: row.modelName,
        modelLabel: row.modelLabel,
      })),
    )
    .onConflictDoUpdate({
      target: workerRetryTargets.jobId,
      set: {
        url: sql`excluded.url`,
        modelName: sql`excluded.model_name`,
        modelLabel: sql`excluded.model_label`,
        createdAt: sql`now()`,
      },
    });
}

export async function removeWorkerRetryTargets(jobIds: number[]): Promise<void> {
  if (jobIds.length === 0) return;
  await db
    .delete(workerRetryTargets)
    .where(inArray(workerRetryTargets.jobId, jobIds));
}

/** Model stored for a selected URL, if this job is part of a selected Retry. */
export async function assignedModelForRetryTarget(
  jobId: number,
): Promise<{ modelName: string; modelLabel: string } | null> {
  try {
    const [row] = await db
      .select({
        modelName: workerRetryTargets.modelName,
        modelLabel: workerRetryTargets.modelLabel,
      })
      .from(workerRetryTargets)
      .where(eq(workerRetryTargets.jobId, jobId))
      .limit(1);
    const modelName = row?.modelName?.trim();
    if (!modelName) return null;
    return {
      modelName,
      modelLabel: row?.modelLabel?.trim() || modelName,
    };
  } catch (err) {
    if (isMissingTargetTableError(err)) return null;
    throw err;
  }
}

/**
 * Job ids the worker may claim for a selected Retry.
 * Returns null when no selection is active, so the worker keeps its normal queue.
 */
export async function activeWorkerRetryTargetIds(): Promise<number[] | null> {
  try {
    const rows = await db
      .select({
        jobId: workerRetryTargets.jobId,
        createdAt: workerRetryTargets.createdAt,
        status: jobs.status,
        updatedAt: jobs.updatedAt,
      })
      .from(workerRetryTargets)
      .leftJoin(jobs, eq(jobs.id, workerRetryTargets.jobId));

    if (rows.length === 0) return null;

    const staleBefore = Date.now() - TARGET_STALE_MS;
    const dropIds = rows
      .filter((row) => {
        if (row.status == null) return true;
        if (ACTIVE_TARGET_STATUSES.has(row.status)) return false;
        const updatedAt = row.updatedAt?.getTime() ?? 0;
        const createdAt = row.createdAt.getTime();
        if (updatedAt > createdAt) return true;
        return createdAt < staleBefore;
      })
      .map((row) => row.jobId);

    if (dropIds.length > 0) {
      await db
        .delete(workerRetryTargets)
        .where(inArray(workerRetryTargets.jobId, dropIds));
    }

    const active = rows
      .filter((row) => !dropIds.includes(row.jobId))
      .map((row) => row.jobId);
    return active.length > 0 ? active : null;
  } catch (err) {
    if (isMissingTargetTableError(err)) return null;
    throw err;
  }
}
