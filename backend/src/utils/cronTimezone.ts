/** Reference timezone for persisted and executed cron schedules (IST, UTC+5:30). */
export const CRON_SCHEDULE_TIMEZONE = "Asia/Kolkata";

export const DEFAULT_CRON_TIMEZONE = CRON_SCHEDULE_TIMEZONE;

const WEEKDAY_FROM_SHORT: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export type ZonedDateTimeParts = {
  date: string;
  time: string;
  weekday: number;
};

export function isValidTimezone(timezone: string): boolean {
  if (!timezone.trim()) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function normalizeTimezone(
  timezone: string | null | undefined,
): string {
  const candidate = timezone?.trim();
  if (candidate && isValidTimezone(candidate)) return candidate;
  return DEFAULT_CRON_TIMEZONE;
}

export function getZonedDateTimeParts(
  instant: Date,
  timezone: string,
): ZonedDateTimeParts {
  const tz = normalizeTimezone(timezone);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });

  const parts = formatter.formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  const year = read("year");
  const month = read("month");
  const day = read("day");
  let hour = read("hour");
  const minute = read("minute");
  const weekdayLabel = read("weekday");

  if (hour === "24") hour = "00";

  return {
    date: `${year}-${month}-${day}`,
    time: `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`,
    weekday: WEEKDAY_FROM_SHORT[weekdayLabel] ?? 0,
  };
}

function parseDateParts(dateStr: string): {
  year: number;
  month: number;
  day: number;
} {
  const [year, month, day] = dateStr
    .split("-")
    .map((part) => Number.parseInt(part, 10));
  return { year, month, day };
}

function dateToUtcDayIndex(date: string): number {
  const { year, month, day } = parseDateParts(date);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function timeToMinutes(hhmm: string): number {
  const [hourPart, minutePart] = hhmm.split(":");
  const hours = Number.parseInt(hourPart, 10);
  const minutes = Number.parseInt(minutePart, 10);
  return hours * 60 + minutes;
}

function addDaysToDateString(dateStr: string, days: number): string {
  const { year, month, day } = parseDateParts(dateStr);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function weekdayForDateInTimezone(dateStr: string, timezone: string): number {
  const { year, month, day } = parseDateParts(dateStr);
  const noonUtc = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return getZonedDateTimeParts(noonUtc, timezone).weekday;
}

/** UTC instant for a wall-clock date/time in an IANA timezone. */
export function resolveZonedDateTime(
  startDate: string,
  startTime: string,
  timezone: string,
): Date {
  const tz = normalizeTimezone(timezone);
  const { year, month, day } = parseDateParts(startDate);
  const [hour, minute] = startTime
    .split(":")
    .map((part) => Number.parseInt(part, 10));
  let ms = Date.UTC(year, month - 1, day, hour, minute);

  for (let attempt = 0; attempt < 72; attempt += 1) {
    const parts = getZonedDateTimeParts(new Date(ms), tz);
    if (parts.date === startDate && parts.time === startTime) {
      return new Date(ms);
    }
    const dayDelta = dateToUtcDayIndex(startDate) - dateToUtcDayIndex(parts.date);
    const minuteDelta =
      dayDelta * 24 * 60 + (timeToMinutes(startTime) - timeToMinutes(parts.time));
    if (minuteDelta === 0) break;
    ms += minuteDelta * 60_000;
  }

  return new Date(ms);
}

export function convertWallTimeBetweenZones(
  startDate: string,
  startTime: string,
  fromTimezone: string,
  toTimezone: string,
): ZonedDateTimeParts {
  const instant = resolveZonedDateTime(startDate, startTime, fromTimezone);
  return getZonedDateTimeParts(instant, toTimezone);
}

function findWeekdayOnOrAfter(
  startDate: string,
  weekday: number,
  timezone: string,
): string {
  let probe = startDate;
  for (let i = 0; i < 7; i += 1) {
    if (weekdayForDateInTimezone(probe, timezone) === weekday) {
      return probe;
    }
    probe = addDaysToDateString(probe, 1);
  }
  return startDate;
}

export function convertRepeatDaysBetweenTimezones(
  repeatDays: number[],
  startDate: string,
  startTime: string,
  fromTimezone: string,
  toTimezone: string,
): number[] {
  if (repeatDays.length === 0) return [];

  const fromTz = normalizeTimezone(fromTimezone);
  const toTz = normalizeTimezone(toTimezone);
  if (fromTz === toTz) return [...repeatDays].sort((a, b) => a - b);

  const converted = new Set<number>();
  for (const day of repeatDays) {
    const refDate = findWeekdayOnOrAfter(startDate, day, fromTz);
    const instant = resolveZonedDateTime(refDate, startTime, fromTz);
    converted.add(getZonedDateTimeParts(instant, toTz).weekday);
  }
  return [...converted].sort((a, b) => a - b);
}

export type CronWallScheduleInput = {
  startDate: string;
  startTime: string;
  timezone: string;
  repeat: boolean;
  repeatUnit: "day" | "week" | "month" | "year";
  repeatDays: number[];
};

/** Convert a user-facing schedule into the execution timezone (IST). */
export function toExecutionSchedule<T extends CronWallScheduleInput>(
  input: T,
  executionTimezone: string = CRON_SCHEDULE_TIMEZONE,
): T {
  const userTimezone = normalizeTimezone(input.timezone);
  const executionTz = normalizeTimezone(executionTimezone);
  if (userTimezone === executionTz) {
    return { ...input, timezone: executionTz };
  }

  const wall = convertWallTimeBetweenZones(
    input.startDate,
    input.startTime,
    userTimezone,
    executionTz,
  );
  const repeatDays =
    input.repeat && input.repeatUnit === "week"
      ? convertRepeatDaysBetweenTimezones(
          input.repeatDays,
          input.startDate,
          input.startTime,
          userTimezone,
          executionTz,
        )
      : input.repeatDays;

  return {
    ...input,
    startDate: wall.date,
    startTime: wall.time,
    timezone: executionTz,
    repeatDays,
  };
}

/** Convert a stored execution schedule into a user-facing timezone. */
export function toUserSchedule<T extends CronWallScheduleInput>(
  input: T,
  userTimezone: string,
  executionTimezone: string = CRON_SCHEDULE_TIMEZONE,
): T {
  const userTz = normalizeTimezone(userTimezone);
  const storedTz = normalizeTimezone(input.timezone);
  const executionTz = normalizeTimezone(executionTimezone);

  const sourceTz =
    storedTz === executionTz || storedTz === CRON_SCHEDULE_TIMEZONE
      ? executionTz
      : storedTz;

  if (sourceTz === userTz) {
    return { ...input, timezone: userTz };
  }

  const wall = convertWallTimeBetweenZones(
    input.startDate,
    input.startTime,
    sourceTz,
    userTz,
  );
  const repeatDays =
    input.repeat && input.repeatUnit === "week"
      ? convertRepeatDaysBetweenTimezones(
          input.repeatDays,
          input.startDate,
          input.startTime,
          sourceTz,
          userTz,
        )
      : input.repeatDays;

  return {
    ...input,
    startDate: wall.date,
    startTime: wall.time,
    timezone: userTz,
    repeatDays,
  };
}
