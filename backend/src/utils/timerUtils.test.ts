import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clampSetTimeoutMs, MAX_SET_TIMEOUT_MS } from "./timerUtils.js";

describe("timerUtils", () => {
  it("clamps delays above the Node setTimeout limit", () => {
    assert.equal(clampSetTimeoutMs(2_591_940_000), MAX_SET_TIMEOUT_MS);
  });

  it("preserves delays within the Node setTimeout limit", () => {
    assert.equal(clampSetTimeoutMs(60_000, 1_000), 60_000);
  });

  it("enforces the minimum delay", () => {
    assert.equal(clampSetTimeoutMs(100, 1_000), 1_000);
  });
});
