import { db } from "../../db/index.js";
import { risks } from "../../schema/risks/risks.js";
import { inArray, sql } from "drizzle-orm";
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

/** R-n ids for a page of risks without loading the full id list into memory. */
export async function fetchRiskDisplayIdsFor(
  ids: string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();

  const [countRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(risks);
  const total = Number(countRow?.n ?? 0);

  const rows = await db
    .select({
      id: risks.id,
      seq: sql<number>`(
        SELECT count(*)::int
        FROM risks AS earlier
        WHERE earlier.created_at < ${risks.createdAt}
           OR (
             earlier.created_at = ${risks.createdAt}
             AND earlier.id <= ${risks.id}
           )
      )`,
    })
    .from(risks)
    .where(inArray(risks.id, ids));

  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(row.id, formatRiskDisplayId(Number(row.seq), total));
  }
  return map;
}
