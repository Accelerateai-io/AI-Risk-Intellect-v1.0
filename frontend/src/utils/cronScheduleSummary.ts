import type { CronJobRow, SaveCronScheduleInput } from "./cronJobsApi";
import {
  CRON_SCHEDULE_TIMEZONE,
  formatTimezoneOption,
} from "./cronTimezones";

const WEEKDAY_LABELS: Record<number, string> = {
  0: "Sun",
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
};

function ordinal(day: number): string {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

function formatInterval(interval: number, unit: string): string {
  if (interval === 1) return unit;
  const plural = unit.endsWith("s") ? unit : `${unit}s`;
  return `${interval} ${plural}`;
}

function formatScheduleAtTime(
  schedule: Pick<SaveCronScheduleInput, "startDate" | "startTime" | "timezone">,
): string {
  if (schedule.timezone === CRON_SCHEDULE_TIMEZONE) {
    return `at ${schedule.startTime}`;
  }

  const regionLabel = formatTimezoneOption(schedule.timezone);
  return `at ${schedule.startTime} (${regionLabel})`;

  // IST conversion in summary (hidden per product request):
  // const ist = convertWallTimeBetweenZones(
  //   schedule.startDate,
  //   schedule.startTime,
  //   schedule.timezone,
  //   CRON_SCHEDULE_TIMEZONE,
  // );
  // return `at ${schedule.startTime} (${regionLabel}) · ${ist.time} IST`;
}

export function formatCronScheduleSummary(
  schedule: Pick<
    SaveCronScheduleInput,
    | "startDate"
    | "startTime"
    | "timezone"
    | "repeat"
    | "repeatInterval"
    | "repeatUnit"
    | "repeatDays"
  >,
): string {
  const atTime = formatScheduleAtTime(schedule);

  if (!schedule.repeat) {
    return `Occurs once on ${schedule.startDate} ${atTime}`;
  }

  const every = formatInterval(schedule.repeatInterval, schedule.repeatUnit);

  if (schedule.repeatUnit === "week") {
    const days =
      schedule.repeatDays.length > 0
        ? schedule.repeatDays
            .map((day) => WEEKDAY_LABELS[day] ?? "")
            .filter(Boolean)
            .join(", ")
        : "no days selected";
    return `Occurs every ${every} on ${days} ${atTime}`;
  }

  if (schedule.repeatUnit === "day") {
    return `Occurs every ${every} ${atTime}`;
  }

  if (schedule.repeatUnit === "month") {
    const day = Number.parseInt(schedule.startDate.split("-")[2] ?? "1", 10);
    return `Occurs every ${every} on the ${ordinal(day)} ${atTime}`;
  }

  return `Occurs every ${every} on ${schedule.startDate.slice(5)} ${atTime}`;
}

function formatWaitDuration(ms: number): string {
  if (ms <= 0) return "now";
  const totalMinutes = Math.max(1, Math.round(ms / 60_000));
  if (totalMinutes < 60) {
    return `in ${totalMinutes} minute${totalMinutes === 1 ? "" : "s"}`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) {
    return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `in ${hours}h ${minutes}m`;
}

export function formatCronSaveToastMessage(
  feedCount: number,
  schedule: Pick<
    SaveCronScheduleInput,
    | "startDate"
    | "startTime"
    | "timezone"
    | "repeat"
    | "repeatInterval"
    | "repeatUnit"
    | "repeatDays"
  >,
  job: Pick<CronJobRow, "running" | "nextRunWaitMs">,
): string {
  const summary = formatCronScheduleSummary(schedule);
  const feeds = `${feedCount} feed${feedCount === 1 ? "" : "s"}`;

  if (job.running) {
    return `RSS discovery is running now for ${feeds}. ${summary}`;
  }

  const waitMs = job.nextRunWaitMs;
  if (waitMs === 0) {
    return `RSS discovery is starting for ${feeds}. ${summary}`;
  }

  if (waitMs != null && waitMs > 0) {
    return `RSS discovery saved for ${feeds}. Next run ${formatWaitDuration(waitMs)}. ${summary}`;
  }

  return `RSS discovery saved for ${feeds}. ${summary} It runs automatically at the scheduled time (not immediately when you save).`;
}
