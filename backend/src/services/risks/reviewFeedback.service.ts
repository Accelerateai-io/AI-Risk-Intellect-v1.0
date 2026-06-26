import { desc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { articles } from "../../schema/articles/articles.js";
import { risks } from "../../schema/risks/risks.js";
import { fetchGlobalRiskDisplayIdMap } from "./riskSequence.js";

export type ReviewFeedbackClassification = "raw" | "structured";

export type ReviewFeedbackSampleDto = {
  id: string;
  displayId: string;
  title: string;
  domain: string;
  primaryRisk: string;
  classification: ReviewFeedbackClassification;
  feedback: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  articleUrl: string;
  reviewStatus: "rejected" | "approved" | "classified" | null;
  canMoveToRisks: boolean;
};

export type ReviewFeedbackListResult = {
  items: ReviewFeedbackSampleDto[];
  counts: {
    raw: number;
    structured: number;
    total: number;
  };
};

type ExtractionJson = {
  review_status?: string;
  review_classification?: string;
  review_feedback?: string;
  reviewed_at?: string;
  approved_at?: string;
  rejected_at?: string;
  classified_at?: string;
  reviewed_by?: {
    display_name?: string;
    username?: string;
    email?: string;
  };
};

function str(v: unknown, fallback = ""): string {
  if (v == null) return fallback;
  return String(v).trim();
}

function readFeedbackText(ext: ExtractionJson): string {
  return str(ext.review_feedback);
}

function classifyFeedbackSample(
  ext: ExtractionJson,
): ReviewFeedbackClassification | null {
  const classification = str(ext.review_classification).toLowerCase();
  if (classification === "raw" || classification === "structured") {
    return classification;
  }

  const status = str(ext.review_status).toLowerCase();
  if (status === "rejected") return "raw";
  if (status === "classified" || status === "approved") return "structured";

  return null;
}

function mapRowToFeedbackSample(
  row: {
    id: string;
    riskTitle: string | null;
    domains: string | null;
    primaryRisk: string | null;
    extractionJson: unknown;
    createdAt: Date;
    articleUrl: string;
  },
  displayId: string,
): ReviewFeedbackSampleDto | null {
  const ext = (row.extractionJson ?? {}) as ExtractionJson;
  const feedbackText = readFeedbackText(ext);
  if (!feedbackText) return null;

  const classification = classifyFeedbackSample(ext);
  if (!classification) return null;

  const reviewStatusRaw = str(ext.review_status).toLowerCase();
  const reviewStatus =
    reviewStatusRaw === "rejected" ||
    reviewStatusRaw === "approved" ||
    reviewStatusRaw === "classified"
      ? reviewStatusRaw
      : null;

  const reviewedByRecord = ext.reviewed_by;
  const reviewedBy =
    str(reviewedByRecord?.display_name) ||
    str(reviewedByRecord?.username) ||
    str(reviewedByRecord?.email) ||
    null;

  return {
    id: row.id,
    displayId,
    title: str(row.riskTitle, "Untitled risk"),
    domain: str(row.domains, "—"),
    primaryRisk: str(row.primaryRisk, "—"),
    classification,
    feedback: feedbackText,
    reviewedBy,
    reviewedAt:
      str(ext.reviewed_at) ||
      str(ext.approved_at) ||
      str(ext.rejected_at) ||
      str(ext.classified_at) ||
      null,
    articleUrl: row.articleUrl,
    reviewStatus,
    canMoveToRisks:
      reviewStatus === "classified" || reviewStatus === "rejected",
  };
}

export async function listReviewFeedbackSamples(): Promise<ReviewFeedbackListResult> {
  const rows = await db
    .select({
      id: risks.id,
      riskTitle: risks.riskTitle,
      domains: risks.domains,
      primaryRisk: risks.primaryRisk,
      extractionJson: risks.extractionJson,
      createdAt: risks.createdAt,
      articleUrl: articles.url,
    })
    .from(risks)
    .innerJoin(articles, eq(articles.id, risks.articleId))
    .orderBy(desc(risks.updatedAt));

  const displayIdByRiskId = await fetchGlobalRiskDisplayIdMap();

  const items = rows
    .map((row) =>
      mapRowToFeedbackSample(
        row,
        displayIdByRiskId.get(row.id) ?? "R-?",
      ),
    )
    .filter((item): item is ReviewFeedbackSampleDto => item != null);

  const raw = items.filter((item) => item.classification === "raw").length;
  const structured = items.filter(
    (item) => item.classification === "structured",
  ).length;

  return {
    items,
    counts: {
      raw,
      structured,
      total: items.length,
    },
  };
}
