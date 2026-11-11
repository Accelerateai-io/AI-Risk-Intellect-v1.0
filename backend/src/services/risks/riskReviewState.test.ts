import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { preserveReviewState } from "./riskReviewState.js";

describe("preserveReviewState", () => {
  it("keeps an approved decision over a fresh pending flag", () => {
    const old = {
      review_status: "approved",
      reviewed_by: "asad@accelerateai.io",
      reviewed_at: "2026-07-01T10:00:00Z",
      approved_at: "2026-07-01T10:00:00Z",
    };
    const fresh = {
      risk: { risk_title: "New title" },
      review_status: "pending",
      review_reason: "Quality score below automated approval threshold.",
    };

    const merged = preserveReviewState(old, fresh);
    assert.equal(merged.review_status, "approved");
    assert.equal(merged.reviewed_by, "asad@accelerateai.io");
    assert.equal(merged.approved_at, "2026-07-01T10:00:00Z");
    // Fresh reasons preserved separately, not as an active review flag.
    assert.equal(
      merged.reextract_review_reasons,
      "Quality score below automated approval threshold.",
    );
    assert.equal(merged.review_reason, undefined);
  });

  it("keeps rejected/classified decisions and their feedback", () => {
    const old = {
      review_status: "classified",
      review_classification: "false_positive",
      review_feedback: "Not an AI risk.",
    };
    const merged = preserveReviewState(old, {
      review_status: "pending",
      review_reason: "Near-duplicate detected.",
    });
    assert.equal(merged.review_status, "classified");
    assert.equal(merged.review_classification, "false_positive");
    assert.equal(merged.review_feedback, "Not an AI risk.");
  });

  it("lets fresh review flags through for undecided rows", () => {
    const old = { review_status: "pending", review_reason: "old reason" };
    const merged = preserveReviewState(old, {
      review_status: "pending",
      review_reason: "fresh reason",
    });
    // No decision to protect: the fresh extraction's reason is the current
    // state and stays active.
    assert.equal(merged.review_status, "pending");
    assert.equal(merged.review_reason, "fresh reason");
  });

  it("passes fresh extraction through untouched when there is no old state", () => {
    const fresh = {
      risk: { risk_title: "T" },
      review_status: "pending",
      review_reason: "reason",
    };
    const merged = preserveReviewState(null, fresh);
    assert.deepEqual(merged, fresh);
  });

  it("preserves the old review_reason on decided rows", () => {
    const old = {
      review_status: "approved",
      review_reason: "Was reviewed manually.",
    };
    const merged = preserveReviewState(old, {
      review_status: "pending",
      review_reason: "fresh reason",
    });
    assert.equal(merged.review_reason, "Was reviewed manually.");
    assert.equal(merged.reextract_review_reasons, "fresh reason");
  });

  it("does not mutate its inputs", () => {
    const old = { review_status: "approved" };
    const fresh = { review_status: "pending", review_reason: "r" };
    preserveReviewState(old, fresh);
    assert.deepEqual(old, { review_status: "approved" });
    assert.deepEqual(fresh, { review_status: "pending", review_reason: "r" });
  });
});
