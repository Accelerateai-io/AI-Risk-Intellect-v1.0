/**
 * Review state lives inside `risks.extraction_json`, so replacing that JSON
 * (forced re-extraction, match backfills) would silently destroy approvals.
 * Every path that rebuilds extraction_json for an existing row MUST merge
 * through preserveReviewState.
 */

export const PRESERVED_REVIEW_KEYS = [
  "review_status",
  "review_classification",
  "review_feedback",
  "reviewed_by",
  "reviewed_at",
  "approved_at",
] as const;

export type PreservedReviewKey = (typeof PRESERVED_REVIEW_KEYS)[number];

/**
 * Merge review state from the old extraction JSON into a freshly generated
 * one. The old review decision always wins: an approved/rejected/classified
 * risk stays that way even when the fresh extraction would flag it as
 * pending. Review reasons produced by the fresh extraction are kept under
 * `reextract_review_reasons` so reviewers can still see them.
 */
export function preserveReviewState(
  oldExtraction: Record<string, unknown> | null | undefined,
  newExtraction: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...newExtraction };
  const old = oldExtraction ?? {};

  const oldStatus = String(old.review_status ?? "").trim();
  const hasReviewDecision = oldStatus !== "" && oldStatus !== "pending";

  // Undecided rows carry nothing worth protecting: the fresh extraction's
  // review flags describe the current state.
  if (!hasReviewDecision) return merged;

  for (const key of PRESERVED_REVIEW_KEYS) {
    if (old[key] !== undefined) {
      merged[key] = old[key];
    } else if (key in merged && key !== "review_status") {
      // A decided risk must not inherit fresh review markers for keys the
      // old row never had.
      delete merged[key];
    }
  }

  const freshReason = String(newExtraction.review_reason ?? "").trim();
  if (freshReason) {
    merged.reextract_review_reasons = freshReason;
  }
  // The decided status replaced any fresh "pending"; drop the fresh reason
  // so the Review UI does not resurface a settled risk.
  delete merged.review_reason;
  if (old.review_reason !== undefined) {
    merged.review_reason = old.review_reason;
  }

  return merged;
}
