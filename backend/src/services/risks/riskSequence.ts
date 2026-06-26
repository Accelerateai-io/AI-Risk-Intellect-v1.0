import { db } from "../../db/index.js";
import { risks } from "../../schema/risks/risks.js";
import { formatRiskDisplayId } from "./riskDisplayId.js";

export type RiskOrderRow = {
  id: string;
  createdAt: Date;
};

export function sortRisksForDisplaySequence(
  rows: RiskOrderRow[],
): RiskOrderRow[] {
  return [...rows].sort((a, b) => {
    const byTime = a.createdAt.getTime() - b.createdAt.getTime();
    if (byTime !== 0) return byTime;
    return a.id.localeCompare(b.id);
  });
}

export function buildRiskDisplayIdMap(
  rows: RiskOrderRow[],
): Map<string, string> {
  const sorted = sortRisksForDisplaySequence(rows);
  const total = sorted.length;
  const map = new Map<string, string>();
  sorted.forEach((row, index) => {
    map.set(row.id, formatRiskDisplayId(index + 1, total));
  });
  return map;
}

/** Stable R-n ids across Risks page, Review queue, and Feedback (by global ingest order). */
export async function fetchGlobalRiskDisplayIdMap(): Promise<
  Map<string, string>
> {
  const orderRows = await db
    .select({ id: risks.id, createdAt: risks.createdAt })
    .from(risks);
  return buildRiskDisplayIdMap(orderRows);
}
