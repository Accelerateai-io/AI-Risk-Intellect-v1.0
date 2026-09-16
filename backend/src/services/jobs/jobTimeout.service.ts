import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { jobs } from "../../schema/jobs/jobs.js";

/** Skip a URL if ingest + LLM have not finished within this time. */
export const JOB_MAX_RUNTIME_MS = 5 * 60 * 1000;

export const JOB_TIMEOUT_SKIP_REASON =
  "Skipped because this URL took more than 5 minutes without finishing — it was taking too long.";

let activeRunAbort: AbortController | null = null;
let activeRunTimer: ReturnType<typeof setTimeout> | null = null;

export function getJobRunSignal(): AbortSignal | undefined {
  return activeRunAbort?.signal;
}

export function abortActiveJobRun(): void {
  activeRunAbort?.abort();
}

export function startJobRunTimer(): AbortSignal {
  endJobRunTimer();
  const controller = new AbortController();
  activeRunAbort = controller;
  activeRunTimer = setTimeout(() => {
    controller.abort();
  }, JOB_MAX_RUNTIME_MS);
  return controller.signal;
}

export function endJobRunTimer(): void {
  if (activeRunTimer) {
    clearTimeout(activeRunTimer);
    activeRunTimer = null;
  }
  activeRunAbort = null;
}

/** Combine a per-call timeout with the active job's 5-minute abort. */
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
  reason = JOB_TIMEOUT_SKIP_REASON,
): Promise<boolean> {
  const [updated] = await db
    .update(jobs)
    .set({
      status: "skipped",
      errorMessage: reason,
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

/** Mark running jobs older than 5 minutes as skipped. Uses Postgres NOW() so the clock cannot drift. */
export async function skipStaleRunningJobs(): Promise<number> {
  try {
    const skipped = await db
      .update(jobs)
      .set({
        status: "skipped",
        errorMessage: JOB_TIMEOUT_SKIP_REASON,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(jobs.status, "running"),
          sql`COALESCE(${jobs.startedAt}, ${jobs.updatedAt}) < NOW() - INTERVAL '5 minutes'`,
        ),
      )
      .returning({
        id: jobs.id,
        url: jobs.url,
        ingestLinkItemId: jobs.ingestLinkItemId,
      });

    for (const job of skipped) {
      await refreshBatch(job);
    }
    return skipped.length;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/does not exist/i.test(message)) return 0;
    throw err;
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
