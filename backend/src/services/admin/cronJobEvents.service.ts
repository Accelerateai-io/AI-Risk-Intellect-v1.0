import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  getCronScheduleSkipReason,
  isWithinCronSchedule,
  msUntilNextCronScheduleRun,
  msUntilStartTimeToday,
  type CronScheduleConfig,
} from "../../config/cronScheduleConfig.js";
import { cronJobEvents } from "../../schema/cronJobs/cronJobEvents.js";
import {
  DEFAULT_CRON_TIMEZONE,
  getZonedDateTimeParts,
  normalizeTimezone,
} from "../../utils/cronTimezone.js";

export type CronJobEventType = "started" | "stopped" | "scheduled" | "completed";

const LIFECYCLE_EVENT_TYPES: CronJobEventType[] = [
  "started",
  "completed",
  "stopped",
];

async function getLatestLifecycleEvent(jobId: string) {
  const [row] = await db
    .select({
      eventType: cronJobEvents.eventType,
      createdAt: cronJobEvents.createdAt,
    })
    .from(cronJobEvents)
    .where(
      and(
        eq(cronJobEvents.jobId, jobId),
        inArray(cronJobEvents.eventType, [...LIFECYCLE_EVENT_TYPES]),
      ),
    )
    .orderBy(desc(cronJobEvents.createdAt))
    .limit(1);

  return row ?? null;
}

/** Prevent duplicate started/completed rows for the same cron run or feed item. */
export async function shouldRecordCronLifecycleEvent(
  jobId: string,
  eventType: "started" | "completed" | "stopped",
): Promise<boolean> {
  const latest = await getLatestLifecycleEvent(jobId);
  if (!latest) {
    return true;
  }

  if (eventType === "started") {
    // One open "started" at a time — wait for completed/stopped before starting again.
    return latest.eventType !== "started";
  }

  if (eventType === "completed") {
    if (latest.eventType === "completed") {
      const ageMs = Date.now() - latest.createdAt.getTime();
      return ageMs > 60_000;
    }
    return true;
  }

  // stopped
  return latest.eventType !== "stopped";
}

export async function recordCronJobEvent(
  jobId: string,
  eventType: CronJobEventType,
  message?: string,
): Promise<void> {
  if (
    (eventType === "started" ||
      eventType === "completed" ||
      eventType === "stopped") &&
    !(await shouldRecordCronLifecycleEvent(jobId, eventType))
  ) {
    return;
  }

  await db.insert(cronJobEvents).values({
    jobId,
    eventType,
    message: message?.trim() || null,
  });
}

/** Record cron run start once per schedule (not per RSS feed link). */
export async function recordCronRunStarted(
  jobId: string,
  message = "RSS feed discovery CRON job started.",
): Promise<void> {
  await recordCronJobEvent(jobId, "started", message);
}

/** Record cron run completion once after all selected feeds are processed. */
export async function recordCronRunCompleted(
  jobId: string,
  message: string,
): Promise<void> {
  await recordCronJobEvent(jobId, "completed", message);
}

const CRON_RUN_IN_PROGRESS_MAX_MS = 30 * 60_000;

function scheduleTimeToMinutes(hhmm: string): number {
  const [hourPart, minutePart] = hhmm.split(":");
  const hours = Number.parseInt(hourPart ?? "0", 10);
  const minutes = Number.parseInt(minutePart ?? "0", 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
  return hours * 60 + minutes;
}

/** Same calendar day in the schedule timezone, at or after today's start time. */
export function cronLifecycleEventMatchesTodayOccurrence(
  eventDate: string,
  eventTime: string,
  todayDate: string,
  startTime: string,
): boolean {
  if (eventDate !== todayDate) return false;
  return scheduleTimeToMinutes(eventTime) >= scheduleTimeToMinutes(startTime);
}

/** True when a completed event already exists for today's schedule occurrence. */
export async function hasCronCompletedForScheduleDay(
  jobId: string,
  schedule: CronScheduleConfig,
  now: Date = new Date(),
): Promise<boolean> {
  const timezone = normalizeTimezone(schedule.timezone ?? DEFAULT_CRON_TIMEZONE);
  const zoned = getZonedDateTimeParts(now, timezone);

  if (!isWithinCronSchedule(schedule, now)) {
    return false;
  }

  const [row] = await db
    .select({ createdAt: cronJobEvents.createdAt })
    .from(cronJobEvents)
    .where(
      and(
        eq(cronJobEvents.jobId, jobId),
        eq(cronJobEvents.eventType, "completed"),
      ),
    )
    .orderBy(desc(cronJobEvents.createdAt))
    .limit(1);

  if (!row) return false;

  const completedZoned = getZonedDateTimeParts(row.createdAt, timezone);
  return cronLifecycleEventMatchesTodayOccurrence(
    completedZoned.date,
    completedZoned.time,
    zoned.date,
    schedule.startTime,
  );
}

/** True when a started event is open for today's schedule occurrence. */
export async function hasCronRunInProgressForScheduleDay(
  jobId: string,
  schedule: CronScheduleConfig,
  now: Date = new Date(),
): Promise<boolean> {
  const timezone = normalizeTimezone(schedule.timezone ?? DEFAULT_CRON_TIMEZONE);
  const zoned = getZonedDateTimeParts(now, timezone);

  if (!isWithinCronSchedule(schedule, now)) {
    return false;
  }

  const latest = await getLatestLifecycleEvent(jobId);
  if (!latest || latest.eventType !== "started") {
    return false;
  }

  const startedZoned = getZonedDateTimeParts(latest.createdAt, timezone);
  if (
    !cronLifecycleEventMatchesTodayOccurrence(
      startedZoned.date,
      startedZoned.time,
      zoned.date,
      schedule.startTime,
    )
  ) {
    return false;
  }

  return Date.now() - latest.createdAt.getTime() < CRON_RUN_IN_PROGRESS_MAX_MS;
}

/** Gate one-shot cron launches so they fire once per schedule day, at/after start time. */
export async function getCronStartSkipReason(
  jobId: string,
  schedule: CronScheduleConfig,
  now: Date = new Date(),
): Promise<string | null> {
  if (!schedule.active || schedule.ingestLinkIds.length === 0) {
    return "schedule inactive or no RSS feeds selected";
  }

  if (!isWithinCronSchedule(schedule, now)) {
    return (
      getCronScheduleSkipReason(schedule, now) ?? "outside schedule window"
    );
  }

  if (await hasCronCompletedForScheduleDay(jobId, schedule, now)) {
    return "already completed today";
  }

  if (await hasCronRunInProgressForScheduleDay(jobId, schedule, now)) {
    return "run already in progress";
  }

  const timezone = normalizeTimezone(schedule.timezone ?? DEFAULT_CRON_TIMEZONE);
  const zoned = getZonedDateTimeParts(now, timezone);
  if (
    scheduleTimeToMinutes(zoned.time) <
    scheduleTimeToMinutes(schedule.startTime)
  ) {
    return `before start time ${schedule.startTime} ${timezone} (now ${zoned.time})`;
  }

  return null;
}

export async function shouldStartScheduledCronRun(
  jobId: string,
  schedule: CronScheduleConfig,
  now: Date = new Date(),
): Promise<boolean> {
  return (await getCronStartSkipReason(jobId, schedule, now)) === null;
}

const CRON_DISCOVERY_RETRY_MS = 60_000;

/**
 * How long to wait before checking whether cron discovery should start.
 * Returns 0 when a run should start now, null when no upcoming run exists.
 */
export async function computeCronDiscoveryWaitMs(
  jobId: string,
  schedule: CronScheduleConfig,
  now: Date = new Date(),
): Promise<number | null> {
  if (await shouldStartScheduledCronRun(jobId, schedule, now)) {
    return 0;
  }

  if (
    isWithinCronSchedule(schedule, now) &&
    !(await hasCronCompletedForScheduleDay(jobId, schedule, now))
  ) {
    const untilStart = msUntilStartTimeToday(schedule, now);
    if (untilStart != null && untilStart > 0) {
      return untilStart;
    }

    if (await hasCronRunInProgressForScheduleDay(jobId, schedule, now)) {
      return CRON_DISCOVERY_RETRY_MS;
    }

    // Past start time today, not completed — retry soon instead of skipping to
    // the next calendar occurrence (msUntilNextCronScheduleRun jumps ahead).
    const timezone = normalizeTimezone(schedule.timezone ?? DEFAULT_CRON_TIMEZONE);
    const zoned = getZonedDateTimeParts(now, timezone);
    if (
      scheduleTimeToMinutes(zoned.time) >=
      scheduleTimeToMinutes(schedule.startTime)
    ) {
      return CRON_DISCOVERY_RETRY_MS;
    }
  }

  return msUntilNextCronScheduleRun(schedule, now);
}
