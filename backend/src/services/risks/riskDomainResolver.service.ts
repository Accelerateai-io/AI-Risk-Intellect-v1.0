import {
  AIQ_RISK_DOMAIN_DEFINITIONS,
  buildDomainDefinitionCorpus,
  type TaxonomyDomain,
} from "../../config/aiqRiskTaxonomy.js";

export type DomainDefinitionScore = {
  catalogDomain: TaxonomyDomain;
  aiqName: string;
  score: number;
  keywordHits: number;
  matchedKeywords: string[];
};

export type DomainResolutionResult = {
  domain: TaxonomyDomain | null;
  method: "label" | "definitions" | "label+definitions" | "none";
  llmDomain: string | null;
  labelDomain: TaxonomyDomain | null;
  definitionScores: DomainDefinitionScore[];
  confidence: number;
};

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

const MIN_DEFINITION_SCORE = 0.06;
const MIN_OVERRIDE_GAP = 0.04;

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

function countKeywordHits(
  textLower: string,
  keywords: readonly string[],
): { hits: number; matched: string[] } {
  const matched: string[] = [];
  for (const keyword of keywords) {
    const normalized = keyword.toLowerCase().trim();
    if (!normalized) continue;
    if (textLower.includes(normalized)) matched.push(keyword);
  }
  return { hits: matched.length, matched };
}

/** Score each catalog domain against risk/article text using AI-Q definitions. */
export function scoreDomainsFromDefinitions(text: string): DomainDefinitionScore[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const textLower = trimmed.toLowerCase();
  const textTokens = tokenize(trimmed);

  return AIQ_RISK_DOMAIN_DEFINITIONS.map((def) => {
    const corpus = buildDomainDefinitionCorpus(def);
    const corpusTokens = tokenize(corpus);
    const tokenScore = textSimilarity(textTokens, corpusTokens);
    const { hits, matched } = countKeywordHits(textLower, def.keywords);
    const keywordBoost = Math.min(hits * 0.04, 0.24);
    const score = Math.min(1, tokenScore * 0.72 + keywordBoost);

    return {
      catalogDomain: def.catalogDomain,
      aiqName: def.aiqName,
      score,
      keywordHits: hits,
      matchedKeywords: matched,
    };
  }).sort((a, b) => b.score - a.score);
}

/** Map LLM / numbered taxonomy labels to catalog `risk_mappings.domains` values. */
export function normalizeLabelToCatalogDomain(domain: string): TaxonomyDomain | null {
  const fp = fingerprint(domain);
  if (!fp) return null;

  const direct: Record<string, TaxonomyDomain> = {
    discriminationandtoxicity: "Discrimination and Toxicity",
    fairnessandnondiscrimination: "Discrimination and Toxicity",
    privacyandsecurity: "Privacy and Security",
    misinformation: "Misinformation",
    maliciousactorsandmisuse: "Malicious Actors and Misuse",
    maliciousactors: "Malicious Actors and Misuse",
    humancomputerinteraction: "Human-Computer Interaction",
    humanoversight: "Human-Computer Interaction",
    socioeconomicandenvironmental: "Socioeconomic and Environmental",
    socioeconomicimpact: "Socioeconomic and Environmental",
    aisystemsafetyfailuresandlimitations: "AI System Safety, Failures, and Limitations",
    aisystemsafetyfailureslimitations: "AI System Safety, Failures, and Limitations",
    aisystemsafety: "AI System Safety, Failures, and Limitations",
    transparencyandexplainability: "AI System Safety, Failures, and Limitations",
    accountabilityandgovernance: "Human-Computer Interaction",
  };
  if (direct[fp]) return direct[fp];

  if (fp.includes("discriminat") || fp.includes("toxic") || fp.includes("fairness")) {
    return "Discrimination and Toxicity";
  }
  if (fp.includes("privacy") || fp.includes("security")) {
    return "Privacy and Security";
  }
  if (fp.includes("misinform") || fp.includes("deepfake")) {
    return "Misinformation";
  }
  if (fp.includes("malicious") || fp.includes("misuse")) {
    return "Malicious Actors and Misuse";
  }
  if (
    fp.includes("humancomputer") ||
    fp.includes("interaction") ||
    fp.includes("oversight") ||
    fp.includes("governance") ||
    fp.includes("accountability")
  ) {
    return "Human-Computer Interaction";
  }
  if (fp.includes("socioeconomic") || fp.includes("environmental")) {
    return "Socioeconomic and Environmental";
  }
  if (
    fp.includes("safety") ||
    fp.includes("failure") ||
    fp.includes("limitation") ||
    fp.includes("transparency") ||
    fp.includes("explainability")
  ) {
    return "AI System Safety, Failures, and Limitations";
  }

  let best: TaxonomyDomain | null = null;
  let bestScore = 0;
  for (const def of AIQ_RISK_DOMAIN_DEFINITIONS) {
    const score = jaccard(tokenize(domain), tokenize(def.catalogDomain));
    if (score > bestScore) {
      bestScore = score;
      best = def.catalogDomain;
    }
  }
  return bestScore >= 0.25 ? best : null;
}

export type ResolveCatalogDomainInput = {
  llmDomain?: string | null;
  title?: string | null;
  description?: string | null;
  articleText?: string | null;
};

/**
 * Resolve the best catalog domain using the LLM label plus AI-Q definition scoring.
 * Definition scoring can confirm or override a weak label match.
 */
export function resolveCatalogDomain(
  input: ResolveCatalogDomainInput,
): DomainResolutionResult {
  const llmDomain = (input.llmDomain ?? "").trim() || null;
  const labelDomain = llmDomain ? normalizeLabelToCatalogDomain(llmDomain) : null;

  const combinedText = [
    llmDomain ?? "",
    input.title ?? "",
    input.description ?? "",
    input.articleText ? input.articleText.slice(0, 6000) : "",
  ]
    .join(" ")
    .trim();

  const definitionScores = scoreDomainsFromDefinitions(combinedText);
  const bestDefinition = definitionScores[0] ?? null;

  if (!labelDomain && !bestDefinition) {
    return {
      domain: null,
      method: "none",
      llmDomain,
      labelDomain: null,
      definitionScores,
      confidence: 0,
    };
  }

  if (!labelDomain && bestDefinition) {
    const domain =
      bestDefinition.score >= MIN_DEFINITION_SCORE
        ? bestDefinition.catalogDomain
        : null;
    return {
      domain,
      method: domain ? "definitions" : "none",
      llmDomain,
      labelDomain: null,
      definitionScores,
      confidence: bestDefinition.score,
    };
  }

  if (labelDomain && !bestDefinition) {
    return {
      domain: labelDomain,
      method: "label",
      llmDomain,
      labelDomain,
      definitionScores,
      confidence: 0.5,
    };
  }

  const labelScore =
    definitionScores.find((s) => s.catalogDomain === labelDomain)?.score ?? 0;
  const topScore = bestDefinition!.score;

  if (
    bestDefinition &&
    bestDefinition.catalogDomain !== labelDomain &&
    topScore >= MIN_DEFINITION_SCORE &&
    topScore - labelScore >= MIN_OVERRIDE_GAP
  ) {
    return {
      domain: bestDefinition.catalogDomain,
      method: "definitions",
      llmDomain,
      labelDomain,
      definitionScores,
      confidence: topScore,
    };
  }

  const blendedConfidence = Math.max(labelScore, topScore * 0.85);
  return {
    domain: labelDomain,
    method: labelScore > 0 ? "label+definitions" : "label",
    llmDomain,
    labelDomain,
    definitionScores,
    confidence: blendedConfidence,
  };
}
