import { primaryKeyFromLabel, tagKeyFromDomain } from "./riskDto.js";
import { resolveQualityScore100 } from "./riskQuality.js";

/**
 * Pure helpers for the paginated Risks list (B-7).
 *
 * The visibility predicate (`isRiskVisibleInMainList`) and taxonomy
 * normalisation are fuzzy and cannot be expressed in SQL (see the note in
 * risks.service.ts). So the Risks service pages the candidate rows in bounded
 * SQL batches (SQL LIMIT/OFFSET, never the whole table in memory) and uses the
 * pure functions here to filter, rank and slice each batch. Keeping that logic
 * here makes it unit-testable without a database.
 */

export type RiskListOrder = "newest" | "oldest" | "score" | "severity";

const ORDER_VALUES: readonly RiskListOrder[] = [
  "newest",
  "oldest",
  "score",
  "severity",
];

export const RISK_LIST_MAX_LIMIT = 200;
export const RISK_LIST_DEFAULT_LIMIT = 50;

export type RiskListParams = {
  /** Page size, 0..200. 0 means "metrics/total only, no rows". */
  limit: number;
  /** Rows to skip. */
  offset: number;
  order: RiskListOrder;
  /** When true, compute the full visible total + category metrics. */
  includeMetrics: boolean;
  /** "technical" | "operational" | "business", or null for all. */
  primaryKey: string | null;
  /** "bias" | "privacy" | "safety" | "misinformation", or null for all. */
  tag: string | null;
  /** Case-insensitive free-text filter, or null. */
  search: string | null;
};

/** Columns needed to evaluate the list filters for one risk row. */
export type RiskFilterRow = {
  id: string;
  createdAt: Date;
  domains: string | null;
  primaryRisk: string | null;
  secondaryRisk: string | null;
  sector: string | null;
  industry: string | null;
  riskTitle: string | null;
  articleTitle: string | null;
  aiProductName: string | null;
  aiProductVendor: string | null;
  qualityScore: number | null;
  severityScore: number | null;
  extractionJson: unknown;
};

/** Lightweight record retained during a scan — never holds the extraction blob. */
export type RiskLightRecord = {
  id: string;
  createdAt: Date;
  severityScore: number | null;
  quality100: number | null;
  primaryKey: string;
};

export type RiskListMetrics = {
  total: number;
  technical: number;
  operational: number;
  business: number;
};

export type RiskPageResult = {
  pageRecords: RiskLightRecord[];
  total: number;
  hasMore: boolean;
  metrics: RiskListMetrics;
};

function toInt(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cleanFilter(value: unknown): string | null {
  const v = String(value ?? "").trim().toLowerCase();
  if (!v || v === "all") return null;
  return v;
}

/** True when a query param is present and non-empty. */
function hasParam(raw: Record<string, unknown>, key: string): boolean {
  const v = raw[key];
  return v !== undefined && v !== null && String(v).trim() !== "";
}

/**
 * AI-Q compatibility (B-7): external API-key integrations call GET /risks with
 * no `offset`/`page` and expect the FULL visible list (they page/filter client
 * side). Only those callers get the legacy full list; the UI (JWT) and anyone
 * who sends `offset`/`page` get a paginated response.
 */
export function isFullListRequest(
  raw: Record<string, unknown>,
  isApiKey: boolean,
): boolean {
  if (!isApiKey) return false;
  return !hasParam(raw, "offset") && !hasParam(raw, "page");
}

/** Parse raw query params into a normalised, clamped RiskListParams. */
export function normalizeRiskListParams(
  raw: Record<string, unknown>,
): RiskListParams {
  const limitRaw = toInt(raw.limit, RISK_LIST_DEFAULT_LIMIT);
  const limit = Math.min(Math.max(limitRaw, 0), RISK_LIST_MAX_LIMIT);
  // Accept either explicit `offset` or a `page` index (page * pageSize).
  let offset = Math.max(toInt(raw.offset, 0), 0);
  if (!hasParam(raw, "offset") && hasParam(raw, "page")) {
    const page = Math.max(toInt(raw.page, 0), 0);
    offset = page * (limit > 0 ? limit : RISK_LIST_DEFAULT_LIMIT);
  }

  const orderRaw = String(raw.order ?? "").trim().toLowerCase();
  const order = (ORDER_VALUES as readonly string[]).includes(orderRaw)
    ? (orderRaw as RiskListOrder)
    : "newest";

  // Default to including metrics unless the caller explicitly opts out ("0"/"false").
  const metricsRaw = String(raw.includeMetrics ?? "").trim().toLowerCase();
  const includeMetrics = !(metricsRaw === "0" || metricsRaw === "false");

  const searchRaw = String(raw.search ?? "").trim();

  return {
    limit,
    offset,
    order,
    includeMetrics,
    primaryKey: cleanFilter(raw.primaryKey),
    tag: cleanFilter(raw.tag),
    search: searchRaw ? searchRaw : null,
  };
}

function riskDomain(row: RiskFilterRow): string {
  const ext = (row.extractionJson ?? {}) as { risk?: { domains?: unknown } };
  return String(row.domains ?? ext.risk?.domains ?? "").trim();
}

function riskPrimaryLabel(row: RiskFilterRow): string {
  const ext = (row.extractionJson ?? {}) as { risk?: { primary_risk?: unknown } };
  return String(row.primaryRisk ?? ext.risk?.primary_risk ?? "").trim();
}

/** The free-text haystack for one row (columns the search box advertises). */
function searchHaystack(row: RiskFilterRow): string {
  return [
    row.riskTitle,
    riskDomain(row),
    riskPrimaryLabel(row),
    row.secondaryRisk,
    row.sector,
    row.industry,
    row.articleTitle,
    row.aiProductName,
    row.aiProductVendor,
  ]
    .map((v) => String(v ?? ""))
    .join(" ")
    .toLowerCase();
}

/**
 * True when a (already-visible) row passes the primaryKey / tag / search
 * filters. Visibility is checked separately by isRiskVisibleInMainList.
 */
export function riskRowMatchesFilters(
  row: RiskFilterRow,
  params: Pick<RiskListParams, "primaryKey" | "tag" | "search">,
): boolean {
  if (params.primaryKey) {
    if (primaryKeyFromLabel(riskPrimaryLabel(row)) !== params.primaryKey) {
      return false;
    }
  }
  if (params.tag) {
    if (tagKeyFromDomain(riskDomain(row)) !== params.tag) return false;
  }
  if (params.search) {
    if (!searchHaystack(row).includes(params.search.toLowerCase())) return false;
  }
  return true;
}

/** Distil a filtered, visible row into the lightweight record kept in memory. */
export function toLightRecord(row: RiskFilterRow): RiskLightRecord {
  return {
    id: row.id,
    createdAt: row.createdAt,
    severityScore: row.severityScore,
    quality100: resolveQualityScore100({
      qualityScore: row.qualityScore,
      extractionJson: row.extractionJson,
    }),
    primaryKey: primaryKeyFromLabel(riskPrimaryLabel(row)),
  };
}

function time(d: Date): number {
  return d instanceof Date ? d.getTime() : new Date(d).getTime();
}

/** nulls sort last for descending numeric orders. */
function descNullsLast(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return b - a;
}

/** Sort light records into their final display order (stable tie-breaks). */
export function sortRiskRecords(
  records: RiskLightRecord[],
  order: RiskListOrder,
): RiskLightRecord[] {
  const sorted = [...records];
  sorted.sort((a, b) => {
    let primary = 0;
    switch (order) {
      case "oldest":
        primary = time(a.createdAt) - time(b.createdAt);
        break;
      case "score":
        primary = descNullsLast(a.quality100, b.quality100);
        break;
      case "severity":
        primary = descNullsLast(a.severityScore, b.severityScore);
        break;
      case "newest":
      default:
        primary = time(b.createdAt) - time(a.createdAt);
        break;
    }
    if (primary !== 0) return primary;
    // Stable tie-break: newest first, then id.
    const byTime = time(b.createdAt) - time(a.createdAt);
    if (byTime !== 0) return byTime;
    return a.id.localeCompare(b.id);
  });
  return sorted;
}

function countMetrics(records: RiskLightRecord[]): RiskListMetrics {
  let technical = 0;
  let operational = 0;
  let business = 0;
  for (const r of records) {
    if (r.primaryKey === "operational") operational += 1;
    else if (r.primaryKey === "business") business += 1;
    else technical += 1;
  }
  return { total: records.length, technical, operational, business };
}

/**
 * Sort + slice the full set of visible, filtered light records into one page,
 * with exact total, metrics and hasMore. Used on the metrics/score/severity
 * path where the whole candidate set is scanned.
 */
export function finalizeRiskPage(
  records: RiskLightRecord[],
  params: Pick<RiskListParams, "limit" | "offset" | "order">,
): RiskPageResult {
  const sorted = sortRiskRecords(records, params.order);
  const metrics = countMetrics(sorted);
  const pageRecords =
    params.limit > 0
      ? sorted.slice(params.offset, params.offset + params.limit)
      : [];
  const hasMore =
    params.limit > 0 && params.offset + params.limit < sorted.length;
  return { pageRecords, total: sorted.length, hasMore, metrics };
}
