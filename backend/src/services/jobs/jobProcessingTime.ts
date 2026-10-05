export type CompletedJobSpan = {
  startedAt: Date | string | null;
  updatedAt: Date | string;
  riskFetchedAt: Date | string | null;
};

function toMs(value: Date | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Run time shown on a finished job row: worker start until the risk was stored,
 * or the job's last update when no risk timestamp exists.
 */
export function completedJobProcessingMs(span: CompletedJobSpan): number | null {
  const startedMs = toMs(span.startedAt);
  if (startedMs == null) return null;
  const completedMs = toMs(span.riskFetchedAt) ?? toMs(span.updatedAt);
  if (completedMs == null) return null;
  const elapsed = completedMs - startedMs;
  return elapsed > 0 ? elapsed : null;
}

export function averageProcessingSeconds(durationsMs: number[]): number {
  if (durationsMs.length === 0) return 0;
  const total = durationsMs.reduce((sum, ms) => sum + ms, 0);
  return Math.round(total / durationsMs.length / 1000);
}
