import { and, asc, desc, eq, gte, ilike, inArray, isNull, notIlike, or, sql, type SQL } from "drizzle-orm";
import { db } from "../../db/index.js";
import { articles } from "../../schema/articles/articles.js";
import { risks } from "../../schema/risks/risks.js";
import { users } from "../../schema/users/users.js";
import { HttpError } from "../../utils/httpError.js";
import {
  extractMatchSignalsFromExtraction,
  findCatalogRiskMatches,
  isDomainInTaxonomy,
  listTaxonomyDomains,
  mergeCatalogMatchesIntoExtraction,
  parseCatalogMatchesFromExtraction,
} from "./riskCatalogMatch.service.js";
import { embedText } from "../aws/bedrockEmbeddings.service.js";
import { buildRiskEmbeddingText } from "./riskEmbedding.service.js";
import {
  mapRiskRowToDto,
  type RiskDto,
} from "./riskDto.js";
import { needsHumanReview } from "./riskQuality.js";
import { resolveRiskUuid } from "./riskResolve.js";
import { fetchGlobalRiskDisplayIdMap, fetchRiskDisplayIdsFor } from "./riskSequence.js";

export type RiskListMetrics = {
  total: number;
  technical: number;
  operational: number;
  business: number;
};

/**
 * Server-side filters for GET /api/v1/risks.
 *
 * Every field is optional; omitting all of them reproduces the previous
 * "whole approved set" response, so existing callers are unaffected.
 */
export type RiskListFilters = {
  /** Matched case-insensitively against risks.sector. */
  sector?: string;
  /** Canonical CATALOG_DOMAINS values. */
  domains?: string[];
  /** 0–1 unit scale, matching the API's qualityScore. */
  minQuality?: number;
  /** ISO-8601; returns rows whose updatedAt is at or after this instant. */
  updatedSince?: string;
  search?: string;
  primaryKey?: "all" | "technical" | "operational" | "business";
  tagKey?: string;
  order?: "newest" | "oldest" | "score" | "severity";
  limit?: number;
  offset?: number;
  /** When false, skip the full-table visibility scan used for metric cards. */
  includeMetrics?: boolean;
};

export type RiskListPage = {
  risks: RiskDto[];
  metrics: RiskListMetrics;
  /** Rows matching the filters, before limit/offset. */
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  /** False when this response skipped the metrics scan so the table can return first. */
  metricsIncluded: boolean;
  /** Echoes the filters actually applied, so a caller can detect an older build. */
  filters: {
    sector: string | null;
    domains: string[] | null;
    minQuality: number | null;
    updatedSince: string | null;
    search: string | null;
    primaryKey: string | null;
    tagKey: string | null;
    order: string | null;
  };
};

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;
const CANDIDATE_BATCH = 120;
const METRICS_TTL_MS = 15_000;
const EMPTY_RISK_METRICS: RiskListMetrics = {
  total: 0,
  technical: 0,
  operational: 0,
  business: 0,
};
const visibleRiskMetricsCache = new Map<
  string,
  { at: number; value: RiskListMetrics }
>();

function riskMetricsCacheKey(filters: RiskListFilters): string {
  return JSON.stringify({
    sector: filters.sector ?? "",
    domains: filters.domains ?? [],
    minQuality: filters.minQuality ?? null,
    updatedSince: filters.updatedSince ?? "",
    search: filters.search ?? "",
    primaryKey: filters.primaryKey ?? "",
    tagKey: filters.tagKey ?? "",
  });
}

async function getCachedVisibleRiskMetrics(
  where: SQL | undefined,
  filters: RiskListFilters,
): Promise<RiskListMetrics> {
  const key = riskMetricsCacheKey(filters);
  const hit = visibleRiskMetricsCache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < METRICS_TTL_MS) return hit.value;
  const value = await computeVisibleRiskMetrics(where);
  visibleRiskMetricsCache.set(key, { at: now, value });
  if (visibleRiskMetricsCache.size > 32) {
    const first = visibleRiskMetricsCache.keys().next().value;
    if (first !== undefined) visibleRiskMetricsCache.delete(first);
  }
  return value;
}

/** DB column is 0–100; the API speaks 0–1. Accept either and compare on 0–100. */
function minQualityTo100(minQuality: number | undefined): number | null {
  if (minQuality == null || !Number.isFinite(minQuality) || minQuality <= 0) {
    return null;
  }
  return minQuality <= 1 ? minQuality * 100 : minQuality;
}

export function buildRiskListWhere(filters: RiskListFilters): SQL | undefined {
  const clauses: SQL[] = [];

  const sector = filters.sector?.trim();
  if (sector) clauses.push(ilike(risks.sector, sector));

  const domains = (filters.domains ?? [])
    .map((d) => d.trim())
    .filter((d) => d.length > 0);
  if (domains.length > 0) {
    // risks.domains holds one canonical domain, but older rows may still carry
    // the numbered LLM label ("2. Privacy & Security"), so match contains too.
    const combined = or(
      inArray(risks.domains, domains),
      ...domains.map((d) => ilike(risks.domains, `%${d}%`)),
    );
    if (combined) clauses.push(combined);
  }

  const min100 = minQualityTo100(filters.minQuality);
  // Rows with a null quality_score resolve their score from extraction_json, so
  // they are left to the JS visibility pass rather than excluded here.
  if (min100 != null) clauses.push(gte(risks.qualityScore, Math.round(min100)));

  const updatedSince = filters.updatedSince?.trim();
  if (updatedSince) {
    const since = new Date(updatedSince);
    if (!Number.isNaN(since.getTime())) clauses.push(gte(risks.updatedAt, since));
  }

  const search = filters.search?.trim();
  if (search) {
    const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
    const textMatch = or(
      ilike(risks.riskTitle, pattern),
      ilike(risks.domains, pattern),
      ilike(risks.primaryRisk, pattern),
      ilike(risks.secondaryRisk, pattern),
      ilike(risks.sector, pattern),
      ilike(risks.industry, pattern),
      ilike(risks.intent, pattern),
      sql`${risks.id}::text ilike ${pattern}`,
    );
    if (textMatch) clauses.push(textMatch);
  }

  const primaryKey = filters.primaryKey;
  if (primaryKey === "operational") {
    clauses.push(ilike(risks.primaryRisk, "%operational%"));
  } else if (primaryKey === "business") {
    clauses.push(ilike(risks.primaryRisk, "%business%"));
  } else if (primaryKey === "technical") {
    clauses.push(
      and(
        or(isNull(risks.primaryRisk), notIlike(risks.primaryRisk, "%operational%")),
        or(isNull(risks.primaryRisk), notIlike(risks.primaryRisk, "%business%")),
      )!,
    );
  }

  const tagKey = filters.tagKey?.trim().toLowerCase();
  if (tagKey && tagKey !== "all") {
    if (tagKey === "bias") {
      clauses.push(
        or(
          ilike(risks.domains, "%discrimination%"),
          ilike(risks.domains, "%toxicity%"),
        )!,
      );
    } else if (tagKey === "privacy") {
      clauses.push(
        or(
          ilike(risks.domains, "%privacy%"),
          ilike(risks.domains, "%security%"),
        )!,
      );
    } else if (tagKey === "safety") {
      clauses.push(
        or(ilike(risks.domains, "%safety%"), ilike(risks.domains, "%failure%"))!,
      );
    } else if (tagKey === "misinformation") {
      clauses.push(ilike(risks.domains, "%misinformation%"));
    }
  }

  if (clauses.length === 0) return undefined;
  return clauses.length === 1 ? clauses[0] : and(...clauses);
}

type RiskListRowInput = {
  domains: string | null;
  qualityScore: number | null;
  extractionJson: unknown;
};

function reviewStatusFromExtraction(extractionJson: unknown): string {
  const ext = (extractionJson ?? {}) as { review_status?: string };
  return String(ext.review_status ?? "").trim().toLowerCase();
}

/** True when a risk belongs on the main Risks list (high quality or reviewer-approved). */
export function isRiskVisibleInMainList(input: RiskListRowInput): boolean {
  const reviewStatus = reviewStatusFromExtraction(input.extractionJson);
  if (reviewStatus === "approved") return true;
  if (reviewStatus === "rejected") return false;

  if (
    needsHumanReview({
      qualityScore: input.qualityScore,
      extractionJson: input.extractionJson,
    })
  ) {
    return false;
  }

  const ext = (input.extractionJson ?? {}) as {
    risk?: Record<string, unknown>;
  };
  const extractedRisk = ext.risk ?? {};
  const domain = String(input.domains ?? extractedRisk.domains ?? "").trim();
  return isDomainInTaxonomy(domain);
}

/** True when a risk still needs human review (shown in Review Queue). */
export function isRiskInReviewQueue(input: RiskListRowInput): boolean {
  const reviewStatus = reviewStatusFromExtraction(input.extractionJson);
  if (
    reviewStatus === "approved" ||
    reviewStatus === "rejected" ||
    reviewStatus === "classified"
  ) {
    return false;
  }

  if (
    needsHumanReview({
      qualityScore: input.qualityScore,
      extractionJson: input.extractionJson,
    })
  ) {
    return true;
  }

  const ext = (input.extractionJson ?? {}) as {
    risk?: Record<string, unknown>;
  };
  const extractedRisk = ext.risk ?? {};
  const domain = String(input.domains ?? extractedRisk.domains ?? "").trim();
  return !isDomainInTaxonomy(domain);
}

/** True when a risk still needs human review action. */
export function isPendingHumanReview(input: RiskListRowInput): boolean {
  return isRiskInReviewQueue(input);
}

function countByPrimaryKey(rows: Array<{ primaryKey: string }>): Pick<
  RiskListMetrics,
  "technical" | "operational" | "business"
> {
  let technical = 0;
  let operational = 0;
  let business = 0;
  for (const row of rows) {
    switch (row.primaryKey) {
      case "operational":
        operational += 1;
        break;
      case "business":
        business += 1;
        break;
      default:
        technical += 1;
    }
  }
  return { technical, operational, business };
}

export async function listRisks(
  filters: RiskListFilters = {},
): Promise<RiskListPage> {
  const where = buildRiskListWhere(filters);
  const rawLimit = filters.limit;
  const limit =
    rawLimit === 0
      ? 0
      : Math.min(
          MAX_LIST_LIMIT,
          Math.max(1, Math.trunc(rawLimit ?? DEFAULT_LIST_LIMIT)),
        );
  const offset = Math.max(0, Math.trunc(filters.offset ?? 0));
  const orderBy = riskListOrderBy(filters.order);
  const wantMetrics = filters.includeMetrics !== false;

  let pageRows: Awaited<ReturnType<typeof collectVisibleRiskPage>> = [];
  let metrics = EMPTY_RISK_METRICS;

  if (limit > 0 && wantMetrics) {
    const [rows, nextMetrics] = await Promise.all([
      collectVisibleRiskPage({ where, orderBy, offset, limit }),
      getCachedVisibleRiskMetrics(where, filters),
    ]);
    pageRows = rows;
    metrics = nextMetrics;
  } else if (limit > 0) {
    pageRows = await collectVisibleRiskPage({ where, orderBy, offset, limit });
  } else if (wantMetrics) {
    metrics = await getCachedVisibleRiskMetrics(where, filters);
  }

  const displayIdByRiskId = await fetchRiskDisplayIdsFor(
    pageRows.map((row) => row.id),
  );
  const hasMore = limit > 0 && pageRows.length === limit;

  return {
    risks: pageRows.map((row) =>
      mapRiskRowToDto(row, displayIdByRiskId.get(row.id) ?? "R-?"),
    ),
    metrics,
    total: wantMetrics
      ? metrics.total
      : offset + pageRows.length + (hasMore ? 1 : 0),
    limit,
    offset,
    hasMore,
    metricsIncluded: wantMetrics,
    filters: {
      sector: filters.sector?.trim() || null,
      domains: filters.domains?.length ? filters.domains : null,
      minQuality: filters.minQuality ?? null,
      updatedSince: filters.updatedSince?.trim() || null,
      search: filters.search?.trim() || null,
      primaryKey: filters.primaryKey && filters.primaryKey !== "all"
        ? filters.primaryKey
        : null,
      tagKey: filters.tagKey && filters.tagKey !== "all" ? filters.tagKey : null,
      order: filters.order ?? "newest",
    },
  };
}

const RISK_LIST_COLUMNS = {
  id: risks.id,
  articleId: risks.articleId,
  riskTitle: risks.riskTitle,
  domains: risks.domains,
  primaryRisk: risks.primaryRisk,
  secondaryRisk: risks.secondaryRisk,
  sector: risks.sector,
  industry: risks.industry,
  intent: risks.intent,
  qualityScore: risks.qualityScore,
  likelihood: risks.likelihood,
  impact: risks.impact,
  severityScore: risks.severityScore,
  severityBand: risks.severityBand,
  aiProductName: risks.aiProductName,
  aiProductVendor: risks.aiProductVendor,
  extractionJson: risks.extractionJson,
  modelName: risks.modelName,
  sourceFlag: risks.sourceFlag,
  createdAt: risks.createdAt,
  articleTitle: articles.title,
  articleUrl: articles.url,
} as const;

type RiskListDbRow = {
  id: string;
  articleId: number;
  riskTitle: string;
  domains: string | null;
  primaryRisk: string | null;
  secondaryRisk: string | null;
  sector: string | null;
  industry: string | null;
  intent: string | null;
  qualityScore: number | null;
  likelihood: number | null;
  impact: number | null;
  severityScore: number | null;
  severityBand: string | null;
  aiProductName: string | null;
  aiProductVendor: string | null;
  extractionJson: unknown;
  modelName: string | null;
  sourceFlag: string | null;
  createdAt: Date;
  articleTitle: string | null;
  articleUrl: string;
};

function riskListOrderBy(order: RiskListFilters["order"]) {
  if (order === "oldest") {
    return [asc(risks.createdAt), asc(risks.id)] as const;
  }
  if (order === "score") {
    return [desc(risks.qualityScore), desc(risks.createdAt), desc(risks.id)] as const;
  }
  if (order === "severity") {
    return [desc(risks.severityScore), desc(risks.createdAt), desc(risks.id)] as const;
  }
  return [desc(risks.createdAt), desc(risks.id)] as const;
}

async function collectVisibleRiskPage(input: {
  where: SQL | undefined;
  orderBy: ReturnType<typeof riskListOrderBy>;
  offset: number;
  limit: number;
}): Promise<RiskListDbRow[]> {
  const collected: RiskListDbRow[] = [];
  let dbOffset = 0;
  let skippedVisible = 0;

  while (collected.length < input.limit) {
    const baseQuery = db
      .select(RISK_LIST_COLUMNS)
      .from(risks)
      .innerJoin(articles, eq(risks.articleId, articles.id))
      .orderBy(...input.orderBy)
      .limit(CANDIDATE_BATCH)
      .offset(dbOffset);
    const batch = (await (input.where
      ? baseQuery.where(input.where)
      : baseQuery)) as RiskListDbRow[];

    if (batch.length === 0) break;
    dbOffset += batch.length;

    for (const row of batch) {
      if (
        !isRiskVisibleInMainList({
          domains: row.domains,
          qualityScore: row.qualityScore,
          extractionJson: row.extractionJson,
        })
      ) {
        continue;
      }
      if (skippedVisible < input.offset) {
        skippedVisible += 1;
        continue;
      }
      collected.push(row);
      if (collected.length >= input.limit) break;
    }

    if (batch.length < CANDIDATE_BATCH) break;
  }

  return collected;
}

async function computeVisibleRiskMetrics(
  where: SQL | undefined,
): Promise<RiskListMetrics> {
  const baseQuery = db
    .select({
      primaryRisk: risks.primaryRisk,
      qualityScore: risks.qualityScore,
      domains: risks.domains,
      reviewStatus: sql<string | null>`${risks.extractionJson}->>'review_status'`,
      isNonEnglish: sql<string | null>`${risks.extractionJson}->>'is_non_english'`,
      sourceLanguage: sql<string | null>`${risks.extractionJson}->>'source_language'`,
      duplicateOf: sql<string | null>`${risks.extractionJson}->'dedup'->>'duplicate_of_risk_id'`,
      judgeVerdict: sql<string | null>`${risks.extractionJson}->'catalog_matches'->0->>'judgeVerdict'`,
      extDomain: sql<string | null>`${risks.extractionJson}->'risk'->>'domains'`,
      extQuality: sql<string | null>`${risks.extractionJson}->'risk'->>'quality_score'`,
      selfTotal: sql<string | null>`${risks.extractionJson}->'justification'->'self_assessment'->>'total_score'`,
    })
    .from(risks);
  const rows = await (where ? baseQuery.where(where) : baseQuery);

  const mapped: Array<{ primaryKey: string }> = [];
  for (const row of rows) {
    const extractionJson = slimExtractionForVisibility(row);
    if (
      !isRiskVisibleInMainList({
        domains: row.domains,
        qualityScore: row.qualityScore,
        extractionJson,
      })
    ) {
      continue;
    }
    mapped.push({
      primaryKey: primaryKeyFromPrimaryRisk(row.primaryRisk),
    });
  }

  return {
    total: mapped.length,
    ...countByPrimaryKey(mapped),
  };
}

function slimExtractionForVisibility(row: {
  reviewStatus: string | null;
  isNonEnglish: string | null;
  sourceLanguage: string | null;
  duplicateOf: string | null;
  judgeVerdict: string | null;
  extDomain: string | null;
  extQuality: string | null;
  selfTotal: string | null;
}): unknown {
  return {
    review_status: row.reviewStatus,
    is_non_english: row.isNonEnglish === "true" || row.isNonEnglish === "t",
    source_language: row.sourceLanguage,
    dedup: row.duplicateOf
      ? { duplicate_of_risk_id: row.duplicateOf }
      : undefined,
    catalog_matches: row.judgeVerdict
      ? [{ judgeVerdict: row.judgeVerdict }]
      : [],
    risk: {
      domains: row.extDomain,
      quality_score: row.extQuality != null ? Number(row.extQuality) : undefined,
    },
    justification: {
      self_assessment: {
        total_score: row.selfTotal != null ? Number(row.selfTotal) : undefined,
      },
    },
  };
}

function primaryKeyFromPrimaryRisk(primary: string | null): string {
  const l = (primary ?? "").toLowerCase();
  if (l.includes("operational")) return "operational";
  if (l.includes("business")) return "business";
  return "technical";
}

export async function getRiskById(
  riskId: string,
  options: { computeCatalogMatches?: boolean } = {},
): Promise<RiskDto> {
  const uuid = await resolveRiskUuid(riskId);
  if (!uuid) {
    throw HttpError.notFound("Risk not found.");
  }

  const [row] = await db
    .select({
      id: risks.id,
      articleId: risks.articleId,
      riskTitle: risks.riskTitle,
      domains: risks.domains,
      primaryRisk: risks.primaryRisk,
      secondaryRisk: risks.secondaryRisk,
      sector: risks.sector,
      industry: risks.industry,
      intent: risks.intent,
      qualityScore: risks.qualityScore,
      likelihood: risks.likelihood,
      impact: risks.impact,
      severityScore: risks.severityScore,
      severityBand: risks.severityBand,
      aiProductName: risks.aiProductName,
      aiProductVendor: risks.aiProductVendor,
      extractionJson: risks.extractionJson,
      modelName: risks.modelName,
      sourceFlag: risks.sourceFlag,
      createdAt: risks.createdAt,
      articleTitle: articles.title,
      articleUrl: articles.url,
    })
    .from(risks)
    .innerJoin(articles, eq(risks.articleId, articles.id))
    .where(eq(risks.id, uuid))
    .limit(1);

  if (!row) {
    throw HttpError.notFound("Risk not found.");
  }

  const displayId =
    (await fetchGlobalRiskDisplayIdMap()).get(row.id) ?? "R-?";

  let extractionJson = row.extractionJson;
  let stored = parseCatalogMatchesFromExtraction(extractionJson);

  if (!stored && options.computeCatalogMatches) {
    const ext = (extractionJson ?? {}) as { risk?: Record<string, unknown> };
    const extractedRisk = ext.risk ?? {};
    const description = String(
      extractedRisk.description ?? row.riskTitle ?? "",
    ).trim();

    const matchSignals = extractMatchSignalsFromExtraction(extractionJson);
    const riskEmbedding = await embedText(
      buildRiskEmbeddingText(row.riskTitle, description || row.riskTitle),
    );

    stored = await findCatalogRiskMatches({
      domain: row.domains ?? String(extractedRisk.domains ?? ""),
      title: row.riskTitle,
      description: description || row.riskTitle,
      primaryRisk: row.primaryRisk ?? undefined,
      secondaryRisk: row.secondaryRisk ?? undefined,
      keywordMatches: matchSignals.keywordMatches,
      evidenceExcerpts: matchSignals.evidenceExcerpts,
      riskEmbedding,
      evidenceStrengthScore: matchSignals.evidenceStrengthScore,
      limit: 5,
    });

    extractionJson = mergeCatalogMatchesIntoExtraction(
      (extractionJson ?? {}) as Record<string, unknown>,
      stored,
    );

    await db
      .update(risks)
      .set({ extractionJson, updatedAt: new Date() })
      .where(eq(risks.id, uuid));
  }

  return mapRiskRowToDto(
    { ...row, extractionJson },
    displayId,
  );
}

export type ReviewAssignmentInfo = {
  assignedTo: string | null;
  assignedAt: string | null;
  assignedBy: string | null;
  assigneeUsername: string | null;
  assigneeName: string | null;
};

export type ReviewQueueFilter = {
  /** A user id, or "unassigned" to show only unowned reviews. */
  assignedTo?: string | "unassigned";
};

export async function listReviewQueueRisks(
  filter: ReviewQueueFilter = {},
): Promise<{
  risks: (RiskDto & { assignment: ReviewAssignmentInfo })[];
  metrics: RiskListMetrics;
}> {
  const rows = await db
    .select({
      id: risks.id,
      articleId: risks.articleId,
      riskTitle: risks.riskTitle,
      domains: risks.domains,
      primaryRisk: risks.primaryRisk,
      secondaryRisk: risks.secondaryRisk,
      sector: risks.sector,
      industry: risks.industry,
      intent: risks.intent,
      qualityScore: risks.qualityScore,
      likelihood: risks.likelihood,
      impact: risks.impact,
      severityScore: risks.severityScore,
      severityBand: risks.severityBand,
      aiProductName: risks.aiProductName,
      aiProductVendor: risks.aiProductVendor,
      extractionJson: risks.extractionJson,
      modelName: risks.modelName,
      sourceFlag: risks.sourceFlag,
      createdAt: risks.createdAt,
      articleTitle: articles.title,
      articleUrl: articles.url,
      assignedTo: risks.assignedTo,
      assignedAt: risks.assignedAt,
      assignedBy: risks.assignedBy,
      assigneeUsername: users.username,
      assigneeFullName: users.fullName,
    })
    .from(risks)
    .innerJoin(articles, eq(risks.articleId, articles.id))
    .leftJoin(users, eq(risks.assignedTo, users.id))
    .orderBy(desc(risks.createdAt));

  let reviewRows = rows.filter((row) =>
    isRiskInReviewQueue({
      domains: row.domains,
      qualityScore: row.qualityScore,
      extractionJson: row.extractionJson,
    }),
  );

  // Ownership filter — the only queue-lifecycle-justified filter (every queue item is pending).
  if (filter.assignedTo === "unassigned") {
    reviewRows = reviewRows.filter((row) => row.assignedTo == null);
  } else if (typeof filter.assignedTo === "string" && filter.assignedTo) {
    reviewRows = reviewRows.filter((row) => row.assignedTo === filter.assignedTo);
  }

  const displayIdByRiskId = await fetchGlobalRiskDisplayIdMap();
  const mapped = reviewRows.map((row) => ({
    ...mapRiskRowToDto(row, displayIdByRiskId.get(row.id) ?? "R-?"),
    assignment: {
      assignedTo: row.assignedTo ?? null,
      assignedAt: row.assignedAt ? row.assignedAt.toISOString() : null,
      assignedBy: row.assignedBy ?? null,
      assigneeUsername: row.assigneeUsername ?? null,
      assigneeName:
        (row.assigneeFullName && row.assigneeFullName.trim()) ||
        row.assigneeUsername ||
        null,
    } satisfies ReviewAssignmentInfo,
  }));
  const counts = countByPrimaryKey(mapped);

  return {
    risks: mapped,
    metrics: {
      total: mapped.length,
      ...counts,
    },
  };
}

export async function countPendingReviewRisks(): Promise<{ pendingCount: number }> {
  const rows = await db
    .select({
      domains: risks.domains,
      qualityScore: risks.qualityScore,
      extractionJson: risks.extractionJson,
    })
    .from(risks);

  const pendingCount = rows.filter((row) =>
    isPendingHumanReview({
      domains: row.domains,
      qualityScore: row.qualityScore,
      extractionJson: row.extractionJson,
    }),
  ).length;

  return { pendingCount };
}

export function getTaxonomyDomains(): { domains: readonly string[] } {
  return { domains: listTaxonomyDomains() };
}
