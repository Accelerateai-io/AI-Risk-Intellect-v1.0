import type { CronScheduleConfig, SaveCronScheduleInput } from "../../config/cronScheduleConfig.js";
import {
  RSS_CRON_SERVICE_ID,
  deactivateAllRssCronSchedules,
  loadActiveCronScheduleConfig,
  sanitizeCronScheduleFeeds,
  saveCronScheduleConfig,
} from "./cronSchedule.service.js";
import { resolveActiveIngestLinksByIds } from "./ingestLinks.service.js";
import {
  CRON_SCHEDULE_TIMEZONE,
  getZonedDateTimeParts,
  normalizeTimezone,
  toExecutionSchedule,
} from "../../utils/cronTimezone.js";
import {
  getDiscoveryStatus,
  restartAndRescheduleCronDiscovery,
  scheduleNextCronDiscoveryRun,
  stopDiscoveryProcess,
} from "./discoveryManager.service.js";
import { ensureWorkerProcessRunning } from "./workerManager.service.js";
import { computeCronDiscoveryWaitMs } from "./cronJobEvents.service.js";
import { createLogger } from "../../logger/index.js";
import { recordCronJobEvent } from "./cronJobEvents.service.js";
import { formatCronScheduledMessage } from "./cronNotificationMessages.js";

const cronJobsLog = createLogger("cron-jobs");

/** Schedule the next cron run after server boot (service stays stopped until run time). */
async function ensureActiveCronDiscoveryRunning(): Promise<void> {
  const schedule = await loadActiveCronScheduleConfig();
  if (!schedule?.active || schedule.ingestLinkIds.length === 0) {
    return;
  }
  if (getDiscoveryStatus().running) {
    return;
  }

  try {
    scheduleNextCronDiscoveryRun(schedule);
    cronJobsLog.info("Scheduled next cron discovery run", {
      scheduleId: schedule.id,
    });
  } catch (err) {
    cronJobsLog.error("Failed to schedule cron discovery", { err });
  }
}

export type CronJobDefinition = {
  id: string;
  name: string;
  description: string;
  schedule: CronScheduleConfig;
  /** Saved schedule is active in the database. */
  enabled: boolean;
  /** Background discovery process is running (not merely scheduled for later). */
  running: boolean;
  /** Ms until the next discovery attempt; 0 when a run is due now. */
  nextRunWaitMs: number | null;
  serviceKey: "discovery" | null;
};

async function cronJobNextRunWaitMs(
  schedule: CronScheduleConfig,
): Promise<number | null> {
  if (!schedule.active || schedule.ingestLinkIds.length === 0) return null;
  return computeCronDiscoveryWaitMs(schedule.id, schedule);
}

function toCronJobDefinition(
  schedule: CronScheduleConfig,
  discoveryRunning: boolean,
  nextRunWaitMs: number | null,
): CronJobDefinition {
  return {
    id: schedule.id,
    name: "RSS feed discovery",
    description:
      "Poll selected RSS feeds and enqueue extracted article URLs.",
    schedule,
    enabled: schedule.active,
    running: discoveryRunning,
    nextRunWaitMs,
    serviceKey: "discovery",
  };
}

export async function listCronJobs(): Promise<CronJobDefinition[]> {
  const schedule = await sanitizeCronScheduleFeeds(RSS_CRON_SERVICE_ID);
  const discoveryRunning = getDiscoveryStatus().running;
  const nextRunWaitMs = await cronJobNextRunWaitMs(schedule);

  return [toCronJobDefinition(schedule, discoveryRunning, nextRunWaitMs)];
}

export async function saveCronJobSchedule(
  jobId: string,
  input: SaveCronScheduleInput,
): Promise<CronJobDefinition> {
  if (jobId !== RSS_CRON_SERVICE_ID) {
    throw new Error("Unknown CRON job.");
  }

  if (
    input.repeat &&
    input.repeatUnit === "week" &&
    input.repeatDays.length === 0
  ) {
    throw new Error("Select at least one day for a weekly repeat.");
  }

  if (input.ingestLinkIds.length === 0) {
    throw new Error("Select at least one RSS feed.");
  }

  const userTimezone = normalizeTimezone(input.timezone);
  const todayInUserTz = getZonedDateTimeParts(new Date(), userTimezone).date;
  if (input.startDate > todayInUserTz) {
    throw new Error(
      `Start date must be on or before today (${todayInUserTz}) in ${userTimezone}.`,
    );
  }

  const scheduleInput = toExecutionSchedule({
    ...input,
    timezone: userTimezone,
  });

  const links = await resolveActiveIngestLinksByIds(scheduleInput.ingestLinkIds);

  const schedule = await saveCronScheduleConfig({
    ...scheduleInput,
    ingestLinkIds: links.map((link) => link.id),
  });

  await recordCronJobEvent(
    schedule.id,
    "scheduled",
    formatCronScheduledMessage(schedule, links.length),
  );

  await restartAndRescheduleCronDiscovery();
  ensureWorkerProcessRunning();

  const discoveryRunning = getDiscoveryStatus().running;
  const nextRunWaitMs = discoveryRunning
    ? null
    : await cronJobNextRunWaitMs(schedule);

  return toCronJobDefinition(schedule, discoveryRunning, nextRunWaitMs);
}

export async function resumeActiveCronJobServices(): Promise<void> {
  try {
    await sanitizeCronScheduleFeeds(RSS_CRON_SERVICE_ID);
    const schedule = await loadActiveCronScheduleConfig();
    if (!schedule?.active || schedule.ingestLinkIds.length === 0) {
      cronJobsLog.info("No active cron schedule to resume");
      return;
    }

    await ensureActiveCronDiscoveryRunning();
  } catch (err) {
    cronJobsLog.error("Failed to resume active cron services", { err });
  }
}

export async function stopCronJobSchedule(
  jobId: string,
): Promise<CronJobDefinition> {
  if (jobId !== RSS_CRON_SERVICE_ID) {
    throw new Error("Unknown CRON job.");
  }

  await deactivateAllRssCronSchedules();
  stopDiscoveryProcess();

  const jobs = await listCronJobs();
  const job = jobs[0];
  if (!job) {
    throw new Error("CRON job could not be loaded after stop.");
  }

  return job;
}
