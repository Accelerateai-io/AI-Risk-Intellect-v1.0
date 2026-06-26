import type { CronScheduleConfig } from "../../config/cronScheduleConfig.js";

export function formatCronScheduledMessage(
  schedule: CronScheduleConfig,
  feedCount: number,
): string {
  const feedLabel = `${feedCount} feed${feedCount === 1 ? "" : "s"}`;
  const repeatLabel = schedule.repeat
    ? `repeats every ${schedule.repeatInterval} ${schedule.repeatUnit}${schedule.repeatInterval === 1 ? "" : "s"}`
    : "runs once";
  return `RSS discovery scheduled for ${feedLabel} at ${schedule.startTime} (${schedule.timezone}), ${repeatLabel}.`;
}

export function formatCronCompletedMessage(
  enqueued: number,
  feedCount: number,
): string {
  const feedLabel = `${feedCount} feed${feedCount === 1 ? "" : "s"}`;
  if (enqueued <= 0) {
    return `RSS discovery cycle finished for ${feedLabel}. No new URLs to enqueue.`;
  }
  const jobLabel = `${enqueued} ingest job${enqueued === 1 ? "" : "s"}`;
  return `RSS discovery cycle finished — enqueued ${jobLabel} from ${feedLabel}.`;
}
