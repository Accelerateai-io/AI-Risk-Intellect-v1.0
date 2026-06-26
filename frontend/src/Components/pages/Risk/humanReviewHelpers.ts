import { formatDisplayDate } from "../../../utils/formatDate";
import type { HumanReviewInfo } from "./riskData";

export type ReviewClassification = "raw" | "structured";

export function resolveReviewClassification(
  review: HumanReviewInfo | undefined,
): ReviewClassification | null {
  if (review?.classification === "raw" || review?.classification === "structured") {
    return review.classification;
  }
  if (review?.status === "classified") return "structured";
  if (review?.status === "rejected") return "raw";
  return null;
}

export function canPromoteReviewToRisks(
  review: HumanReviewInfo | undefined,
): boolean {
  return review?.status === "classified" || review?.status === "rejected";
}

export function isExistingHumanReview(
  review: HumanReviewInfo | undefined,
): boolean {
  if (!review?.status || review.status === "pending") return false;
  return true;
}

export function isPendingHumanReview(review: HumanReviewInfo | undefined): boolean {
  if (!review?.status) return true;
  return review.status === "pending";
}

export function formatHumanReviewTooltip(
  review: HumanReviewInfo | undefined,
): string | null {
  if (!review?.status || review.status === "pending") return null;

  const reviewer = review.reviewedBy ?? "Unknown reviewer";
  const when = review.reviewedAt
    ? formatDisplayDate(review.reviewedAt)
    : "unknown date";

  if (review.status === "approved") {
    return `Moved to Risks by ${reviewer} on ${when}.`;
  }

  if (review.status === "classified") {
    const feedback = review.feedback?.trim();
    if (feedback) {
      return `Marked as Structured by ${reviewer} on ${when}. Feedback: ${feedback}`;
    }
    return `Marked as Structured by ${reviewer} on ${when}.`;
  }

  const feedback = review.feedback?.trim();
  if (feedback) {
    return `Marked as Raw by ${reviewer} on ${when}. Feedback: ${feedback}`;
  }
  return `Marked as Raw by ${reviewer} on ${when}.`;
}

export type HumanReviewMoveDetails = {
  reviewer: string;
  reviewedAtDisplay: string;
  classificationLabel: string;
  feedback: string | null;
};

export function getHumanReviewMoveDetails(
  review: HumanReviewInfo | undefined,
): HumanReviewMoveDetails | null {
  if (review?.status !== "approved") return null;

  const reviewer = review.reviewedBy?.trim() || "Unknown reviewer";
  const reviewedAtDisplay = review.reviewedAt
    ? formatDisplayDate(review.reviewedAt)
    : "Unknown date";

  const classificationLabel =
    review.classification === "raw"
      ? "Raw"
      : review.classification === "structured"
        ? "Structured"
        : "Not specified";

  const feedback = review.feedback?.trim() || null;

  return {
    reviewer,
    reviewedAtDisplay,
    classificationLabel,
    feedback,
  };
}

export function humanReviewStatusLabel(
  review: HumanReviewInfo | undefined,
): string | null {
  if (!review?.status || review.status === "pending") return null;
  if (review.status === "approved") return "On Risks";
  if (review.status === "classified") return "Structured";
  if (review.classification === "raw" || review.status === "rejected") {
    return "Raw";
  }
  return "Reviewed";
}

export function canPromoteClassifiedToRisks(
  review: HumanReviewInfo | undefined,
): boolean {
  return review?.status === "classified";
}
