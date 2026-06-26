/** Reference timezone for persisted and executed cron schedules (IST, UTC+5:30). */
export const CRON_SCHEDULE_TIMEZONE = "Asia/Kolkata";

export type ZonedDateTimeParts = {
  date: string;
  time: string;
  weekday: number;
};

export type CronTimezoneOption = {
  value: string;
  label: string;
};

const TIMEZONE_GROUPS: { label: string; zones: string[] }[] = [
  {
    label: "Common",
    zones: ["UTC"],
  },
  {
    label: "Americas",
    zones: [
      "America/New_York",
      "America/Chicago",
      "America/Denver",
      "America/Los_Angeles",
      "America/Toronto",
      "America/Sao_Paulo",
    ],
  },
  {
    label: "Europe & Africa",
    zones: [
      "Europe/London",
      "Europe/Paris",
      "Europe/Berlin",
      "Europe/Amsterdam",
      "Africa/Johannesburg",
    ],
  },
  {
    label: "Asia & Pacific",
    zones: [
      "Asia/Dubai",
      "Asia/Kolkata",
      "Asia/Singapore",
      "Asia/Tokyo",
      "Asia/Shanghai",
      "Australia/Sydney",
      "Pacific/Auckland",
    ],
  },
];

function isValidTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function browserTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && isValidTimezone(tz) ? tz : "UTC";
  } catch {
    return "UTC";
  }
}

export function todayInTimezone(timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: isValidTimezone(timezone) ? timezone : "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const read = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? "";
    return `${read("year")}-${read("month")}-${read("day")}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

const WEEKDAY_FROM_SHORT: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function weekdayInTimezone(timezone: string): number {
  try {
    const label = new Intl.DateTimeFormat("en-US", {
      timeZone: isValidTimezone(timezone) ? timezone : "UTC",
      weekday: "short",
    }).format(new Date());
    return WEEKDAY_FROM_SHORT[label] ?? 0;
  } catch {
    return new Date().getDay();
  }
}

export function clampStartDateForTimezone(
  startDate: string,
  timezone: string,
): string {
  const today = todayInTimezone(timezone);
  return startDate > today ? today : startDate;
}

export function getZonedDateTimeParts(
  instant: Date,
  timezone: string,
): ZonedDateTimeParts {
  const tz = isValidTimezone(timezone) ? timezone : "UTC";
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
  let hour = read("hour");
  if (hour === "24") hour = "00";
  return {
    date: `${read("year")}-${read("month")}-${read("day")}`,
    time: `${hour.padStart(2, "0")}:${read("minute").padStart(2, "0")}`,
    weekday: WEEKDAY_FROM_SHORT[read("weekday")] ?? 0,
  };
}

function dateToUtcDayIndex(date: string): number {
  const [year, month, day] = date.split("-").map((part) => Number.parseInt(part, 10));
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function timeToMinutes(hhmm: string): number {
  const [hourPart, minutePart] = hhmm.split(":");
  const hours = Number.parseInt(hourPart, 10);
  const minutes = Number.parseInt(minutePart, 10);
  return hours * 60 + minutes;
}

/** UTC instant for a wall-clock date/time in an IANA timezone. */
export function resolveZonedDateTime(
  startDate: string,
  startTime: string,
  timezone: string,
): Date {
  const tz = isValidTimezone(timezone) ? timezone : "UTC";
  const [year, month, day] = startDate
    .split("-")
    .map((part) => Number.parseInt(part, 10));
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

function addDaysToDateString(dateStr: string, days: number): string {
  const [year, month, day] = dateStr
    .split("-")
    .map((part) => Number.parseInt(part, 10));
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function weekdayForDateInTimezone(dateStr: string, timezone: string): number {
  const [year, month, day] = dateStr
    .split("-")
    .map((part) => Number.parseInt(part, 10));
  const noonUtc = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return getZonedDateTimeParts(noonUtc, timezone).weekday;
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

  const fromTz = isValidTimezone(fromTimezone) ? fromTimezone : "UTC";
  const toTz = isValidTimezone(toTimezone) ? toTimezone : "UTC";
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

export function toExecutionSchedule<T extends CronWallScheduleInput>(
  input: T,
  executionTimezone: string = CRON_SCHEDULE_TIMEZONE,
): T {
  const userTimezone = isValidTimezone(input.timezone)
    ? input.timezone
    : browserTimezone();
  const executionTz = isValidTimezone(executionTimezone)
    ? executionTimezone
    : CRON_SCHEDULE_TIMEZONE;
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

export function toUserSchedule<T extends CronWallScheduleInput>(
  input: T,
  userTimezone: string = browserTimezone(),
  executionTimezone: string = CRON_SCHEDULE_TIMEZONE,
): T {
  const userTz = isValidTimezone(userTimezone) ? userTimezone : browserTimezone();
  const storedTz = isValidTimezone(input.timezone) ? input.timezone : executionTimezone;
  const executionTz = isValidTimezone(executionTimezone)
    ? executionTimezone
    : CRON_SCHEDULE_TIMEZONE;

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

function formatTimezoneLabel(timezone: string): string {
  return timezone.replace(/_/g, " ");
}

function currentOffsetLabel(timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "shortOffset",
    }).formatToParts(new Date());
    return parts.find((part) => part.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

export function formatTimezoneOption(timezone: string): string {
  const offset = currentOffsetLabel(timezone);
  const label = formatTimezoneLabel(timezone);
  return offset ? `${label} (${offset})` : label;
}

export function buildCronTimezoneGroups(
  extraZones: string[] = [],
): { label: string; options: CronTimezoneOption[] }[] {
  const seen = new Set<string>();
  const groups = TIMEZONE_GROUPS.map((group) => ({
    label: group.label,
    options: group.zones
      .filter((zone) => {
        if (!isValidTimezone(zone) || seen.has(zone)) return false;
        seen.add(zone);
        return true;
      })
      .map((zone) => ({
        value: zone,
        label: formatTimezoneOption(zone),
      })),
  }));

  const additional = [...new Set(extraZones)]
    .filter((zone) => isValidTimezone(zone) && !seen.has(zone))
    .map((zone) => ({
      value: zone,
      label: formatTimezoneOption(zone),
    }));

  if (additional.length > 0) {
    groups.unshift({
      label: "Your timezone",
      options: additional,
    });
  }

  return groups.filter((group) => group.options.length > 0);
}
