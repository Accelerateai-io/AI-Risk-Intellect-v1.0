import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  msUntilNextCronScheduleRun,
  type CronScheduleConfig,
} from "../../config/cronScheduleConfig.js";

describe("cron discovery wait planning", () => {
  const dailySchedule: CronScheduleConfig = {
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

  it("msUntilNext skips to tomorrow once today's start time has passed", () => {
    const now = new Date("2026-06-18T05:09:00.000Z"); // 10:39 IST
    const waitMs = msUntilNextCronScheduleRun(dailySchedule, now);
    assert.ok(waitMs != null);
    assert.ok(
      waitMs > 20 * 60 * 60_000,
      "expected the next run to be scheduled for tomorrow, not now",
    );
  });
});
