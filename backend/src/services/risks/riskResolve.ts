import { asc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { risks } from "../../schema/risks/risks.js";
import { parseRiskDisplaySequence } from "./riskDisplayId.js";
import { sortRisksForDisplaySequence } from "./riskSequence.js";

/** Resolve UUID from display id (R-1) or raw UUID. */
export async function resolveRiskUuid(idOrDisplayId: string): Promise<string | null> {
  const trimmed = idOrDisplayId.trim();
  if (/^[0-9a-f-]{36}$/i.test(trimmed)) return trimmed;

  const sequence = parseRiskDisplaySequence(trimmed);
  if (sequence == null) return null;

  const orderRows = await db
    .select({ id: risks.id, createdAt: risks.createdAt })
    .from(risks)
    .orderBy(asc(risks.createdAt), asc(risks.id));

  if (sequence < 1 || sequence > orderRows.length) return null;
  return sortRisksForDisplaySequence(orderRows)[sequence - 1]!.id;
}
