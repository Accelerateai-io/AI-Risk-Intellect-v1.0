import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getCronScheduleSkipReason,
  isWithinCronSchedule,
  msUntilNextCronScheduleRun,
  msUntilStartTimeToday,
  type CronScheduleConfig,
} from "../config/cronScheduleConfig.js";
import { computeDiscoveryLoopSleepMs } from "../workers/rssDiscovery.js";
import { MAX_SET_TIMEOUT_MS } from "./timerUtils.js";
import {
  convertWallTimeBetweenZones,
  getZonedDateTimeParts,
  resolveZonedDateTime,
  toExecutionSchedule,
  toUserSchedule,
} from "./cronTimezone.js";

describe("cron timezone helpers", () => {
  it("formats zoned date parts for America/New_York", () => {
    const instant = new Date("2026-06-10T14:30:00.000Z");
    const parts = getZonedDateTimeParts(instant, "America/New_York");
    assert.equal(parts.date, "2026-06-10");
    assert.equal(parts.time, "10:30");
    assert.equal(parts.weekday, 3);
  });

  it("evaluates schedule start time in the configured timezone", () => {
    const schedule: CronScheduleConfig = {
      id: "rss-1",
      startDate: "2026-06-10",
      startTime: "10:30",
      timezone: "America/New_York",
      repeat: false,
      repeatInterval: 1,
      repeatUnit: "week",
      repeatDays: [3],
      ingestLinkIds: [1],
      endsOn: null,
      active: true,
    };

    assert.equal(
      isWithinCronSchedule(schedule, new Date("2026-06-10T14:29:00.000Z")),
      false,
    );
    assert.equal(
      isWithinCronSchedule(schedule, new Date("2026-06-10T14:30:00.000Z")),
      true,
    );
  });

  it("evaluates Asia/Kolkata daily schedule at local start time", () => {
    const schedule: CronScheduleConfig = {
      id: "rss-2",
      startDate: "2026-06-11",
      startTime: "10:30",
      timezone: "Asia/Kolkata",
      repeat: true,
      repeatInterval: 1,
      repeatUnit: "day",
      repeatDays: [],
      ingestLinkIds: [1],
      endsOn: null,
      active: true,
    };

    assert.equal(
      isWithinCronSchedule(schedule, new Date("2026-06-11T05:00:00.000Z")),
      true,
    );
    assert.match(
      getCronScheduleSkipReason(
        schedule,
        new Date("2026-06-11T04:59:00.000Z"),
      ) ?? "",
      /before start time/,
    );
  });

  it("skips weekly schedules when today is not a selected weekday", () => {
    const schedule: CronScheduleConfig = {
      id: "rss-3",
      startDate: "2026-06-11",
      startTime: "10:30",
      timezone: "Asia/Kolkata",
      repeat: true,
      repeatInterval: 1,
      repeatUnit: "week",
      repeatDays: [2],
      ingestLinkIds: [1],
      endsOn: null,
      active: true,
    };

    assert.match(
      getCronScheduleSkipReason(
        schedule,
        new Date("2026-06-11T05:00:00.000Z"),
      ) ?? "",
      /weekly repeat does not include Thu/,
    );
  });

  it("waits until start time when before the configured local time", () => {
    const schedule: CronScheduleConfig = {
      id: "rss-4",
      startDate: "2026-06-11",
      startTime: "10:39",
      timezone: "Asia/Kolkata",
      repeat: true,
      repeatInterval: 1,
      repeatUnit: "day",
      repeatDays: [],
      ingestLinkIds: [1],
      endsOn: null,
      active: true,
    };

    assert.equal(
      msUntilStartTimeToday(schedule, new Date("2026-06-11T05:09:00.000Z")),
      null,
    );
    assert.equal(
      msUntilStartTimeToday(schedule, new Date("2026-06-11T05:08:00.000Z")),
      60_000,
    );
  });
});

describe("discovery loop sleep", () => {
  const intervalMs = 15 * 60_000;

  const schedule: CronScheduleConfig = {
    id: "rss-3",
    startDate: "2026-06-11",
    startTime: "10:39",
    timezone: "Asia/Kolkata",
    repeat: true,
    repeatInterval: 1,
    repeatUnit: "day",
    repeatDays: [],
    ingestLinkIds: [1],
    endsOn: null,
    active: true,
  };

  it("sleeps until start time when before the daily window", () => {
    const now = new Date("2026-06-11T05:08:00.000Z"); // 10:38 IST
    assert.equal(
      computeDiscoveryLoopSleepMs(intervalMs, 100, schedule, now),
      60_000,
    );
  });

  it("uses poll interval when already within the schedule window", () => {
    const now = new Date("2026-06-11T05:09:00.000Z"); // 10:39 IST
    assert.equal(
      computeDiscoveryLoopSleepMs(intervalMs, 100, schedule, now),
      intervalMs - 100,
    );
  });

  it("sleeps until the next run when today does not match the weekly cadence", () => {
    const weeklySchedule: CronScheduleConfig = {
      id: "rss-weekly",
      startDate: "2026-06-11",
      startTime: "10:39",
      timezone: "Asia/Kolkata",
      repeat: true,
      repeatInterval: 1,
      repeatUnit: "week",
      repeatDays: [2],
      ingestLinkIds: [1],
      endsOn: null,
      active: true,
    };
    const now = new Date("2026-06-11T05:09:00.000Z"); // Thu 10:39 IST
    const sleepMs = computeDiscoveryLoopSleepMs(
      intervalMs,
      100,
      weeklySchedule,
      now,
    );
    assert.ok(sleepMs > 60_000);
  });

  it("caps long sleeps to the Node setTimeout limit", () => {
    const monthlySchedule: CronScheduleConfig = {
      id: "rss-monthly",
      startDate: "2026-06-11",
      startTime: "10:39",
      timezone: "Asia/Kolkata",
      repeat: true,
      repeatInterval: 1,
      repeatUnit: "month",
      repeatDays: [],
      ingestLinkIds: [1],
      endsOn: null,
      active: true,
    };
    const now = new Date("2026-06-12T05:09:00.000Z"); // day after monthly run day
    const sleepMs = computeDiscoveryLoopSleepMs(
      intervalMs,
      100,
      monthlySchedule,
      now,
    );
    assert.equal(sleepMs, MAX_SET_TIMEOUT_MS);
  });
});

describe("next cron schedule run", () => {
  const dailySchedule: CronScheduleConfig = {
    id: "rss-next",
    startDate: "2026-06-11",
    startTime: "10:39",
    timezone: "Asia/Kolkata",
    repeat: true,
    repeatInterval: 1,
    repeatUnit: "day",
    repeatDays: [],
    ingestLinkIds: [1],
    endsOn: null,
    active: true,
  };

  it("returns ms until today's start when before start time", () => {
    assert.equal(
      msUntilNextCronScheduleRun(
        dailySchedule,
        new Date("2026-06-11T05:08:00.000Z"),
      ),
      60_000,
    );
  });

  it("returns ms until tomorrow after today's run time", () => {
    const ms = msUntilNextCronScheduleRun(
      dailySchedule,
      new Date("2026-06-11T05:10:00.000Z"),
    );
    assert.ok(ms != null && ms > 20 * 60 * 60_000);
  });
});

describe("schedule timezone conversion", () => {
  it("preserves the same instant when converting user time to IST", () => {
    const user = {
      startDate: "2026-06-10",
      startTime: "10:30",
      timezone: "America/New_York",
      repeat: true,
      repeatUnit: "week" as const,
      repeatDays: [2],
    };

    const execution = toExecutionSchedule(user);
    assert.equal(execution.timezone, "Asia/Kolkata");

    const userInstant = resolveZonedDateTime(
      user.startDate,
      user.startTime,
      user.timezone,
    );
    const executionInstant = resolveZonedDateTime(
      execution.startDate,
      execution.startTime,
      execution.timezone,
    );
    assert.equal(userInstant.toISOString(), executionInstant.toISOString());
  });

  it("round-trips user schedule through execution timezone", () => {
    const user = {
      startDate: "2026-06-10",
      startTime: "18:50",
      timezone: "America/Los_Angeles",
      repeat: true,
      repeatUnit: "week" as const,
      repeatDays: [1, 3, 5],
    };

    const execution = toExecutionSchedule(user);
    const roundTrip = toUserSchedule(execution, user.timezone);

    assert.equal(roundTrip.startDate, user.startDate);
    assert.equal(roundTrip.startTime, user.startTime);
    assert.deepEqual(roundTrip.repeatDays, user.repeatDays);
  });

  it("fires at the user-selected local time after conversion", () => {
    const user = {
      startDate: "2026-06-10",
      startTime: "10:30",
      timezone: "America/New_York",
      repeat: false,
      repeatInterval: 1,
      repeatUnit: "week" as const,
      repeatDays: [3],
      ingestLinkIds: [1],
      endsOn: null,
      active: true,
    };

    const execution = toExecutionSchedule({
      ...user,
      repeatInterval: 1,
      repeatUnit: "week",
      repeatDays: user.repeatDays,
    });

    const schedule: CronScheduleConfig = {
      id: "rss-tz",
      ...execution,
      repeat: false,
      repeatInterval: 1,
      repeatUnit: "week",
      ingestLinkIds: [1],
      endsOn: null,
      active: true,
    };

    assert.equal(
      isWithinCronSchedule(schedule, new Date("2026-06-10T14:30:00.000Z")),
      true,
    );
  });
});
