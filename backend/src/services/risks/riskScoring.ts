/**
 * Likelihood / Impact risk scoring (FAIR-informed 5x5 matrix).
 *
 * The LLM emits likelihood and impact (1–5 each, or null when the article
 * gives no basis); severity is always derived here as likelihood × impact —
 * model-provided severity values are never trusted.
 */

export type SeverityBand = "Low" | "Medium" | "High" | "Critical";

/** Index 1–5; index 0 unused. */
export const LIKELIHOOD_LABELS = [
  "",
  "Rare",
  "Unlikely",
  "Possible",
  "Likely",
  "Almost Certain",
] as const;

export const IMPACT_LABELS = [
  "",
  "Negligible",
  "Minor",
  "Moderate",
  "Major",
  "Severe",
] as const;

/** FAIR's six forms of loss (Loss Magnitude taxonomy). */
export const FAIR_LOSS_CATEGORIES = [
  "Productivity",
  "Response",
  "Replacement",
  "Fines & Judgments",
  "Competitive Advantage",
  "Reputation",
] as const;

type RiskScoringJson = {
  likelihood?: unknown;
  likelihood_reasoning?: unknown;
  impact?: unknown;
  impact_reasoning?: unknown;
  loss_categories?: unknown;
};

export type ResolvedRiskScoring = {
  likelihood: number | null;
  impact: number | null;
  severityScore: number | null;
  severityBand: SeverityBand | null;
  likelihoodReasoning: string;
  impactReasoning: string;
  lossCategories: string[];
};

export function clampScale1to5(value: unknown): number | null {
  if (value == null || typeof value === "boolean") return null;
  let num = NaN;
  if (typeof value === "number") {
    num = value;
  } else if (typeof value === "string" && value.trim()) {
    const trimmed = value.trim();
    num = Number(trimmed);
    if (!Number.isFinite(num)) {
      const match = trimmed.match(/\b([1-5])\b/);
      if (!match) return null;
      num = Number(match[1]);
    }
  }
  if (!Number.isFinite(num)) return null;
  const rounded = Math.round(num);
  return Math.max(1, Math.min(5, rounded));
}

export function computeSeverityScore(
  likelihood: number | null,
  impact: number | null,
): number | null {
  if (likelihood == null || impact == null) return null;
  return likelihood * impact;
}

/** 5x5 matrix bands: Low 1–4, Medium 5–9, High 10–16, Critical 17–25. */
export function severityBandFromScore(
  score: number | null,
): SeverityBand | null {
  if (score == null) return null;
  if (score >= 17) return "Critical";
  if (score >= 10) return "High";
  if (score >= 5) return "Medium";
  return "Low";
}

export function likelihoodLabel(likelihood: number | null): string | null {
  return likelihood != null && likelihood >= 1 && likelihood <= 5
    ? LIKELIHOOD_LABELS[likelihood]
    : null;
}

export function impactLabel(impact: number | null): string | null {
  return impact != null && impact >= 1 && impact <= 5
    ? IMPACT_LABELS[impact]
    : null;
}

function lossCategoriesFromJson(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const valid = new Set<string>(FAIR_LOSS_CATEGORIES);
  const out: string[] = [];
  for (const item of value) {
    const s = String(item ?? "").trim();
    if (valid.has(s) && !out.includes(s)) out.push(s);
  }
  return out;
}

/**
 * Resolve scoring column-first, falling back to `extraction_json.risk_scoring`
 * (same pattern as resolveQualityScore100) so rows written before the columns
 * were promoted still resolve.
 */
export function resolveRiskScoring(input: {
  likelihood: number | null;
  impact: number | null;
  extractionJson: unknown;
}): ResolvedRiskScoring {
  const ext = (input.extractionJson ?? {}) as {
    risk_scoring?: RiskScoringJson;
  };
  const scoring = ext.risk_scoring ?? {};

  const likelihood =
    clampScale1to5(input.likelihood) ?? clampScale1to5(scoring.likelihood);
  const impact = clampScale1to5(input.impact) ?? clampScale1to5(scoring.impact);
  const severityScore = computeSeverityScore(likelihood, impact);

  return {
    likelihood,
    impact,
    severityScore,
    severityBand: severityBandFromScore(severityScore),
    likelihoodReasoning: String(scoring.likelihood_reasoning ?? "").trim(),
    impactReasoning: String(scoring.impact_reasoning ?? "").trim(),
    lossCategories: lossCategoriesFromJson(scoring.loss_categories),
  };
}
