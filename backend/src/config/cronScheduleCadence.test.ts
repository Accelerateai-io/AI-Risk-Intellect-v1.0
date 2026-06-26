import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getCronScheduleSkipReason,
  isWithinCronSchedule,
  msUntilNextCronScheduleRun,
  type CronScheduleConfig,
} from "./cronScheduleConfig.js";

const TZ = "Asia/Kolkata";

function baseSchedule(
  overrides: Partial<CronScheduleConfig> = {},
): CronScheduleConfig {
  return {
    id: "cadence-test",
    startDate: "2026-06-11",
    startTime: "10:30",
    timezone: TZ,
    repeat: true,
    repeatInterval: 1,
    repeatUnit: "day",
    repeatDays: [],
    ingestLinkIds: [1],
    endsOn: null,
    active: true,
    ...overrides,
  };
}

/** IST 10:30 on a calendar date → UTC instant (Kolkata is UTC+5:30). */
function istAt(date: string, time = "10:30"): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh - 5, mm - 30));
}

describe("cron schedule cadence — one-time", () => {
  const schedule = baseSchedule({
    repeat: false,
    repeatUnit: "week",
    repeatDays: [4],
  });

  it("does not run before the start date", () => {
    assert.equal(isWithinCronSchedule(schedule, istAt("2026-06-10")), false);
  });

  it("runs on the start date at start time", () => {
    assert.equal(isWithinCronSchedule(schedule, istAt("2026-06-11")), true);
  });

  it("does not run after the start date when repeat is off", () => {
    assert.equal(isWithinCronSchedule(schedule, istAt("2026-06-12")), false);
  });
});

describe("cron schedule cadence — daily", () => {
  const schedule = baseSchedule({
    repeatUnit: "day",
    repeatInterval: 1,
  });

  it("does not run before the start date", () => {
    assert.match(
      getCronScheduleSkipReason(schedule, istAt("2026-06-10")) ?? "",
      /daily repeat interval does not match/,
    );
  });

  it("waits until start time on the first day", () => {
    assert.match(
      getCronScheduleSkipReason(schedule, istAt("2026-06-11", "10:29")) ?? "",
      /before start time/,
    );
    assert.equal(isWithinCronSchedule(schedule, istAt("2026-06-11")), true);
  });

  it("runs every day after the start date at start time", () => {
    for (const date of ["2026-06-12", "2026-06-13", "2026-06-18"]) {
      assert.equal(
        isWithinCronSchedule(schedule, istAt(date)),
        true,
        `expected daily run on ${date}`,
      );
    }
  });

  it("respects repeat interval (every 2 days)", () => {
    const everyTwoDays = baseSchedule({
      repeatUnit: "day",
      repeatInterval: 2,
    });
    assert.equal(isWithinCronSchedule(everyTwoDays, istAt("2026-06-11")), true);
    assert.equal(isWithinCronSchedule(everyTwoDays, istAt("2026-06-12")), false);
    assert.equal(isWithinCronSchedule(everyTwoDays, istAt("2026-06-13")), true);
  });
});

describe("cron schedule cadence — weekly", () => {
  // 2026-06-11 is Thursday (weekday 4)
  const schedule = baseSchedule({
    repeatUnit: "week",
    repeatInterval: 1,
    repeatDays: [1, 3, 4], // Mon, Wed, Thu
  });

  it("runs on selected weekdays at start time", () => {
    assert.equal(isWithinCronSchedule(schedule, istAt("2026-06-11")), true); // Thu
    assert.equal(isWithinCronSchedule(schedule, istAt("2026-06-15")), true); // Mon
    assert.equal(isWithinCronSchedule(schedule, istAt("2026-06-17")), true); // Wed
  });

  it("skips unselected weekdays", () => {
    assert.match(
      getCronScheduleSkipReason(schedule, istAt("2026-06-12")) ?? "", // Fri
      /weekly repeat does not include Fri/,
    );
    assert.match(
      getCronScheduleSkipReason(schedule, istAt("2026-06-13")) ?? "", // Sat
      /weekly repeat does not include Sat/,
    );
  });

  it("respects every-N-weeks interval from the start date", () => {
    const biweekly = baseSchedule({
      repeatUnit: "week",
      repeatInterval: 2,
      repeatDays: [4], // Thu only
    });
    assert.equal(isWithinCronSchedule(biweekly, istAt("2026-06-11")), true);
    assert.equal(isWithinCronSchedule(biweekly, istAt("2026-06-18")), false);
    assert.equal(isWithinCronSchedule(biweekly, istAt("2026-06-25")), true);
  });

  it("schedules the next run on the next selected weekday", () => {
    const monWed = baseSchedule({
      repeatUnit: "week",
      repeatInterval: 1,
      repeatDays: [1, 3],
    });
    // Thu Jun 11 — next is Mon Jun 15
    const ms = msUntilNextCronScheduleRun(monWed, istAt("2026-06-11"));
    assert.ok(ms != null && ms > 0);
    const nextRun = new Date(istAt("2026-06-11").getTime() + ms);
    assert.equal(
      isWithinCronSchedule(monWed, nextRun),
      true,
      "next run should land on a matching weekday at start time",
    );
  });
});

describe("cron schedule cadence — monthly", () => {
  const schedule = baseSchedule({
    repeatUnit: "month",
    repeatInterval: 1,
  });

  it("runs on the start day of each month at start time", () => {
    assert.equal(isWithinCronSchedule(schedule, istAt("2026-06-11")), true);
    assert.equal(isWithinCronSchedule(schedule, istAt("2026-07-11")), true);
    assert.equal(isWithinCronSchedule(schedule, istAt("2026-08-11")), true);
  });

  it("skips other days in the month", () => {
    assert.match(
      getCronScheduleSkipReason(schedule, istAt("2026-06-12")) ?? "",
      /monthly repeat does not match/,
    );
  });

  it("uses the last day when the target day does not exist (Jan 31 → Feb)", () => {
    const jan31 = baseSchedule({
      startDate: "2026-01-31",
      repeatUnit: "month",
    });
    assert.equal(isWithinCronSchedule(jan31, istAt("2026-01-31")), true);
    assert.equal(isWithinCronSchedule(jan31, istAt("2026-02-28")), true);
    assert.equal(isWithinCronSchedule(jan31, istAt("2026-03-31")), true);
  });

  it("respects every-N-months interval", () => {
    const everyTwoMonths = baseSchedule({
      repeatUnit: "month",
      repeatInterval: 2,
    });
    assert.equal(isWithinCronSchedule(everyTwoMonths, istAt("2026-06-11")), true);
    assert.equal(isWithinCronSchedule(everyTwoMonths, istAt("2026-07-11")), false);
    assert.equal(isWithinCronSchedule(everyTwoMonths, istAt("2026-08-11")), true);
  });
});

describe("cron schedule cadence — yearly", () => {
  const schedule = baseSchedule({
    repeatUnit: "year",
    repeatInterval: 1,
  });

  it("runs on the start month/day each year at start time", () => {
    assert.equal(isWithinCronSchedule(schedule, istAt("2026-06-11")), true);
    assert.equal(isWithinCronSchedule(schedule, istAt("2027-06-11")), true);
    assert.equal(isWithinCronSchedule(schedule, istAt("2028-06-11")), true);
  });

  it("skips other dates", () => {
    assert.match(
      getCronScheduleSkipReason(schedule, istAt("2026-06-12")) ?? "",
      /yearly repeat does not match/,
    );
    assert.match(
      getCronScheduleSkipReason(schedule, istAt("2027-06-10")) ?? "",
      /yearly repeat does not match/,
    );
  });

  it("respects every-N-years interval", () => {
    const everyTwoYears = baseSchedule({
      repeatUnit: "year",
      repeatInterval: 2,
    });
    assert.equal(isWithinCronSchedule(everyTwoYears, istAt("2026-06-11")), true);
    assert.equal(isWithinCronSchedule(everyTwoYears, istAt("2027-06-11")), false);
    assert.equal(isWithinCronSchedule(everyTwoYears, istAt("2028-06-11")), true);
  });
});

describe("cron schedule cadence — endsOn and inactive", () => {
  it("stops after endsOn", () => {
    const schedule = baseSchedule({ endsOn: "2026-06-15" });
    assert.equal(isWithinCronSchedule(schedule, istAt("2026-06-15")), true);
    assert.match(
      getCronScheduleSkipReason(schedule, istAt("2026-06-16")) ?? "",
      /schedule ended/,
    );
  });

  it("never runs when inactive", () => {
    const schedule = baseSchedule({ active: false });
    assert.match(
      getCronScheduleSkipReason(schedule, istAt("2026-06-11")) ?? "",
      /inactive/,
    );
  });
});

describe("cron schedule cadence — next run timing", () => {
  it("returns ms until today's start when before start time on a matching day", () => {
    const schedule = baseSchedule({ repeatUnit: "day" });
    assert.equal(
      msUntilNextCronScheduleRun(schedule, istAt("2026-06-11", "10:29")),
      60_000,
    );
  });

  it("returns ms until tomorrow for daily after start time", () => {
    const schedule = baseSchedule({ repeatUnit: "day" });
    const ms = msUntilNextCronScheduleRun(schedule, istAt("2026-06-11", "10:31"));
    assert.ok(ms != null && ms > 20 * 60 * 60_000 && ms < 26 * 60 * 60_000);
  });

  it("returns ms until next month for monthly after this month's run", () => {
    const schedule = baseSchedule({ repeatUnit: "month" });
    const ms = msUntilNextCronScheduleRun(schedule, istAt("2026-06-11", "10:31"));
    assert.ok(ms != null && ms > 25 * 24 * 60 * 60_000);
    const next = new Date(istAt("2026-06-11", "10:31").getTime() + ms);
    assert.equal(isWithinCronSchedule(schedule, next), true);
  });

  it("returns ms until next year for yearly after this year's run", () => {
    const schedule = baseSchedule({ repeatUnit: "year" });
    const ms = msUntilNextCronScheduleRun(schedule, istAt("2026-06-11", "10:31"));
    assert.ok(ms != null && ms > 300 * 24 * 60 * 60_000);
    const next = new Date(istAt("2026-06-11", "10:31").getTime() + ms);
    assert.equal(isWithinCronSchedule(schedule, next), true);
  });
});
