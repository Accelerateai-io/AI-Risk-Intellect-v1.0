import type { RiskDetail } from "./riskData";

export function riskMatchesFilters(
  row: RiskDetail,
  primaryRisk: string,
  tag: string,
  search: string,
): boolean {
  if (primaryRisk !== "all" && row.primaryKey !== primaryRisk) {
    return false;
  }
  if (tag !== "all" && row.tagKey !== tag) {
    return false;
  }
  const q = search.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    row.id,
    row.displayId ?? "",
    row.articleId ?? "",
    row.title,
    row.domain,
    row.primaryRisk,
    row.secondaryRisk,
    row.sector,
    row.industry,
    row.intent,
    row.qualityScore,
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

export function sortRiskRows(
  rows: RiskDetail[],
  order: string,
): RiskDetail[] {
  const copy = [...rows];
  const createdAtMs = (row: RiskDetail) => {
    const t = new Date(row.createdAt ?? row.ingestedAt).getTime();
    return Number.isNaN(t) ? 0 : t;
  };
  if (order === "oldest") {
    copy.sort((a, b) => createdAtMs(a) - createdAtMs(b));
  } else if (order === "score") {
    copy.sort(
      (a, b) =>
        Number.parseFloat(b.qualityScore) -
        Number.parseFloat(a.qualityScore),
    );
  } else {
    copy.sort((a, b) => createdAtMs(b) - createdAtMs(a));
  }
  return copy;
}
