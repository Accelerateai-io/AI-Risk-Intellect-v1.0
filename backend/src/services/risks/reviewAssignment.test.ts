import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeReviewIds,
  partitionAssignment,
  summarizeAssignment,
  chunk,
} from "./reviewAssignment.js";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const C = "33333333-3333-3333-3333-333333333333";

describe("normalizeReviewIds", () => {
  it("dedupes and drops invalid / empty entries", () => {
    const r = normalizeReviewIds([A, A, " ", "not-a-uuid", B, 42, null]);
    assert.deepEqual(r.ids.sort(), [A, B].sort());
    assert.equal(r.dropped, 4); // " ", "not-a-uuid", 42, null (duplicate A is not counted as dropped)
  });
  it("returns empty for non-arrays", () => {
    assert.deepEqual(normalizeReviewIds("x").ids, []);
  });
});

describe("partitionAssignment", () => {
  it("skips ids that are not found / not eligible", () => {
    const { toAssign, skipped } = partitionAssignment({
      requestedIds: [A, B, C],
      eligibleIds: [A, B],
    });
    assert.deepEqual(toAssign.sort(), [A, B].sort());
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0].id, C);
    assert.equal(skipped[0].reason, "not_found_or_ineligible");
  });

  it("skips ids already assigned to the target (idempotent)", () => {
    const { toAssign, skipped } = partitionAssignment({
      requestedIds: [A, B],
      eligibleIds: [A, B],
      alreadyOnTargetIds: [B],
    });
    assert.deepEqual(toAssign, [A]);
    assert.equal(skipped[0].reason, "already_assigned_to_target");
  });
});

describe("summarizeAssignment", () => {
  it("does not over-claim when rows were skipped or failed", () => {
    const res = summarizeAssignment({
      requested: 1000,
      toAssign: new Array(997).fill(A),
      skipped: [{ id: B, reason: "not_found_or_ineligible" }],
      assignedCount: 995, // 2 lost to a race
    });
    assert.equal(res.requested, 1000);
    assert.equal(res.assigned, 995);
    assert.equal(res.failed, 2);
    assert.equal(res.skipped.length, 1);
  });
});

describe("chunk", () => {
  it("splits large lists for bounded statements", () => {
    const ids = new Array(1200).fill(0).map((_, i) => String(i));
    const parts = chunk(ids, 500);
    assert.equal(parts.length, 3);
    assert.equal(parts[0].length, 500);
    assert.equal(parts[2].length, 200);
  });
});
