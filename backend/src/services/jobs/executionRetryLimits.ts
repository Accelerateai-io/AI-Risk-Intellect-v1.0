export const EXECUTION_RETRY_STEP_MINUTES = 5;
export const MAX_EXECUTION_RETRY_INTERVALS = 12;
export const MAX_EXECUTION_MINUTES = 60;

const ALLOWED_START_MINUTES = [
  5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60,
] as const;

function isAllowedStart(minutes: number): boolean {
  return (ALLOWED_START_MINUTES as readonly number[]).includes(minutes);
}

/**
 * Limits for one job, starting at the Controls value.
 * Each later interval adds 5 minutes. Stops at 12 intervals or 60 minutes.
 */
export function executionRetryLimits(startMinutes: number): number[] {
  const start = isAllowedStart(startMinutes) ? startMinutes : 5;
  const limits: number[] = [];
  for (
    let minutes = start;
    limits.length < MAX_EXECUTION_RETRY_INTERVALS &&
    minutes <= MAX_EXECUTION_MINUTES;
    minutes += EXECUTION_RETRY_STEP_MINUTES
  ) {
    limits.push(minutes);
  }
  return limits;
}

export function executionLadderSkipReason(
  startMinutes: number,
  lastMinutes: number,
  intervals: number,
): string {
  const count = `${intervals} execution-time ${intervals === 1 ? "interval" : "intervals"}`;
  return `Skipped because this URL did not finish after ${count}. It started at ${startMinutes} minutes, and each retry added ${EXECUTION_RETRY_STEP_MINUTES} minutes, up to ${lastMinutes} minutes.`;
}
