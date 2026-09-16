import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { riskEmbeddings } from "../../schema/risks/riskEmbeddings.js";
import { risks } from "../../schema/risks/risks.js";
import { cosineSimilarity } from "../aws/bedrockEmbeddings.service.js";

/** Cosine similarity at/above which two risks are flagged as duplicates. */
export function getDedupThreshold(): number {
  const raw = Number(process.env.RISK_DEDUP_THRESHOLD);
  if (Number.isFinite(raw) && raw > 0 && raw <= 1) return raw;
  return 0.92;
}

export type DuplicateRiskHit = {
  riskId: string;
  articleId: number;
  similarity: number;
};

export type DedupCandidateRow = {
  riskId: string;
  articleId: number;
  domains: string | null;
  embedding: number[];
};

/**
 * Pure comparison over candidate rows; exported for tests. Domain filter is
 * soft: when the new risk has a domain, only same-domain rows are compared.
 */
export function findDuplicateAmongRows(input: {
  embedding: number[];
  domain: string | null;
  excludeArticleId?: number;
  rows: DedupCandidateRow[];
  threshold?: number;
}): DuplicateRiskHit | null {
  const threshold = input.threshold ?? getDedupThreshold();
  const domainNorm = (input.domain ?? "").trim().toLowerCase();

  let best: DuplicateRiskHit | null = null;
  for (const row of input.rows) {
    if (input.excludeArticleId != null && row.articleId === input.excludeArticleId) {
      continue;
    }
    if (domainNorm && (row.domains ?? "").trim().toLowerCase() !== domainNorm) {
      continue;
    }
    const similarity = cosineSimilarity(input.embedding, row.embedding);
    if (similarity >= threshold && (!best || similarity > best.similarity)) {
      best = { riskId: row.riskId, articleId: row.articleId, similarity };
    }
  }
  return best;
}

/**
 * Find an existing risk that duplicates the given embedding. Used at
 * extraction time to flag (never block) near-identical risks extracted from
 * different articles. ~2k rows with 256-dim vectors compare in milliseconds.
 */
export async function findDuplicateRisk(input: {
  embedding: number[];
  domain: string | null;
  excludeArticleId?: number;
}): Promise<DuplicateRiskHit | null> {
  const rows = await db
    .select({
      riskId: riskEmbeddings.riskId,
      articleId: risks.articleId,
      domains: risks.domains,
      embedding: riskEmbeddings.embedding,
    })
    .from(riskEmbeddings)
    .innerJoin(risks, eq(riskEmbeddings.riskId, risks.id));

  const params: Parameters<typeof findDuplicateAmongRows>[0] = {
    embedding: input.embedding,
    domain: input.domain,
    rows,
  };
  if (input.excludeArticleId != null) {
    params.excludeArticleId = input.excludeArticleId;
  }
  return findDuplicateAmongRows(params);
}
