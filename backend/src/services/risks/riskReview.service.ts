import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { risks } from "../../schema/risks/risks.js";
import { users } from "../../schema/users/users.js";
import { HttpError } from "../../utils/httpError.js";
import { resolveRiskUuid } from "./riskResolve.js";

function truncate(value: string | null | undefined, max: number): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

function str(v: unknown, fallback = ""): string {
  if (v == null) return fallback;
  return String(v).trim();
}

export type ReviewerInfo = {
  userId: string;
  username: string;
  email: string;
  displayName: string;
};

export async function resolveReviewer(userId: string): Promise<ReviewerInfo> {
  const [user] = await db
    .select({
      username: users.username,
      email: users.email,
      fullName: users.fullName,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const username = user?.username ?? "";
  const email = user?.email ?? "";
  const displayName =
    user?.fullName?.trim() || username || email || "Reviewer";

  return { userId, username, email, displayName };
}

export type ApproveReviewResult = {
  riskId: string;
};

export type ReviewClassification = "raw" | "structured";

export type ApproveReviewOptions = {
  /** Optional domain override from reviewer. */
  domain?: string;
  classification?: ReviewClassification;
  feedback?: string;
  reviewer: ReviewerInfo;
};

export type RejectReviewOptions = {
  feedback: string;
  classification?: ReviewClassification;
  reviewer: ReviewerInfo;
};

function assertNotAlreadyApproved(reviewStatus: string): void {
  if (reviewStatus === "approved") {
    throw HttpError.conflict("This risk has already been moved to Risks.");
  }
}

function assertCanReject(reviewStatus: string): void {
  assertNotAlreadyApproved(reviewStatus);
  if (reviewStatus === "rejected") {
    throw HttpError.conflict("This risk has already been marked as Raw.");
  }
  if (reviewStatus === "classified") {
    throw HttpError.conflict("This risk has already been marked as Structured.");
  }
}

function assertCanClassify(reviewStatus: string): void {
  assertNotAlreadyApproved(reviewStatus);
  if (reviewStatus === "classified") {
    throw HttpError.conflict("This risk has already been marked as Structured.");
  }
  if (reviewStatus === "rejected") {
    throw HttpError.conflict("This risk has already been marked as Raw.");
  }
}

function reviewerPayload(reviewer: ReviewerInfo): Record<string, string> {
  return {
    user_id: reviewer.userId,
    username: reviewer.username,
    email: reviewer.email,
    display_name: reviewer.displayName,
  };
}

/**
 * Approve a review-queue risk: mark human-reviewed and visible on the Risks page.
 */
export async function approveReviewRisk(
  riskIdOrDisplayId: string,
  options: ApproveReviewOptions,
): Promise<ApproveReviewResult> {
  const uuid = await resolveRiskUuid(riskIdOrDisplayId);
  if (!uuid) {
    throw HttpError.notFound("Risk not found.");
  }

  const [row] = await db
    .select({
      id: risks.id,
      domains: risks.domains,
      extractionJson: risks.extractionJson,
    })
    .from(risks)
    .where(eq(risks.id, uuid))
    .limit(1);

  if (!row) {
    throw HttpError.notFound("Risk not found.");
  }

  const ext = (row.extractionJson ?? {}) as Record<string, unknown>;
  const reviewStatus = str(ext.review_status).toLowerCase();
  assertNotAlreadyApproved(reviewStatus);

  const risk = (ext.risk ?? {}) as Record<string, unknown>;
  const domain = str(options.domain ?? row.domains ?? risk.domains);

  const feedback = options.feedback?.trim();
  const reviewedAt = new Date().toISOString();
  const updatedExtraction: Record<string, unknown> = {
    ...ext,
    review_status: "approved",
    review_classification: options.classification ?? "structured",
    approved_at: reviewedAt,
    reviewed_at: reviewedAt,
    reviewed_by: reviewerPayload(options.reviewer),
    review_feedback: feedback || str(ext.review_feedback),
  };

  await db
    .update(risks)
    .set({
      ...(domain ? { domains: truncate(domain, 255) } : {}),
      extractionJson: updatedExtraction,
      updatedAt: new Date(),
    })
    .where(eq(risks.id, uuid));

  return { riskId: uuid };
}

/**
 * Reject a review-queue item: not a valid risk; store reviewer feedback.
 */
export async function rejectReviewRisk(
  riskIdOrDisplayId: string,
  options: RejectReviewOptions,
): Promise<void> {
  const feedback = options.feedback.trim();
  if (!feedback) {
    throw HttpError.unprocessable("Feedback is required when rejecting a risk.");
  }

  const uuid = await resolveRiskUuid(riskIdOrDisplayId);
  if (!uuid) {
    throw HttpError.notFound("Risk not found.");
  }

  const [row] = await db
    .select({
      id: risks.id,
      extractionJson: risks.extractionJson,
    })
    .from(risks)
    .where(eq(risks.id, uuid))
    .limit(1);

  if (!row) {
    throw HttpError.notFound("Risk not found.");
  }

  const ext = (row.extractionJson ?? {}) as Record<string, unknown>;
  const reviewStatus = str(ext.review_status).toLowerCase();
  assertCanReject(reviewStatus);

  const reviewedAt = new Date().toISOString();
  const updatedExtraction: Record<string, unknown> = {
    ...ext,
    review_status: "rejected",
    review_classification: options.classification ?? "raw",
    review_feedback: feedback,
    rejected_at: reviewedAt,
    reviewed_at: reviewedAt,
    reviewed_by: reviewerPayload(options.reviewer),
  };

  await db
    .update(risks)
    .set({
      extractionJson: updatedExtraction,
      updatedAt: new Date(),
    })
    .where(eq(risks.id, uuid));
}

export type ClassifyReviewOptions = {
  feedback: string;
  reviewer: ReviewerInfo;
};

/**
 * Mark a review-queue item as structured without moving it to the Risks page.
 */
export async function classifyReviewRisk(
  riskIdOrDisplayId: string,
  options: ClassifyReviewOptions,
): Promise<void> {
  const feedback = options.feedback.trim();
  if (!feedback) {
    throw HttpError.unprocessable(
      "Feedback is required when saving a structured review.",
    );
  }

  const uuid = await resolveRiskUuid(riskIdOrDisplayId);
  if (!uuid) {
    throw HttpError.notFound("Risk not found.");
  }

  const [row] = await db
    .select({
      id: risks.id,
      extractionJson: risks.extractionJson,
    })
    .from(risks)
    .where(eq(risks.id, uuid))
    .limit(1);

  if (!row) {
    throw HttpError.notFound("Risk not found.");
  }

  const ext = (row.extractionJson ?? {}) as Record<string, unknown>;
  const reviewStatus = str(ext.review_status).toLowerCase();
  assertCanClassify(reviewStatus);

  const reviewedAt = new Date().toISOString();
  const updatedExtraction: Record<string, unknown> = {
    ...ext,
    review_status: "classified",
    review_classification: "structured",
    review_feedback: feedback,
    classified_at: reviewedAt,
    reviewed_at: reviewedAt,
    reviewed_by: reviewerPayload(options.reviewer),
  };

  await db
    .update(risks)
    .set({
      extractionJson: updatedExtraction,
      updatedAt: new Date(),
    })
    .where(eq(risks.id, uuid));
}

export type UpdateReviewFeedbackOptions = {
  feedback: string;
  reviewer: ReviewerInfo;
};

/**
 * Update feedback text on an existing review (raw or structured, not yet on Risks).
 */
export async function updateReviewFeedback(
  riskIdOrDisplayId: string,
  options: UpdateReviewFeedbackOptions,
): Promise<void> {
  const feedback = options.feedback.trim();
  if (!feedback) {
    throw HttpError.unprocessable("Feedback is required.");
  }

  const uuid = await resolveRiskUuid(riskIdOrDisplayId);
  if (!uuid) {
    throw HttpError.notFound("Risk not found.");
  }

  const [row] = await db
    .select({
      id: risks.id,
      extractionJson: risks.extractionJson,
    })
    .from(risks)
    .where(eq(risks.id, uuid))
    .limit(1);

  if (!row) {
    throw HttpError.notFound("Risk not found.");
  }

  const ext = (row.extractionJson ?? {}) as Record<string, unknown>;
  const reviewStatus = str(ext.review_status).toLowerCase();

  if (reviewStatus === "approved") {
    throw HttpError.conflict("Cannot edit feedback for items already on Risks.");
  }

  if (reviewStatus !== "rejected" && reviewStatus !== "classified") {
    throw HttpError.unprocessable(
      "Feedback can only be edited after a review has been saved.",
    );
  }

  const reviewedAt = new Date().toISOString();
  const updatedExtraction: Record<string, unknown> = {
    ...ext,
    review_feedback: feedback,
    reviewed_at: reviewedAt,
    reviewed_by: reviewerPayload(options.reviewer),
  };

  await db
    .update(risks)
    .set({
      extractionJson: updatedExtraction,
      updatedAt: new Date(),
    })
    .where(eq(risks.id, uuid));
}
