import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cronLifecycleEventMatchesTodayOccurrence } from "./cronJobEvents.service.js";

describe("cron lifecycle occurrence matching", () => {
  const today = "2026-06-18";
  const startTime = "14:03";

  it("ignores completion earlier than today's start time", () => {
    assert.equal(
      cronLifecycleEventMatchesTodayOccurrence(
        today,
        "10:30",
        today,
        startTime,
      ),
      false,
    );
  });

  it("counts completion at the scheduled start time", () => {
    assert.equal(
      cronLifecycleEventMatchesTodayOccurrence(
        today,
        "14:03",
        today,
        startTime,
      ),
      true,
    );
  });

  it("counts completion after the scheduled start time", () => {
    assert.equal(
      cronLifecycleEventMatchesTodayOccurrence(
        today,
        "15:00",
        today,
        startTime,
      ),
      true,
    );
  });

  it("ignores events on a different calendar day", () => {
    assert.equal(
      cronLifecycleEventMatchesTodayOccurrence(
        "2026-06-17",
        "14:30",
        today,
        startTime,
      ),
      false,
    );
  });
});
