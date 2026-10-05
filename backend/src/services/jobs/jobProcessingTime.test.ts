import assert from "node:assert/strict";
import { test } from "node:test";
import {
  averageProcessingSeconds,
  completedJobProcessingMs,
} from "./jobProcessingTime.js";

test("completed job processing uses start until the risk was stored", () => {
  const startedAt = new Date("2026-09-29T08:00:00.000Z");
  const riskFetchedAt = new Date("2026-09-29T08:01:04.000Z");
  const updatedAt = new Date("2026-09-29T08:01:08.000Z");

  assert.equal(
    completedJobProcessingMs({ startedAt, updatedAt, riskFetchedAt }),
    64_000,
  );
});

test("average processing is the mean of finished runs, in whole seconds", () => {
  assert.equal(averageProcessingSeconds([64_000]), 64);
  assert.equal(averageProcessingSeconds([64_000, 80_000]), 72);
  assert.equal(averageProcessingSeconds([]), 0);
});
