import assert from "node:assert/strict";
import { test } from "node:test";
import {
  executionLadderSkipReason,
  executionRetryLimits,
} from "./executionRetryLimits.js";

test("a 5-minute start uses 12 intervals and ends at 60", () => {
  assert.deepEqual(executionRetryLimits(5), [
    5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60,
  ]);
});

test("a later start still stops at 60 minutes", () => {
  assert.deepEqual(executionRetryLimits(50), [50, 55, 60]);
  assert.deepEqual(executionRetryLimits(60), [60]);
});

test("the final skip reason names the ladder", () => {
  const reason = executionLadderSkipReason(5, 60, 12);
  assert.match(reason, /12 execution-time intervals/);
  assert.match(reason, /started at 5 minutes/);
  assert.match(reason, /up to 60 minutes/);
});
