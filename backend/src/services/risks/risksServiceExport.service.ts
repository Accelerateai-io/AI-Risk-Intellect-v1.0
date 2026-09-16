import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { risks } from "../../schema/risks/risks.js";
import { articles } from "../../schema/articles/articles.js";
import type { CatalogRiskMatch } from "./riskCatalogMatch.service.js";

/**
 * Machine-to-machine JSON export consumed by AI-Q's `riskIntellectClient`.
 * Contract is frozen by the AI-Q client; this module adapts RI data to it.
 * This is a read-only projection: it never mutates extraction, scoring,
 * matching, quality, or review state.
 */

/** Bumped only on a breaking change to the response envelope / item shape. */
export const RISK_EXPORT_SCHEMA_VERSION = "1.0";
/** Default quality floor when the caller does not pass a valid `minQuality`. */
export const DEFAULT_MIN_QUALITY = 70;
/** Hard cap so an unbounded `limit` cannot pull the whole table. */
export const MAX_LIMIT = 100;
export const DEFAULT_LIMIT = 25;
/** Only reviewed-approved risks are service-exportable. */
export const EXPORTABLE_REVIEW_STATUS = "approved";

/** One risk record in the AI-Q export contract. */
export type RiskExportItem = {
  id: string;
  riskTitle: string;
  domain: string | null;
  qualityScore: number | null;
  description: string | null;
  attackVector: string | null;
  primaryRisk: string | null;
  sector: string | null;
  industry: string | null;
  sourceUrl: string | null;
  articleTitle: string | null;
  /**
   * RI has no article *publication* date. Always null so downstream never
   * mistakes ingest time for publish time. `ingestedAt` carries ingest time.
   */
  articleDate: string | null;
  ingestedAt: string | null;
  catalogMatchId: string | null;
  catalogMatchTitle: string | null;
};

export type RiskExportResult = {
  schemaVersion: string;
  generatedAt: string;
  risks: RiskExportItem[];
  total: number;
  limit: number;
  minQuality: number;
  domains: string[] | null;
  nextCursor: string | null;
};

export type RiskExportQuery = {
  limit?: number;
  cursor?: string;
  sector?: string;
  domains?: string[];
  minQuality?: number;
};

/** Row shape selected from the risks⋈articles join. */
type RiskExportRow = {
  id: string;
  riskTitle: string;
  domains: string | null;
  primaryRisk: string | null;
  sector: string | null;
  industry: string | null;
  qualityScore: number | null;
  extractionJson: unknown;
  articleUrl: string | null;
  articleTitle: string | null;
  articleCreatedAt: Date | null;
};

function nullableStr(value: unknown): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

function toIso(value: Date | null): string | null {
  return value instanceof Date && !Number.isNaN(value.getTime())
    ? value.toISOString()
    : null;
}

/**
 * Highest-accuracy catalog match from `extraction_json.catalog_matches`.
 * Matches are stored sorted by accuracy at extraction time; we re-sort
 * defensively so ordering never depends on write-time invariants.
 */
export function deriveTopCatalogMatch(extractionJson: unknown): {
  id: string | null;
  title: string | null;
} {
  const ext = (extractionJson ?? {}) as { catalog_matches?: unknown };
  const raw = Array.isArray(ext.catalog_matches) ? ext.catalog_matches : [];
  const matches = raw
    .filter(
      (m): m is Partial<CatalogRiskMatch> =>
        !!m && typeof m === "object" && !Array.isArray(m),
    )
    .sort(
      (a, b) => Number(b.accuracyPercent ?? 0) - Number(a.accuracyPercent ?? 0),
    );
  const top = matches[0];
  if (!top) return { id: null, title: null };
  return { id: nullableStr(top.riskId), title: nullableStr(top.title) };
}

/**
 * Project a joined RI row into the AI-Q contract item. Pure and null-safe.
 * Only whitelisted, service-safe fields are emitted — `extraction_json` is
 * never forwarded wholesale (no prompts, review notes, debug, or internals).
 */
export function toRiskExportItem(row: RiskExportRow): RiskExportItem {
  const ext = (row.extractionJson ?? {}) as { risk?: Record<string, unknown> };
  const riskObj = (ext.risk ?? {}) as Record<string, unknown>;
  const match = deriveTopCatalogMatch(row.extractionJson);
  return {
    id: row.id,
    riskTitle: row.riskTitle,
    domain: nullableStr(row.domains),
    qualityScore: typeof row.qualityScore === "number" ? row.qualityScore : null,
    description: nullableStr(riskObj.description),
    attackVector: nullableStr(riskObj.attack_vector),
    primaryRisk: nullableStr(row.primaryRisk),
    sector: nullableStr(row.sector),
    industry: nullableStr(row.industry),
    sourceUrl: nullableStr(row.articleUrl),
    articleTitle: nullableStr(row.articleTitle),
    articleDate: null,
    ingestedAt: toIso(row.articleCreatedAt),
    catalogMatchId: match.id,
    catalogMatchTitle: match.title,
  };
}

function clampInt(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** Opaque offset cursor (stable under the fixed ORDER BY). */
function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const decoded = Number.parseInt(
    Buffer.from(cursor, "base64").toString("utf8"),
    10,
  );
  return Number.isFinite(decoded) && decoded > 0 ? decoded : 0;
}

function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), "utf8").toString("base64");
}

/**
 * Query approved, quality-gated risks for the service export.
 * Deterministic ordering: quality desc, then ingest desc, then id asc.
 */
export async function queryRiskExport(
  query: RiskExportQuery,
): Promise<RiskExportResult> {
  const minQuality = clampInt(query.minQuality, 0, 100, DEFAULT_MIN_QUALITY);
  const limit = clampInt(query.limit, 1, MAX_LIMIT, DEFAULT_LIMIT);
  const offset = decodeCursor(query.cursor);
  const domains =
    query.domains && query.domains.length > 0 ? query.domains : null;

  const conditions = [
    sql`(${risks.extractionJson} ->> 'review_status') = ${EXPORTABLE_REVIEW_STATUS}`,
    gte(risks.qualityScore, minQuality),
  ];
  if (query.sector) conditions.push(eq(risks.sector, query.sector));
  if (domains) conditions.push(inArray(risks.domains, domains));
  const where = and(...conditions);

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(risks)
    .where(where);

  const rows = await db
    .select({
      id: risks.id,
      riskTitle: risks.riskTitle,
      domains: risks.domains,
      primaryRisk: risks.primaryRisk,
      sector: risks.sector,
      industry: risks.industry,
      qualityScore: risks.qualityScore,
      extractionJson: risks.extractionJson,
      articleUrl: articles.url,
      articleTitle: articles.title,
      articleCreatedAt: articles.createdAt,
    })
    .from(risks)
    .leftJoin(articles, eq(risks.articleId, articles.id))
    .where(where)
    .orderBy(desc(risks.qualityScore), desc(risks.createdAt), asc(risks.id))
    .limit(limit)
    .offset(offset);

  const total = Number(count) || 0;
  const nextOffset = offset + rows.length;

  return {
    schemaVersion: RISK_EXPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    risks: rows.map((row) => toRiskExportItem(row as RiskExportRow)),
    total,
    limit,
    minQuality,
    domains,
    nextCursor: nextOffset < total ? encodeCursor(nextOffset) : null,
  };
}
