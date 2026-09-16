import { isDomainInTaxonomy } from "./riskCatalogMatch.service.js";

/** Risks strictly below this unit score (0–1) require human review. */

export const REVIEW_QUALITY_THRESHOLD = 0.9;



type SelfAssessmentJson = {

  total_score?: unknown;

  context_clarity_score?: unknown;

  keyword_score?: unknown;

  tagging_accuracy_score?: unknown;

  evidence_strength_score?: unknown;

};



function clampQualityScore100(score: number): number {

  return Math.round(Math.max(0, Math.min(100, score)));

}



function toFiniteNumber(value: unknown): number | null {

  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (typeof value === "string" && value.trim()) {

    const parsed = Number(value);

    if (Number.isFinite(parsed)) return parsed;

  }

  return null;

}



function sumSelfAssessmentSubScores(self: SelfAssessmentJson): number {

  const parts = [

    self.context_clarity_score,

    self.keyword_score,

    self.tagging_accuracy_score,

    self.evidence_strength_score,

  ];

  return parts.reduce<number>(
    (sum, part) => sum + (toFiniteNumber(part) ?? 0),
    0,
  );

}



export function normalizeQualityToUnit(

  score: number | null | undefined,

): number | null {

  if (score == null || Number.isNaN(score)) return null;

  if (score <= 1) return score;

  return score / 100;

}



/** Resolve stored quality on the 0–100 scale used in the DB column. */

export function resolveQualityScore100(input: {

  qualityScore: number | null;

  extractionJson: unknown;

}): number | null {

  const ext = (input.extractionJson ?? {}) as {

    justification?: { self_assessment?: SelfAssessmentJson };

    risk?: { quality_score?: unknown };

  };

  const self = ext.justification?.self_assessment;



  if (input.qualityScore != null && input.qualityScore > 0) {

    return clampQualityScore100(input.qualityScore);

  }



  const totalFromSelf = toFiniteNumber(self?.total_score);

  if (totalFromSelf != null && totalFromSelf > 0) {

    return clampQualityScore100(totalFromSelf);

  }



  const subSum = self ? sumSelfAssessmentSubScores(self) : 0;

  if (subSum > 0) return clampQualityScore100(subSum);



  const fromRisk = toFiniteNumber(ext.risk?.quality_score);

  if (fromRisk != null && fromRisk > 0) return clampQualityScore100(fromRisk);



  if (input.qualityScore != null) return input.qualityScore;

  if (totalFromSelf != null) return clampQualityScore100(totalFromSelf);

  return null;

}



export function resolveQualityUnitScore(input: {

  qualityScore: number | null;

  extractionJson: unknown;

}): number | null {

  return normalizeQualityToUnit(

    resolveQualityScore100(input),

  );

}



export function needsQualityReview(input: {

  qualityScore: number | null;

  extractionJson: unknown;

}): boolean {

  const unit = resolveQualityUnitScore(input);

  if (unit == null) return true;

  return unit < REVIEW_QUALITY_THRESHOLD;

}



export const NON_ENGLISH_REVIEW_REASON =
  "Non-English source content requires human review before approval.";

export const JUDGE_NO_MATCH_REVIEW_REASON =
  "Top catalog match was judged not to describe the same risk; this may be a catalog gap.";

export const DUPLICATE_RISK_REVIEW_REASON =
  "Near-duplicate of an existing risk detected via semantic similarity.";

export const MISSING_JUSTIFICATION_REVIEW_REASON =
  "Extraction returned no taxonomy justification (keyword matches / evidence excerpts).";

export const QUALITY_REVIEW_REASON =
  "Quality score below automated approval threshold.";

export const DOMAIN_REVIEW_REASON =
  "Extracted domain does not match any of the 7 risk taxonomy domains.";

export const FALLBACK_REVIEW_REASON = "Requires human review.";

/** True when semantic dedup flagged this risk as a near-duplicate. */
export function isDuplicateFlaggedRisk(extractionJson: unknown): boolean {
  const ext = (extractionJson ?? {}) as {
    dedup?: { duplicate_of_risk_id?: unknown };
  };
  return Boolean(ext.dedup && ext.dedup.duplicate_of_risk_id);
}

/** True when the match judge rejected the top catalog candidate. */
export function isJudgeNoMatchRisk(extractionJson: unknown): boolean {
  const ext = (extractionJson ?? {}) as {
    catalog_matches?: Array<{ judgeVerdict?: unknown }>;
  };
  const top = Array.isArray(ext.catalog_matches) ? ext.catalog_matches[0] : null;
  return top?.judgeVerdict === "no_match";
}

export function isNonEnglishRisk(extractionJson: unknown): boolean {

  const ext = (extractionJson ?? {}) as {

    is_non_english?: boolean;

    source_language?: string;

  };

  if (ext.is_non_english === true) return true;

  const lang = String(ext.source_language ?? "").trim().toLowerCase();

  if (!lang) return false;

  return lang !== "en" && !lang.startsWith("en-");

}



/** True when a risk must be validated on the Review page before Risks approval. */

export function needsHumanReview(input: {

  qualityScore: number | null;

  extractionJson: unknown;

}): boolean {

  if (isNonEnglishRisk(input.extractionJson)) return true;

  if (isDuplicateFlaggedRisk(input.extractionJson)) return true;

  if (isJudgeNoMatchRisk(input.extractionJson)) return true;

  return needsQualityReview(input);

}

export type ReviewWhy = {
  label: string;
  reason: string;
};

function storedReviewReason(extractionJson: unknown): string {
  const ext = (extractionJson ?? {}) as { review_reason?: string };
  return String(ext.review_reason ?? "").trim();
}

function isUnknownDomainRisk(input: {
  domains?: string | null;
  extractionJson: unknown;
}): boolean {
  const ext = (input.extractionJson ?? {}) as {
    risk?: Record<string, unknown>;
  };
  const domain = String(input.domains ?? ext.risk?.domains ?? "").trim();
  return !isDomainInTaxonomy(domain);
}

/** One-word queue label plus the full sentence shown on hover. */
export function resolveReviewWhy(input: {
  qualityScore: number | null;
  extractionJson: unknown;
  domains?: string | null;
}): ReviewWhy {
  const stored = storedReviewReason(input.extractionJson);

  if (isNonEnglishRisk(input.extractionJson)) {
    return { label: "Language", reason: stored || NON_ENGLISH_REVIEW_REASON };
  }
  if (isDuplicateFlaggedRisk(input.extractionJson)) {
    return { label: "Duplicate", reason: stored || DUPLICATE_RISK_REVIEW_REASON };
  }
  if (isJudgeNoMatchRisk(input.extractionJson)) {
    return { label: "Catalog", reason: stored || JUDGE_NO_MATCH_REVIEW_REASON };
  }
  if (needsQualityReview(input)) {
    return { label: "Quality", reason: stored || QUALITY_REVIEW_REASON };
  }
  if (isUnknownDomainRisk(input)) {
    return { label: "Domain", reason: stored || DOMAIN_REVIEW_REASON };
  }
  if (stored.includes(MISSING_JUSTIFICATION_REVIEW_REASON)) {
    return {
      label: "Evidence",
      reason: stored || MISSING_JUSTIFICATION_REVIEW_REASON,
    };
  }
  return { label: "Review", reason: stored || FALLBACK_REVIEW_REASON };
}

