/** Risks at or below this unit score (0–1) require human review. */

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

  return unit <= REVIEW_QUALITY_THRESHOLD;

}



export const NON_ENGLISH_REVIEW_REASON =
  "Non-English source content requires human review before approval.";



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

  return needsQualityReview(input);

}

