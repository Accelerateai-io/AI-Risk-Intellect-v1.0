export type CompletedJobSpan = {
  startedAt: Date | string | null;
  updatedAt?: Date | string | null;
  /** This job's own terminal timestamp. Later risks on the article must not be used. */
  finishedAt?: Date | string | null;
};

function toMs(value: Date | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

const TERMINAL_JOB_STATUSES = new Set([
  "done",
  "completed",
  "error",
  "failed",
  "skipped",
]);

/**
 * Run time for one finished job: that job's start until that job finished.
 * `updatedAt` is only a fallback for rows saved before `finished_at` existed.
 */
export function completedJobProcessingMs(span: CompletedJobSpan): number | null {
  const startedMs = toMs(span.startedAt);
  if (startedMs == null) return null;
  const completedMs = toMs(span.finishedAt) ?? toMs(span.updatedAt);
  if (completedMs == null) return null;
  const elapsed = completedMs - startedMs;
  return elapsed > 0 ? elapsed : null;
}

/**
 * Duration shown for one job row.
 * Pending has not started. Running is elapsed since start. Terminal jobs use
 * their own finish time, so a later Force Reprocess cannot change them.
 */
export function jobExecutionMs(input: {
  status: string;
  startedAt: Date | string | null;
  finishedAt?: Date | string | null;
  updatedAt?: Date | string | null;
  now?: Date;
}): number | null {
  const status = input.status.toLowerCase();
  if (status === "pending" || status === "queued") return null;

  if (status === "running") {
    const startedMs = toMs(input.startedAt);
    if (startedMs == null) return null;
    const nowMs = (input.now ?? new Date()).getTime();
    return Math.max(0, nowMs - startedMs);
  }

  if (!TERMINAL_JOB_STATUSES.has(status)) return null;
  return completedJobProcessingMs(input);
}

export function averageProcessingSeconds(durationsMs: number[]): number {
  if (durationsMs.length === 0) return 0;
  const total = durationsMs.reduce((sum, ms) => sum + ms, 0);
  return Math.round(total / durationsMs.length / 1000);
}
