import { and, desc, eq, ne, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { articles } from "../../schema/articles/articles.js";
import { jobs } from "../../schema/jobs/jobs.js";
import { risks } from "../../schema/risks/risks.js";
import {
  currentJobPipelineTrace,
  formatOrphanExecutionTimeSkipReport,
} from "./jobPipelineTrace.js";
import {
  cachedJobMaxRuntimeMs,
  cachedJobTimeoutSkipReason,
  currentJobTimeoutSkipReason,
  getJobMaxRuntimeMs,
  jobTimeoutSkipReason,
} from "./jobRuntimeSettings.service.js";
import { MAX_EXECUTION_MINUTES } from "./executionRetryLimits.js";

/** Default skip window. Live runs use the Controls execution-time setting. */
export const JOB_MAX_RUNTIME_MS = 5 * 60 * 1000;

export const JOB_TIMEOUT_SKIP_REASON =
  "Skipped because this URL took more than 5 minutes without finishing — it was taking too long.";

export {
  cachedJobMaxRuntimeMs,
  cachedJobTimeoutSkipReason,
  currentJobTimeoutSkipReason,
  getJobMaxRuntimeMs,
};

let activeRunAbort: AbortController | null = null;
let activeRunTimer: ReturnType<typeof setTimeout> | null = null;
let activeAttemptJobId: number | null = null;
let activeAttemptLimitMs: number | null = null;

export function getJobRunSignal(): AbortSignal | undefined {
  return activeRunAbort?.signal;
}

export function getActiveAttemptLimitMs(): number | null {
  return activeAttemptLimitMs;
}

export function noteActiveAttemptJob(jobId: number | null): void {
  activeAttemptJobId = jobId;
}

export function activeAttemptSkipReason(): string {
  const ms = activeAttemptLimitMs ?? cachedJobMaxRuntimeMs();
  return jobTimeoutSkipReason(Math.max(5, Math.round(ms / 60_000)));
}

/** True when a fetch or child process was stopped by the execution-time limit. */
export function isAbortOrTimeoutError(err: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const name = current instanceof Error ? current.name : "";
    const message = current instanceof Error ? current.message : String(current);
    if (name === "AbortError" || name === "TimeoutError") return true;
    if (/operation was aborted|aborted due to timeout|the operation timed out/i.test(message)) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return getJobRunSignal()?.aborted === true;
}

export function abortActiveJobRun(): void {
  activeRunAbort?.abort();
}

const LIMIT_CHECK_MS = 5_000;

/** Abort the active run once this attempt has used its interval. */
export async function startJobRunTimer(limitMs?: number): Promise<AbortSignal> {
  endJobRunTimer();
  const controller = new AbortController();
  activeRunAbort = controller;
  const limit = limitMs ?? (await getJobMaxRuntimeMs());
  activeAttemptLimitMs = limit;
  const started = Date.now();

  const arm = (): void => {
    activeRunTimer = setTimeout(() => {
      if (controller.signal.aborted) return;
      if (Date.now() - started >= limit) {
        controller.abort();
        return;
      }
      arm();
    }, LIMIT_CHECK_MS);
  };

  arm();
  return controller.signal;
}

export function endJobRunTimer(): void {
  if (activeRunTimer) {
    clearTimeout(activeRunTimer);
    activeRunTimer = null;
  }
  activeRunAbort = null;
  activeAttemptLimitMs = null;
}

/** Combine a per-call timeout with the active job's execution-time abort. */
export function signalWithJobTimeout(timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  const jobSignal = getJobRunSignal();
  if (!jobSignal) return timeout;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([timeout, jobSignal]);
  }
  const merged = new AbortController();
  const abort = () => merged.abort();
  if (timeout.aborted || jobSignal.aborted) {
    merged.abort();
    return merged.signal;
  }
  timeout.addEventListener("abort", abort, { once: true });
  jobSignal.addEventListener("abort", abort, { once: true });
  return merged.signal;
}

export async function skipJobIfStillRunning(
  jobId: number,
  reason?: string,
): Promise<boolean> {
  const message = reason ?? (await currentJobTimeoutSkipReason());
  const [updated] = await db
    .update(jobs)
    .set({
      status: "skipped",
      errorMessage: message,
      updatedAt: new Date(),
    })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, "running")))
    .returning({
      id: jobs.id,
      url: jobs.url,
      ingestLinkItemId: jobs.ingestLinkItemId,
    });

  if (!updated) return false;
  await refreshBatch(updated);
  return true;
}

/** Mark other running jobs older than the Controls limit as skipped. */
export async function skipStaleRunningJobs(): Promise<number> {
  try {
    const reason = jobTimeoutSkipReason(MAX_EXECUTION_MINUTES);
    const runningTooLong = and(
      eq(jobs.status, "running"),
      sql`COALESCE(${jobs.startedAt}, ${jobs.updatedAt}) < NOW() - make_interval(mins => ${MAX_EXECUTION_MINUTES})`,
      activeAttemptJobId != null
        ? ne(jobs.id, activeAttemptJobId)
        : undefined,
    );
    const skipped = await db
      .update(jobs)
      .set({
        status: "skipped",
        errorMessage: reason,
        updatedAt: new Date(),
      })
      .where(runningTooLong)
      .returning({
        id: jobs.id,
        url: jobs.url,
        articleId: jobs.articleId,
        startedAt: jobs.startedAt,
        ingestLinkItemId: jobs.ingestLinkItemId,
      });

    for (const job of skipped) {
      await refreshBatch(job);
      await reportOrphanExecutionTimeSkip(job);
    }
    return skipped.length;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/does not exist/i.test(message)) return 0;
    throw err;
  }
}

/** Running rows left behind with no in-flight trace (worker restart or a previous process). */
async function reportOrphanExecutionTimeSkip(job: {
  id: number;
  url: string;
  articleId: number;
  startedAt: Date | null;
}): Promise<void> {
  if (currentJobPipelineTrace()?.jobId === job.id) return;
  try {
    const [article] = await db
      .select({ rawText: articles.rawText })
      .from(articles)
      .where(eq(articles.id, job.articleId))
      .limit(1);
    const [risk] = await db
      .select({
        id: risks.id,
        createdAt: risks.createdAt,
        updatedAt: risks.updatedAt,
      })
      .from(risks)
      .where(eq(risks.articleId, job.articleId))
      .orderBy(desc(risks.updatedAt))
      .limit(1);
    const started = job.startedAt?.getTime() ?? 0;
    const riskTouchedDuringRun =
      risk != null &&
      started > 0 &&
      (risk.createdAt.getTime() >= started ||
        risk.updatedAt.getTime() >= started);
    const lines = formatOrphanExecutionTimeSkipReport({
      jobId: job.id,
      url: job.url,
      articleId: job.articleId,
      articleChars: article?.rawText?.trim().length ?? 0,
      riskId: riskTouchedDuringRun ? risk.id : null,
      riskTouchedDuringRun,
    });
    for (const line of lines) {
      process.stdout.write(`${line}\n`);
    }
  } catch {
    // The job is already skipped. A failed check must not change that.
  }
}

async function refreshBatch(job: {
  ingestLinkItemId: number | null;
  url: string;
}): Promise<void> {
  try {
    const { refreshBatchRunStatusForJob } = await import(
      "../admin/batchRuns.service.js"
    );
    await refreshBatchRunStatusForJob({
      ingestLinkItemId: job.ingestLinkItemId,
      url: job.url,
    });
  } catch {
    // Batch refresh is best-effort; the job is already skipped.
  }
}
