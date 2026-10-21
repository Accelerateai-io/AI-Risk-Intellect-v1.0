import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { jobRuntimeSettings } from "../../schema/jobs/jobRuntimeSettings.js";
import {
  EXECUTION_RETRY_STEP_MINUTES,
  executionLadderSkipReason,
  executionRetryLimits,
  MAX_EXECUTION_MINUTES,
  MAX_EXECUTION_RETRY_INTERVALS,
} from "./executionRetryLimits.js";

export {
  EXECUTION_RETRY_STEP_MINUTES,
  executionLadderSkipReason,
  executionRetryLimits,
  MAX_EXECUTION_MINUTES,
  MAX_EXECUTION_RETRY_INTERVALS,
};

export const JOB_EXECUTION_MINUTE_OPTIONS = [
  5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60,
] as const;

export const DEFAULT_JOB_EXECUTION_MINUTES = 5;

const CACHE_MS = 5_000;
const ROW_ID = 1;

let cached: { minutes: number; at: number } | null = null;

export function isAllowedJobExecutionMinutes(minutes: number): boolean {
  return (JOB_EXECUTION_MINUTE_OPTIONS as readonly number[]).includes(minutes);
}

export function jobTimeoutSkipReason(minutes: number): string {
  return `Skipped because this URL took more than ${minutes} minutes without finishing — it was taking too long.`;
}

function remember(minutes: number): number {
  cached = { minutes, at: Date.now() };
  return minutes;
}

export function cachedJobExecutionMinutes(): number {
  return cached?.minutes ?? DEFAULT_JOB_EXECUTION_MINUTES;
}

export function cachedJobMaxRuntimeMs(): number {
  return cachedJobExecutionMinutes() * 60 * 1000;
}

export function cachedJobTimeoutSkipReason(): string {
  return jobTimeoutSkipReason(cachedJobExecutionMinutes());
}

export async function getJobExecutionMinutes(): Promise<number> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.minutes;

  try {
    const [row] = await db
      .select({ maxMinutes: jobRuntimeSettings.maxMinutes })
      .from(jobRuntimeSettings)
      .where(eq(jobRuntimeSettings.id, ROW_ID))
      .limit(1);

    const minutes = row?.maxMinutes;
    if (minutes != null && isAllowedJobExecutionMinutes(minutes)) {
      return remember(minutes);
    }
  } catch {
    // Missing table or a brief DB error keeps the last known limit.
  }

  return remember(cached?.minutes ?? DEFAULT_JOB_EXECUTION_MINUTES);
}

export async function getJobMaxRuntimeMs(): Promise<number> {
  return (await getJobExecutionMinutes()) * 60 * 1000;
}

export async function currentJobTimeoutSkipReason(): Promise<string> {
  return jobTimeoutSkipReason(await getJobExecutionMinutes());
}

export async function setJobExecutionMinutes(minutes: number): Promise<number> {
  if (!isAllowedJobExecutionMinutes(minutes)) {
    throw new Error("Execution time must be 5 to 60 minutes, in steps of 5.");
  }

  await db
    .insert(jobRuntimeSettings)
    .values({
      id: ROW_ID,
      maxMinutes: minutes,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: jobRuntimeSettings.id,
      set: { maxMinutes: minutes, updatedAt: new Date() },
    });

  return remember(minutes);
}
