import assert from "node:assert/strict";
import { test } from "node:test";
import {
  averageProcessingSeconds,
  completedJobProcessingMs,
  jobExecutionMs,
} from "./jobProcessingTime.js";

test("completed job processing uses that job's start and finish", () => {
  const startedAt = new Date("2026-09-29T08:00:00.000Z");
  const finishedAt = new Date("2026-09-29T08:01:04.000Z");
  const updatedAt = new Date("2026-09-29T08:05:00.000Z");

  assert.equal(
    completedJobProcessingMs({ startedAt, updatedAt, finishedAt }),
    64_000,
  );
});

test("a later risk on the same URL does not change the first job", () => {
  const firstStart = new Date("2026-11-10T11:55:06.000Z");
  const firstFinish = new Date("2026-11-10T11:55:41.000Z");
  const secondStart = new Date("2026-11-10T11:58:47.000Z");
  const secondFinish = new Date("2026-11-10T11:59:24.000Z");

  assert.equal(
    jobExecutionMs({
      status: "done",
      startedAt: firstStart,
      finishedAt: firstFinish,
      updatedAt: firstFinish,
    }),
    35_000,
  );
  assert.equal(
    jobExecutionMs({
      status: "done",
      startedAt: secondStart,
      finishedAt: secondFinish,
      updatedAt: secondFinish,
    }),
    37_000,
  );

  // The second job's finish is what the old article-level risk timestamp was.
  assert.equal(
    jobExecutionMs({
      status: "done",
      startedAt: firstStart,
      finishedAt: firstFinish,
      updatedAt: secondFinish,
    }),
    35_000,
  );
});

test("queued, running, failed, and skipped jobs use their own clocks", () => {
  const startedAt = new Date("2026-11-10T11:55:06.000Z");
  const finishedAt = new Date("2026-11-10T11:59:06.000Z");
  const now = new Date("2026-11-10T11:56:06.000Z");

  assert.equal(
    jobExecutionMs({ status: "pending", startedAt: null, now }),
    null,
  );
  assert.equal(
    jobExecutionMs({ status: "running", startedAt, now }),
    60_000,
  );
  assert.equal(
    jobExecutionMs({ status: "failed", startedAt, finishedAt }),
    4 * 60_000,
  );
  assert.equal(
    jobExecutionMs({ status: "skipped", startedAt, finishedAt }),
    4 * 60_000,
  );
  assert.equal(
    jobExecutionMs({ status: "skipped", startedAt: null, finishedAt }),
    null,
  );
});

test("average processing is the mean of finished runs, in whole seconds", () => {
  assert.equal(averageProcessingSeconds([64_000]), 64);
  assert.equal(averageProcessingSeconds([64_000, 80_000]), 72);
  assert.equal(averageProcessingSeconds([]), 0);
});
