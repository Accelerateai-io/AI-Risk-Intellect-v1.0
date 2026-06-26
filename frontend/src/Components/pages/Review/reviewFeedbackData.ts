import { formatDisplayDate } from "../../../utils/formatDate";

export type ReviewFeedbackClassification = "raw" | "structured";

export type ReviewFeedbackSample = {
  id: string;
  displayId: string;
  title: string;
  domain: string;
  primaryRisk: string;
  classification: ReviewFeedbackClassification;
  feedback: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewedAtDisplay: string;
  articleUrl: string;
  reviewStatus: "rejected" | "approved" | "classified" | null;
  canMoveToRisks: boolean;
};

export type ReviewFeedbackCounts = {
  raw: number;
  structured: number;
  total: number;
};

/** Review saved but not yet moved — eligible for promotion to Risks. */
export function canPromoteFeedbackToRisks(
  item: Pick<ReviewFeedbackSample, "reviewStatus">,
): boolean {
  return item.reviewStatus === "classified" || item.reviewStatus === "rejected";
}

export function isFeedbackOnRisks(
  item: Pick<ReviewFeedbackSample, "reviewStatus">,
): boolean {
  return item.reviewStatus === "approved";
}

/** @deprecated Use canPromoteFeedbackToRisks */
export function canPromoteStructuredFeedbackToRisks(
  item: Pick<ReviewFeedbackSample, "classification" | "reviewStatus">,
): boolean {
  return canPromoteFeedbackToRisks(item);
}

export function normalizeReviewFeedbackFromApi(payload: unknown): {
  items: ReviewFeedbackSample[];
  counts: ReviewFeedbackCounts;
} {
  const data = payload as {
    items?: Array<Partial<ReviewFeedbackSample>>;
    counts?: Partial<ReviewFeedbackCounts>;
  };

  const items = (data.items ?? [])
    .map((item) => {
      const classification = item.classification;
      if (classification !== "raw" && classification !== "structured") {
        return null;
      }

      const reviewedAt = item.reviewedAt ?? null;
      const reviewStatus = item.reviewStatus ?? null;
      const sample: ReviewFeedbackSample = {
        id: item.id ?? "",
        displayId: item.displayId?.trim() || "R-?",
        title: item.title ?? "Untitled risk",
        domain: item.domain ?? "—",
        primaryRisk: item.primaryRisk ?? "—",
        classification,
        feedback: item.feedback ?? null,
        reviewedBy: item.reviewedBy ?? null,
        reviewedAt,
        reviewedAtDisplay: reviewedAt ? formatDisplayDate(reviewedAt) : "—",
        articleUrl: item.articleUrl ?? "",
        reviewStatus,
        canMoveToRisks:
          item.canMoveToRisks === true ||
          reviewStatus === "classified" ||
          reviewStatus === "rejected",
      };

      return sample;
    })
    .filter((item): item is ReviewFeedbackSample => item != null);

  const rawCount =
    data.counts?.raw ?? items.filter((i) => i.classification === "raw").length;
  const structuredCount =
    data.counts?.structured ??
    items.filter((i) => i.classification === "structured").length;

  return {
    items,
    counts: {
      raw: rawCount,
      structured: structuredCount,
      total: data.counts?.total ?? items.length,
    },
  };
}

export function filterReviewFeedbackSamples(
  items: ReviewFeedbackSample[],
  classification: ReviewFeedbackClassification,
  searchQuery: string,
): ReviewFeedbackSample[] {
  const q = searchQuery.trim().toLowerCase();
  return items.filter((item) => {
    if (item.classification !== classification) return false;
    if (!q) return true;

    return [
      item.displayId,
      item.title,
      item.domain,
      item.primaryRisk,
      item.feedback,
      item.reviewedBy,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(q));
  });
}
