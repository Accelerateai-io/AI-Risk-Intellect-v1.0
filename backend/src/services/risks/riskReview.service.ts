import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { risks } from "../../schema/risks/risks.js";
import { riskReviewLogs } from "../../schema/risks/riskReviewLogs.js";
import { users } from "../../schema/users/users.js";
import { HttpError } from "../../utils/httpError.js";
import {
  isDomainInTaxonomy,
  normalizeToCatalogDomain,
} from "./riskCatalogMatch.service.js";
import { DOMAIN_REVIEW_REASON } from "./riskQuality.js";
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

function applyMappedDomain(
  ext: Record<string, unknown>,
  nextDomain: string,
  previousDomain: string,
): Record<string, unknown> {
  const risk = (ext.risk ?? {}) as Record<string, unknown>;
  const reason = str(ext.review_reason);
  const remainingReason = reason
    .replaceAll(DOMAIN_REVIEW_REASON, "")
    .replace(/\s+/g, " ")
    .trim();

  return {
    ...ext,
    risk: {
      ...risk,
      domains: nextDomain,
    },
    original_extracted_domain: str(ext.original_extracted_domain) || previousDomain,
    reviewer_mapped_domain: nextDomain,
    review_reason: remainingReason || undefined,
  };
}

function reviewerPayload(reviewer: ReviewerInfo): Record<string, string> {
  return {
    user_id: reviewer.userId,
    username: reviewer.username,
    email: reviewer.email,
    display_name: reviewer.displayName,
  };
}

const MIN_FEEDBACK_LEN = 3;

function requireFeedback(value: string, message: string): string {
  const feedback = value.trim();
  if (feedback.length < MIN_FEEDBACK_LEN) {
    throw HttpError.unprocessable(message);
  }
  return feedback;
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
  const previousDomain = str(row.domains ?? risk.domains);
  const requestedDomain = str(options.domain);
  const mappedDomain = requestedDomain
    ? normalizeToCatalogDomain(requestedDomain)
    : null;
  if (requestedDomain && !mappedDomain) {
    throw HttpError.unprocessable(
      "Domain must be one of the 7 taxonomy domains.",
    );
  }
  if (!mappedDomain && !isDomainInTaxonomy(previousDomain)) {
    throw HttpError.unprocessable(
      "Select one of the 7 taxonomy domains before moving this item to Risks.",
    );
  }
  const domain = mappedDomain || previousDomain;
  const mappedExt = mappedDomain
    ? applyMappedDomain(ext, mappedDomain, previousDomain)
    : ext;

  const feedback = requireFeedback(
    options.feedback?.trim() || str(ext.review_feedback),
    "Feedback is required before moving this item to Risks.",
  );
  const classification = options.classification ?? "structured";
  const reviewedAt = new Date().toISOString();
  const updatedExtraction: Record<string, unknown> = {
    ...mappedExt,
    review_status: "approved",
    review_classification: classification,
    approved_at: reviewedAt,
    reviewed_at: reviewedAt,
    reviewed_by: reviewerPayload(options.reviewer),
    review_feedback: feedback,
  };

  await db.transaction(async (tx) => {
    await tx
      .update(risks)
      .set({
        ...(domain ? { domains: truncate(domain, 255) } : {}),
        extractionJson: updatedExtraction,
        updatedAt: new Date(),
      })
      .where(eq(risks.id, uuid));
    await tx.insert(riskReviewLogs).values({
      riskId: uuid,
      submittedByUserId: options.reviewer.userId,
      action: "approve",
      classification,
      feedback,
    });
  });

  return { riskId: uuid };
}

export async function remapReviewDomain(
  riskIdOrDisplayId: string,
  input: { domain: string; reviewer: ReviewerInfo },
): Promise<{ riskId: string; domain: string }> {
  const nextDomain = normalizeToCatalogDomain(input.domain.trim());
  if (!nextDomain || !isDomainInTaxonomy(nextDomain)) {
    throw HttpError.unprocessable(
      "Select one of the 7 available taxonomy domains.",
    );
  }

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
  const previousDomain = str(row.domains ?? risk.domains);
  if (isDomainInTaxonomy(previousDomain)) {
    throw HttpError.unprocessable(
      "This domain is already one of the 7 taxonomy domains.",
    );
  }
  const remappedAt = new Date().toISOString();
  const updatedExtraction = {
    ...applyMappedDomain(ext, nextDomain, previousDomain),
    domain_remapped_at: remappedAt,
    domain_remapped_by: reviewerPayload(input.reviewer),
  };

  await db
    .update(risks)
    .set({
      domains: truncate(nextDomain, 255),
      extractionJson: updatedExtraction,
      updatedAt: new Date(),
    })
    .where(eq(risks.id, uuid));

  return { riskId: uuid, domain: nextDomain };
}

/**
 * Reject a review-queue item: not a valid risk; store reviewer feedback.
 */
export async function rejectReviewRisk(
  riskIdOrDisplayId: string,
  options: RejectReviewOptions,
): Promise<void> {
  const feedback = requireFeedback(
    options.feedback,
    "Feedback is required when marking a risk as Raw.",
  );

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

  await db.transaction(async (tx) => {
    await tx
      .update(risks)
      .set({
        extractionJson: updatedExtraction,
        updatedAt: new Date(),
      })
      .where(eq(risks.id, uuid));
    await tx.insert(riskReviewLogs).values({
      riskId: uuid,
      submittedByUserId: options.reviewer.userId,
      action: "reject",
      classification: options.classification ?? "raw",
      feedback,
    });
  });
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
  const feedback = requireFeedback(
    options.feedback,
    "Feedback is required when saving a structured review.",
  );

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

  await db.transaction(async (tx) => {
    await tx
      .update(risks)
      .set({
        extractionJson: updatedExtraction,
        updatedAt: new Date(),
      })
      .where(eq(risks.id, uuid));
    await tx.insert(riskReviewLogs).values({
      riskId: uuid,
      submittedByUserId: options.reviewer.userId,
      action: "classify",
      classification: "structured",
      feedback,
    });
  });
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
  const feedback = requireFeedback(options.feedback, "Feedback is required.");

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

  await db.transaction(async (tx) => {
    await tx
      .update(risks)
      .set({
        extractionJson: updatedExtraction,
        updatedAt: new Date(),
      })
      .where(eq(risks.id, uuid));
    await tx.insert(riskReviewLogs).values({
      riskId: uuid,
      submittedByUserId: options.reviewer.userId,
      action: "update",
      classification:
        reviewStatus === "rejected"
          ? "raw"
          : reviewStatus === "classified"
            ? "structured"
            : null,
      feedback,
    });
  });
}
