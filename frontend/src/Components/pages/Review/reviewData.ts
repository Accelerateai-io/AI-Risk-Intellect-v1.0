export const REVIEW_WHY_LABELS = [
  "Language",
  "Duplicate",
  "Catalog",
  "Quality",
  "Domain",
  "Evidence",
  "Review",
] as const;

export type ReviewWhyLabel = (typeof REVIEW_WHY_LABELS)[number];

export type ReviewQueueItem = {
  id: string;
  displayId: string;
  title: string;
  domain: string;
  primaryRisk: string;
  secondaryRisk: string;
  qualityScore: number | null;
  scoreLabel: string;
  priority: "Low" | "Medium" | "High";
  category: string;
  reviewWhy: string;
  reviewReason: string;
  articleUrl: string;
  ingestedAt: string;
};

export type DomainSelection =
  | { mode: "taxonomy"; value: string }
  | { mode: "custom"; value: string };

export const CUSTOM_DOMAIN_OPTION = "__custom__";

export function resolveSelectedDomain(selection: DomainSelection | undefined): string {
  if (!selection) return "";
  return selection.value.trim();
}

export function normalizeReviewQueueFromApi(raw: unknown): {
  items: ReviewQueueItem[];
  total: number;
} {
  const data = raw as { items?: ReviewQueueItem[]; total?: number };
  const items = (data.items ?? []).map((item) => ({
    id: item.id ?? "",
    displayId: item.displayId?.trim() || "R-?",
    title: item.title ?? "Untitled risk",
    domain: item.domain ?? "—",
    primaryRisk: item.primaryRisk ?? "—",
    secondaryRisk: item.secondaryRisk ?? "—",
    qualityScore:
      typeof item.qualityScore === "number" ? item.qualityScore : null,
    scoreLabel: item.scoreLabel ?? "—/100",
    priority: item.priority ?? "Medium",
    category: item.category ?? "—",
    reviewWhy: item.reviewWhy ?? "Review",
    reviewReason:
      item.reviewReason ??
      "Extracted domain does not match any of the 7 risk taxonomy domains.",
    articleUrl: item.articleUrl ?? "",
    ingestedAt: item.ingestedAt ?? "",
  }));
  return {
    items,
    total: data.total ?? items.length,
  };
}
