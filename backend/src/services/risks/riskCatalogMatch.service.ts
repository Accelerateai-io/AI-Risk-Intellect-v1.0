import { eq } from "drizzle-orm";
import {
  listTaxonomyDomains,
  type TaxonomyDomain,
} from "../../config/aiqRiskTaxonomy.js";
import { taxonomyAlignmentScore } from "../../config/riskTaxonomyMap.js";
import { db } from "../../db/index.js";
import { riskMappings } from "../../schema/riskMappings/riskMappings.js";
import { riskMappingEmbeddings } from "../../schema/riskMappings/riskMappingEmbeddings.js";
import { cosineSimilarity } from "../aws/bedrockEmbeddings.service.js";
import {
  normalizeLabelToCatalogDomain,
  resolveCatalogDomain,
  scoreDomainsFromDefinitions,
  type DomainResolutionResult,
  type ResolveCatalogDomainInput,
} from "./riskDomainResolver.service.js";

export {
  listTaxonomyDomains,
  type TaxonomyDomain,
  resolveCatalogDomain,
  scoreDomainsFromDefinitions,
  type DomainResolutionResult,
  type ResolveCatalogDomainInput,
};

export type CatalogRiskMatch = {
  riskId: string;
  title: string;
  description: string;
  domain: string;
  /** Final blended relevance, 0–100 (judge-adjusted when the judge ran). */
  accuracyPercent: number;
  domainMatchPercent: number;
  descriptionMatchPercent: number;
  matchSummary: string;
  /** Pre-judge heuristic score; kept so judge adjustments stay auditable. */
  heuristicPercent?: number;
  embeddingMatchPercent?: number;
  evidenceMatchPercent?: number;
  taxonomyMatchPercent?: number;
  judgeVerdict?: "match" | "no_match";
  judgeReasoning?: string;
};

/** Persisted on `risks.extraction_json.catalog_matches` at extraction time. */
export type StoredCatalogMatch = CatalogRiskMatch;

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function optionalNum(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

function str(v: unknown, fallback = ""): string {
  if (v == null) return fallback;
  return String(v).trim();
}

function mapRawToCatalogMatch(item: Record<string, unknown>): CatalogRiskMatch | null {
  const riskId = str(item.riskId ?? item.risk_id);
  if (!riskId) return null;
  const match: CatalogRiskMatch = {
    riskId,
    title: str(item.title ?? item.risk_title, "Untitled catalog risk"),
    description: str(item.description) || "No description available.",
    domain: str(item.domain ?? item.domains, "—"),
    accuracyPercent: Math.round(num(item.accuracyPercent ?? item.accuracy_percent)),
    domainMatchPercent: Math.round(
      num(item.domainMatchPercent ?? item.domain_match_percent),
    ),
    descriptionMatchPercent: Math.round(
      num(item.descriptionMatchPercent ?? item.description_match_percent),
    ),
    matchSummary: str(item.matchSummary ?? item.match_summary),
  };

  const heuristic = optionalNum(item.heuristicPercent ?? item.heuristic_percent);
  if (heuristic != null) match.heuristicPercent = heuristic;
  const embedding = optionalNum(
    item.embeddingMatchPercent ?? item.embedding_match_percent,
  );
  if (embedding != null) match.embeddingMatchPercent = embedding;
  const evidence = optionalNum(
    item.evidenceMatchPercent ?? item.evidence_match_percent,
  );
  if (evidence != null) match.evidenceMatchPercent = evidence;
  const taxonomy = optionalNum(
    item.taxonomyMatchPercent ?? item.taxonomy_match_percent,
  );
  if (taxonomy != null) match.taxonomyMatchPercent = taxonomy;

  const verdict = str(item.judgeVerdict ?? item.judge_verdict);
  if (verdict === "match" || verdict === "no_match") {
    match.judgeVerdict = verdict;
  }
  const reasoning = str(item.judgeReasoning ?? item.judge_reasoning);
  if (reasoning) match.judgeReasoning = reasoning;

  return match;
}

/** Read catalog matches saved on the risk row (`extraction_json.catalog_matches`). */
export function parseCatalogMatchesFromExtraction(
  extractionJson: unknown,
): CatalogRiskMatch[] | null {
  const ext = (extractionJson ?? {}) as { catalog_matches?: unknown };
  if (!Array.isArray(ext.catalog_matches) || ext.catalog_matches.length === 0) {
    return null;
  }
  const matches = ext.catalog_matches
    .map((item) =>
      item && typeof item === "object"
        ? mapRawToCatalogMatch(item as Record<string, unknown>)
        : null,
    )
    .filter((m): m is CatalogRiskMatch => m != null);
  return matches.length > 0 ? matches : null;
}

export function mergeCatalogMatchesIntoExtraction(
  extractionJson: Record<string, unknown>,
  matches: CatalogRiskMatch[],
): Record<string, unknown> {
  return {
    ...extractionJson,
    catalog_matches: matches,
  };
}

/** True when the extracted domain maps to one of the 7 taxonomy domains. */
export function isDomainInTaxonomy(domain: string): boolean {
  return normalizeToCatalogDomain(domain) !== null;
}

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "are",
  "was",
  "were",
  "has",
  "have",
  "had",
  "not",
  "but",
  "can",
  "may",
  "into",
  "than",
  "when",
  "which",
  "their",
  "they",
  "them",
  "such",
  "also",
  "been",
  "being",
  "will",
  "would",
  "about",
  "through",
  "risk",
  "risks",
  "system",
  "systems",
]);

function fingerprint(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function tokenize(text: string): Set<string> {
  const tokens = text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
  return new Set(tokens.filter((t) => !STOP_WORDS.has(t)));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Overlap on longer / more specific tokens (e.g. hallucination, anthropomorphization). */
function significantTermOverlap(a: Set<string>, b: Set<string>): number {
  const significant = [...a].filter((t) => t.length >= 5);
  if (significant.length === 0) return 0;
  let hits = 0;
  for (const token of significant) {
    if (b.has(token)) hits += 1;
  }
  return hits / significant.length;
}

function textSimilarity(a: Set<string>, b: Set<string>): number {
  const j = jaccard(a, b);
  const sig = significantTermOverlap(a, b);
  return Math.max(j, j * 0.55 + sig * 0.45);
}

const KEYWORD_TOKEN_WEIGHT = 3;
const EXCERPT_TOKEN_WEIGHT = 2;
const BASE_TOKEN_WEIGHT = 1;

/**
 * Token weights for evidence-based matching: terms the extraction model
 * cited as its reasons (keyword matches, evidence excerpts) count more than
 * generic title/description prose. Highest weight wins per token.
 */
export function buildEvidenceTokenWeights(input: {
  title: string;
  description: string;
  keywordMatches?: string[];
  evidenceExcerpts?: string[];
}): Map<string, number> {
  const weights = new Map<string, number>();
  const add = (text: string, weight: number) => {
    for (const token of tokenize(text)) {
      const existing = weights.get(token) ?? 0;
      if (weight > existing) weights.set(token, weight);
    }
  };
  add(`${input.title} ${input.description}`, BASE_TOKEN_WEIGHT);
  for (const excerpt of input.evidenceExcerpts ?? []) {
    add(excerpt, EXCERPT_TOKEN_WEIGHT);
  }
  for (const keyword of input.keywordMatches ?? []) {
    add(keyword, KEYWORD_TOKEN_WEIGHT);
  }
  return weights;
}

/**
 * Weighted overlap coefficient: how much of the extracted evidence appears
 * in the catalog text. Unlike Jaccard it is not punished by the catalog
 * texts being ~6x longer than extracted descriptions.
 */
export function weightedOverlapCoefficient(
  weights: Map<string, number>,
  catalogTokens: Set<string>,
): number {
  if (weights.size === 0 || catalogTokens.size === 0) return 0;
  let totalWeight = 0;
  let hitWeight = 0;
  for (const [token, weight] of weights) {
    totalWeight += weight;
    if (catalogTokens.has(token)) hitWeight += weight;
  }
  if (totalWeight === 0) return 0;
  const denominator = Math.min(totalWeight, catalogTokens.size);
  if (denominator === 0) return 0;
  return Math.min(1, hitWeight / denominator);
}

/**
 * Titan cosines on this corpus cluster roughly within [0.30, 0.80]; the
 * affine rescale restores dynamic range. Calibrate with the
 * `report:match-distribution` script when the corpus shifts.
 */
export const EMBEDDING_SCORE_FLOOR = 0.3;
export const EMBEDDING_SCORE_CEIL = 0.8;

export function scaledEmbeddingScore(cosine: number): number {
  const scaled =
    (cosine - EMBEDDING_SCORE_FLOOR) /
    (EMBEDDING_SCORE_CEIL - EMBEDDING_SCORE_FLOOR);
  return Math.max(0, Math.min(1, scaled));
}

/**
 * Evidence-strength gate. Disabled by default: the current self-assessment
 * distribution is degenerate (most risks self-score exactly 0.91), so the
 * multiplier would be a constant. Enable via MATCH_EVIDENCE_GATE_ENABLED
 * once the reworked rubric produces spread scores.
 */
export function evidenceGateMultiplier(
  evidenceStrengthScore: number | null | undefined,
): number {
  if (process.env.MATCH_EVIDENCE_GATE_ENABLED !== "true") return 1;
  if (evidenceStrengthScore == null || !Number.isFinite(evidenceStrengthScore)) {
    return 1;
  }
  const unit = Math.max(0, Math.min(1, evidenceStrengthScore / 15));
  return 0.8 + 0.2 * unit;
}

/** Map LLM / numbered taxonomy labels to catalog `risk_mappings.domains` values. */
export function normalizeToCatalogDomain(domain: string): string | null {
  return normalizeLabelToCatalogDomain(domain);
}

function domainMatchScore(
  extractedDomain: string,
  catalogDomain: string,
  contextText = "",
): number {
  const normalized = normalizeToCatalogDomain(extractedDomain);
  const catalog = (catalogDomain ?? "").trim();
  if (!catalog) return 0;
  if (normalized && fingerprint(normalized) === fingerprint(catalog)) {
    return 1;
  }
  const labelScore = jaccard(tokenize(extractedDomain), tokenize(catalog));
  const definitionScore = contextText
    ? (scoreDomainsFromDefinitions(contextText).find(
        (s) => fingerprint(s.catalogDomain) === fingerprint(catalog),
      )?.score ?? 0)
    : 0;
  return Math.min(1, labelScore * 0.45 + definitionScore * 0.55);
}

function buildMatchSummary(
  domainPct: number,
  descriptionPct: number,
  opts?: { semantic?: boolean },
): string {
  const parts: string[] = [];
  if (domainPct >= 80) parts.push("Strong domain alignment");
  else if (domainPct >= 50) parts.push("Partial domain alignment");
  else parts.push("Weak domain alignment");

  const kind = opts?.semantic ? "semantic similarity" : "description similarity";
  if (descriptionPct >= 60) parts.push(`high ${kind}`);
  else if (descriptionPct >= 35) parts.push(`moderate ${kind}`);
  else parts.push(`low ${kind}`);

  return parts.join("; ");
}

export type ExtractionMatchSignals = {
  keywordMatches: string[];
  evidenceExcerpts: string[];
  evidenceStrengthScore: number | null;
};

/**
 * Pull matching signals out of a stored/fresh extraction object:
 * taxonomy_mapping keyword matches + evidence excerpts (all three mapping
 * levels), the optional `risk.matching_keywords` list, and the
 * self-assessment evidence strength. Defensive against missing/malformed
 * shapes — older rows predate several of these fields.
 */
export function extractMatchSignalsFromExtraction(
  extractionJson: unknown,
): ExtractionMatchSignals {
  const ext = (extractionJson ?? {}) as {
    risk?: { matching_keywords?: unknown };
    justification?: {
      taxonomy_mapping?: Record<string, unknown>;
      self_assessment?: { evidence_strength_score?: unknown };
    };
  };

  const keywordMatches: string[] = [];
  const evidenceExcerpts: string[] = [];

  const pushStrings = (value: unknown, target: string[]) => {
    if (Array.isArray(value)) {
      for (const item of value) {
        const s = String(item ?? "").trim();
        if (s) target.push(s);
      }
    } else if (typeof value === "string") {
      for (const part of value.split(",")) {
        const s = part.trim();
        if (s) target.push(s);
      }
    }
  };

  pushStrings(ext.risk?.matching_keywords, keywordMatches);

  const mapping = ext.justification?.taxonomy_mapping;
  if (mapping && typeof mapping === "object") {
    for (const entry of Object.values(mapping)) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as { keyword_matches?: unknown; evidence_excerpts?: unknown };
      pushStrings(e.keyword_matches, keywordMatches);
      pushStrings(e.evidence_excerpts, evidenceExcerpts);
    }
  }

  const rawStrength = ext.justification?.self_assessment?.evidence_strength_score;
  const strength = Number(rawStrength);

  return {
    keywordMatches: [...new Set(keywordMatches)],
    evidenceExcerpts: [...new Set(evidenceExcerpts)],
    evidenceStrengthScore:
      rawStrength != null && Number.isFinite(strength) ? strength : null,
  };
}

export type CatalogMatchInput = {
  domain: string;
  title: string;
  description: string;
  primaryRisk?: string;
  secondaryRisk?: string;
  /** 0–1 confidence from resolveCatalogDomain; defaults to 1 when absent. */
  domainConfidence?: number;
  /** justification.taxonomy_mapping.*.keyword_matches, flattened. */
  keywordMatches?: string[];
  /** justification.taxonomy_mapping.*.evidence_excerpts, flattened. */
  evidenceExcerpts?: string[];
  /** Precomputed Titan embedding of the risk text; null → lexical fallback. */
  riskEmbedding?: number[] | null;
  /** self_assessment.evidence_strength_score (0–15); gate input, see above. */
  evidenceStrengthScore?: number | null;
  limit?: number;
  minAccuracyPercent?: number;
};

/** Clear in-memory catalog after `risk_mappings` is updated (e.g. review approval). */
export function invalidateCatalogCache(): void {
  catalogCache = null;
  catalogCacheAt = 0;
  catalogDomainFingerprints = null;
}

type CatalogCacheRow = {
  riskId: string | null;
  riskTitle: string | null;
  domains: string | null;
  description: string | null;
  executiveSummary: string | null;
  primaryRisk: string | null;
  secondaryRisks: string | null;
  embedding: number[] | null;
};

let catalogCache: CatalogCacheRow[] | null = null;
let catalogCacheAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function loadCatalogRows(): Promise<CatalogCacheRow[]> {
  const now = Date.now();
  if (catalogCache && now - catalogCacheAt < CACHE_TTL_MS) {
    return catalogCache;
  }
  catalogCache = await db
    .select({
      riskId: riskMappings.riskId,
      riskTitle: riskMappings.riskTitle,
      domains: riskMappings.domains,
      description: riskMappings.description,
      executiveSummary: riskMappings.executiveSummary,
      primaryRisk: riskMappings.primaryRisk,
      secondaryRisks: riskMappings.secondaryRisks,
      embedding: riskMappingEmbeddings.embedding,
    })
    .from(riskMappings)
    .leftJoin(
      riskMappingEmbeddings,
      eq(riskMappingEmbeddings.riskMappingId, riskMappings.riskMappingId),
    );
  catalogCacheAt = now;
  catalogDomainFingerprints = null;
  return catalogCache;
}

let catalogDomainFingerprints: Set<string> | null = null;

/** Distinct `risk_mappings.domains` fingerprints from the database. */
async function getCatalogDomainFingerprints(): Promise<Set<string>> {
  if (catalogDomainFingerprints) return catalogDomainFingerprints;
  const rows = await loadCatalogRows();
  const fps = new Set<string>();
  for (const row of rows) {
    const domain = (row.domains ?? "").trim();
    if (domain) fps.add(fingerprint(domain));
  }
  catalogDomainFingerprints = fps;
  return fps;
}

/**
 * True when the extracted domain aligns with a domain present in `risk_mappings`.
 */
export async function isDomainMappedToCatalog(domain: string): Promise<boolean> {
  const trimmed = (domain ?? "").trim();
  if (!trimmed) return false;

  const catalogFps = await getCatalogDomainFingerprints();
  if (catalogFps.size === 0) return false;

  if (catalogFps.has(fingerprint(trimmed))) return true;

  const normalized = normalizeToCatalogDomain(trimmed);
  if (!normalized) return false;

  return catalogFps.has(fingerprint(normalized));
}

const EMBEDDING_WEIGHTS = {
  embedding: 0.5,
  evidence: 0.2,
  taxonomy: 0.15,
  domain: 0.15,
} as const;

const LEXICAL_WEIGHTS = {
  evidence: 0.35,
  textSimilarity: 0.3,
  taxonomy: 0.2,
  domain: 0.15,
} as const;

export type ScoreCatalogRowInput = {
  row: {
    riskTitle: string | null;
    domains: string | null;
    description: string | null;
    executiveSummary: string | null;
    primaryRisk: string | null;
    secondaryRisks: string | null;
    embedding: number[] | null;
  };
  extractedDomain: string;
  extractedText: string;
  extractedTokens: Set<string>;
  evidenceWeights: Map<string, number>;
  domainConfidence: number;
  primaryRisk?: string;
  secondaryRisk?: string;
  riskEmbedding?: number[] | null;
  evidenceStrengthScore?: number | null;
};

/** Score one catalog row; exported for tests and the distribution report. */
export function scoreCatalogRow(input: ScoreCatalogRowInput): {
  accuracy: number;
  domainScore: number;
  descriptionScore: number;
  evidenceScore: number;
  taxonomyScore: number;
  embeddingScore: number | null;
} {
  const { row } = input;
  const catalogDescription = [row.description ?? "", row.executiveSummary ?? ""]
    .join(" ")
    .trim();
  const catalogText = `${row.riskTitle ?? ""} ${catalogDescription}`.trim();
  const catalogTokens = tokenize(catalogText);

  const rawDomainScore = domainMatchScore(
    input.extractedDomain,
    row.domains ?? "",
    input.extractedText,
  );
  const domainScore = rawDomainScore * (0.5 + 0.5 * input.domainConfidence);

  const taxonomyScore = taxonomyAlignmentScore({
    primaryRisk: input.primaryRisk ?? null,
    secondaryRisk: input.secondaryRisk ?? null,
    catalogPrimary: row.primaryRisk,
    catalogSecondary: row.secondaryRisks,
  });

  const evidenceScore = weightedOverlapCoefficient(
    input.evidenceWeights,
    catalogTokens,
  );

  const embeddingScore =
    input.riskEmbedding && row.embedding && row.embedding.length > 0
      ? scaledEmbeddingScore(cosineSimilarity(input.riskEmbedding, row.embedding))
      : null;

  let accuracy: number;
  let descriptionScore: number;
  if (embeddingScore != null) {
    accuracy =
      EMBEDDING_WEIGHTS.embedding * embeddingScore +
      EMBEDDING_WEIGHTS.evidence * evidenceScore +
      EMBEDDING_WEIGHTS.taxonomy * taxonomyScore +
      EMBEDDING_WEIGHTS.domain * domainScore;
    descriptionScore = embeddingScore;
  } else {
    const lexical = textSimilarity(input.extractedTokens, catalogTokens);
    accuracy =
      LEXICAL_WEIGHTS.evidence * evidenceScore +
      LEXICAL_WEIGHTS.textSimilarity * lexical +
      LEXICAL_WEIGHTS.taxonomy * taxonomyScore +
      LEXICAL_WEIGHTS.domain * domainScore;
    descriptionScore = Math.max(evidenceScore, lexical);
  }

  accuracy *= evidenceGateMultiplier(input.evidenceStrengthScore);

  return {
    accuracy,
    domainScore,
    descriptionScore,
    evidenceScore,
    taxonomyScore,
    embeddingScore,
  };
}

/**
 * Score catalog rows against an extracted risk. Embedding similarity is the
 * dominant signal when available; the scorer degrades to evidence-weighted
 * lexical matching otherwise. All catalog rows are scored — the previous
 * hard domain pre-filter made the flat domain constant, so domain now
 * contributes as a weighted component instead.
 */
export async function findCatalogRiskMatches(
  input: CatalogMatchInput,
): Promise<CatalogRiskMatch[]> {
  const limit = input.limit ?? 5;
  const minAccuracy = input.minAccuracyPercent ?? 12;
  const extractedDomain = (input.domain ?? "").trim();
  const extractedText = `${input.title} ${input.description}`.trim();
  const extractedTokens = tokenize(extractedText);

  if (!extractedText) return [];

  const domainConfidence = Math.max(
    0,
    Math.min(1, input.domainConfidence ?? 1),
  );
  const evidenceWeights = buildEvidenceTokenWeights({
    title: input.title,
    description: input.description,
    keywordMatches: input.keywordMatches,
    evidenceExcerpts: input.evidenceExcerpts,
  });

  const rows = await loadCatalogRows();

  const scored = rows
    .map((row) => {
      const score = scoreCatalogRow({
        row,
        extractedDomain,
        extractedText,
        extractedTokens,
        evidenceWeights,
        domainConfidence,
        primaryRisk: input.primaryRisk,
        secondaryRisk: input.secondaryRisk,
        riskEmbedding: input.riskEmbedding,
        evidenceStrengthScore: input.evidenceStrengthScore,
      });

      const catalogDescription = [
        row.description ?? "",
        row.executiveSummary ?? "",
      ]
        .join(" ")
        .trim();
      const domainPct = Math.round(score.domainScore * 100);
      const descriptionPct = Math.round(score.descriptionScore * 100);
      const accuracyPct = Math.round(score.accuracy * 100);

      const match: CatalogRiskMatch = {
        riskId: (row.riskId ?? "").trim() || `MAP-${row.riskTitle ?? "unknown"}`,
        title: (row.riskTitle ?? "").trim() || "Untitled catalog risk",
        description:
          catalogDescription.slice(0, 600) ||
          (row.riskTitle ?? "").trim() ||
          "No description available.",
        domain: (row.domains ?? "").trim() || "—",
        accuracyPercent: accuracyPct,
        domainMatchPercent: domainPct,
        descriptionMatchPercent: descriptionPct,
        matchSummary: buildMatchSummary(domainPct, descriptionPct, {
          semantic: score.embeddingScore != null,
        }),
        heuristicPercent: accuracyPct,
        evidenceMatchPercent: Math.round(score.evidenceScore * 100),
        taxonomyMatchPercent: Math.round(score.taxonomyScore * 100),
      };
      if (score.embeddingScore != null) {
        match.embeddingMatchPercent = Math.round(score.embeddingScore * 100);
      }
      return match;
    })
    .filter((m) => m.accuracyPercent >= minAccuracy)
    .sort((a, b) => b.accuracyPercent - a.accuracyPercent);

  return scored.slice(0, limit);
}
