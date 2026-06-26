import {
  listTaxonomyDomains,
  type TaxonomyDomain,
} from "../../config/aiqRiskTaxonomy.js";
import { db } from "../../db/index.js";
import { riskMappings } from "../../schema/riskMappings/riskMappings.js";
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
  /** Combined domain + description relevance, 0–100. */
  accuracyPercent: number;
  domainMatchPercent: number;
  descriptionMatchPercent: number;
  matchSummary: string;
};

/** Persisted on `risks.extraction_json.catalog_matches` at extraction time. */
export type StoredCatalogMatch = CatalogRiskMatch;

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(v: unknown, fallback = ""): string {
  if (v == null) return fallback;
  return String(v).trim();
}

function mapRawToCatalogMatch(item: Record<string, unknown>): CatalogRiskMatch | null {
  const riskId = str(item.riskId ?? item.risk_id);
  if (!riskId) return null;
  return {
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
): string {
  const parts: string[] = [];
  if (domainPct >= 80) parts.push("Strong domain alignment");
  else if (domainPct >= 50) parts.push("Partial domain alignment");
  else parts.push("Weak domain alignment");

  if (descriptionPct >= 60) parts.push("high description similarity");
  else if (descriptionPct >= 35) parts.push("moderate description similarity");
  else parts.push("low description similarity");

  return parts.join("; ");
}

export type CatalogMatchInput = {
  domain: string;
  title: string;
  description: string;
  primaryRisk?: string;
  secondaryRisk?: string;
  limit?: number;
  minAccuracyPercent?: number;
};

/** Clear in-memory catalog after `risk_mappings` is updated (e.g. review approval). */
export function invalidateCatalogCache(): void {
  catalogCache = null;
  catalogCacheAt = 0;
  catalogDomainFingerprints = null;
}

let catalogCache: Array<{
  riskId: string | null;
  riskTitle: string | null;
  domains: string | null;
  description: string | null;
  executiveSummary: string | null;
  primaryRisk: string | null;
  secondaryRisks: string | null;
}> | null = null;
let catalogCacheAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function loadCatalogRows() {
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
    })
    .from(riskMappings);
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

/**
 * Score catalog rows against an extracted risk using domain + description overlap.
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

  const normalizedDomain = normalizeToCatalogDomain(extractedDomain);
  const definitionDomain = scoreDomainsFromDefinitions(extractedText)[0]?.catalogDomain;
  const resolvedDomain = normalizedDomain ?? definitionDomain ?? null;
  const rows = await loadCatalogRows();

  const candidates = resolvedDomain
    ? rows.filter(
        (row) =>
          fingerprint(row.domains ?? "") === fingerprint(resolvedDomain) ||
          domainMatchScore(extractedDomain, row.domains ?? "", extractedText) >=
            0.35,
      )
    : rows;

  const pool = candidates.length >= 10 ? candidates : rows;

  const scored = pool
    .map((row) => {
      const catalogDescription = [
        row.description ?? "",
        row.executiveSummary ?? "",
      ]
        .join(" ")
        .trim();
      const catalogText = `${row.riskTitle ?? ""} ${catalogDescription}`.trim();
      const descriptionScore = textSimilarity(
        extractedTokens,
        tokenize(catalogText),
      );
      const domainScore = domainMatchScore(
        extractedDomain,
        row.domains ?? "",
        extractedText,
      );
      const accuracy = 0.35 * domainScore + 0.65 * descriptionScore;
      const domainPct = Math.round(domainScore * 100);
      const descriptionPct = Math.round(descriptionScore * 100);
      const accuracyPct = Math.round(accuracy * 100);

      return {
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
        matchSummary: buildMatchSummary(domainPct, descriptionPct),
      };
    })
    .filter((m) => m.accuracyPercent >= minAccuracy)
    .sort((a, b) => b.accuracyPercent - a.accuracyPercent);

  return scored.slice(0, limit);
}
