import { and, desc, eq, isNull, sql } from "drizzle-orm";
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
import { fetchGlobalRiskDisplayIdMap } from "./riskSequence.js";

export type RiskListMetrics = {
  total: number;
  technical: number;
  operational: number;
  business: number;
};

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

function countByPrimaryKey(rows: RiskDto[]): Pick<
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

export async function listRisks(): Promise<{
  risks: RiskDto[];
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
    })
    .from(risks)
    .innerJoin(articles, eq(risks.articleId, articles.id))
    .orderBy(desc(risks.createdAt));

  const visibleRows = rows.filter((row) =>
    isRiskVisibleInMainList({
      domains: row.domains,
      qualityScore: row.qualityScore,
      extractionJson: row.extractionJson,
    }),
  );

  const displayIdByRiskId = await fetchGlobalRiskDisplayIdMap();
  const mapped = visibleRows.map((row) =>
    mapRiskRowToDto(row, displayIdByRiskId.get(row.id) ?? "R-?"),
  );
  const counts = countByPrimaryKey(mapped);

  return {
    risks: mapped,
    metrics: {
      total: mapped.length,
      ...counts,
    },
  };
}

export async function getRiskById(riskId: string): Promise<RiskDto> {
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

  if (!stored) {
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
  /** Optional page size. Omitted => every matching row (legacy behaviour). */
  limit?: number;
  /** Rows to skip. Only meaningful alongside `limit`. */
  offset?: number;
};

/**
 * SQL mirror of the cheap, exactly-expressible parts of isRiskInReviewQueue().
 *
 * Only the two predicates that are a byte-for-byte match of the TypeScript are
 * pushed down: the closed-review-status early return, and the ownership filter.
 * The quality/taxonomy half of the predicate stays in TS because
 * resolveQualityScore100() and normalizeToCatalogDomain() are fuzzy and cannot
 * be reproduced in SQL without risking silent drops from the queue.
 */
function reviewQueueWhere(filter: ReviewQueueFilter) {
  const conditions = [
    sql`lower(coalesce(trim(${risks.extractionJson} ->> 'review_status'), '')) not in ('approved', 'rejected', 'classified')`,
  ];

  if (filter.assignedTo === "unassigned") {
    conditions.push(isNull(risks.assignedTo));
  } else if (typeof filter.assignedTo === "string" && filter.assignedTo) {
    conditions.push(eq(risks.assignedTo, filter.assignedTo));
  }

  return and(...conditions);
}

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
    .where(reviewQueueWhere(filter))
    .orderBy(desc(risks.createdAt));

  // Ownership and closed-status filtering already happened in SQL above.
  const reviewRows = rows.filter((row) =>
    isRiskInReviewQueue({
      domains: row.domains,
      qualityScore: row.qualityScore,
      extractionJson: row.extractionJson,
    }),
  );

  const matchedTotal = reviewRows.length;
  const offset = Math.max(0, filter.offset ?? 0);
  const pageRows =
    typeof filter.limit === "number" && filter.limit > 0
      ? reviewRows.slice(offset, offset + filter.limit)
      : reviewRows;

  const displayIdByRiskId = await fetchGlobalRiskDisplayIdMap();
  const mapped = pageRows.map((row) => ({
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
    // `total` stays the full matched count so the queue badge is unaffected by paging.
    metrics: {
      total: matchedTotal,
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
    .from(risks)
    .where(reviewQueueWhere({}));

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