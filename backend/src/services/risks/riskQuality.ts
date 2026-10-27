import { isDomainInTaxonomy } from "./riskCatalogMatch.service.js";

/** Default: risks strictly below this unit score (0–1) require human review. */
const DEFAULT_REVIEW_QUALITY_THRESHOLD = 0.9;

/**
 * Review quality threshold (0–1), read from REVIEW_QUALITY_THRESHOLD (BUG-06).
 * Falls back to the default when unset or invalid (non-numeric / outside 0–1),
 * so behaviour is unchanged unless the env var is explicitly set.
 */
export function reviewQualityThreshold(): number {
  const raw = process.env.REVIEW_QUALITY_THRESHOLD?.trim();
  if (!raw) return DEFAULT_REVIEW_QUALITY_THRESHOLD;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return DEFAULT_REVIEW_QUALITY_THRESHOLD;
  }
  return parsed;
}

/** Import-time snapshot of the default; prefer reviewQualityThreshold() at call time. */
export const REVIEW_QUALITY_THRESHOLD = reviewQualityThreshold();



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

  return unit < reviewQualityThreshold();

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

export const EVIDENCE_REVIEW_REASON =
  "Evidence-discipline checks flagged this record.";

/**
 * Review reasons attached by the Python evidence-discipline rules
 * (BUG-01/02/03/04) under `extraction_json._meta.verification.review_reasons`.
 * Returns a de-duplicated, trimmed list; empty when none are present.
 */
export function evidenceReviewReasons(extractionJson: unknown): string[] {
  const ext = (extractionJson ?? {}) as {
    _meta?: { verification?: { review_reasons?: unknown } };
  };
  const reasons = ext._meta?.verification?.review_reasons;
  if (!Array.isArray(reasons)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of reasons) {
    const r = String(raw ?? "").trim();
    if (r && !seen.has(r)) {
      seen.add(r);
      out.push(r);
    }
  }
  return out;
}

/** True when the Python evidence rules attached at least one review reason. */
export function hasEvidenceReviewReasons(extractionJson: unknown): boolean {
  return evidenceReviewReasons(extractionJson).length > 0;
}

/** Reviewer-facing sentence per verifier check (BUG-06). */
const VERIFIER_CHECK_TEXT: Record<string, string> = {
  claim_is_demonstrated:
    "The record states the risk as demonstrated, but the source only speculates about it.",
  mitigations_reflected:
    "The source describes safeguards or limitations that the record does not reflect.",
  not_attributed_to_proposed_method:
    "The record blames the method the source proposes for the problem it was built to solve.",
  severity_within_evidence:
    "The likelihood or impact rationale goes beyond what the source supports.",
};

const VERIFIER_PREFIX_RE = /^verifier:\s*/i;

/** True when the reason came from the independent verifier pass. */
export function isVerifierReason(raw: string): boolean {
  return VERIFIER_PREFIX_RE.test(raw.trim());
}

function plainVerifierReason(raw: string): string {
  const body = raw.trim().replace(VERIFIER_PREFIX_RE, "");
  const failed = body.match(/^(\w+) failed\s*-\s*[^:]*(?::\s*(.*))?$/i);
  if (failed) {
    const check = failed[1] ?? "";
    const detail = (failed[2] ?? "").trim();
    const base = VERIFIER_CHECK_TEXT[check] ?? `Verifier check ${check} failed.`;
    return detail ? `${base} ${detail}` : base;
  }
  const score = body.match(/^grounding_score\s+([\d.]+)\s+below\s+([\d.]+)/i);
  if (score) {
    return `Only part of the record is directly supported by the source (grounding ${score[1]}, minimum ${score[2]}).`;
  }
  if (/did not run/i.test(body)) {
    return `The verifier could not run, so this record was not independently checked. ${body.replace(/^did not run\s*-\s*/i, "")}`.trim();
  }
  if (/no verdict/i.test(body)) {
    return "The verifier gave no readable verdict, so this record was not independently checked.";
  }
  return `Verifier: ${body}`;
}

const PLAIN_GROUNDING_REASONS: Array<{ test: RegExp; text: string }> = [
  {
    test: /uncited likelihood_reasoning/i,
    text: "The likelihood explanation does not quote the article. It needs at least five words in a row copied from the source.",
  },
  {
    test: /uncited impact_reasoning/i,
    text: "The impact explanation does not quote the article. It needs at least five words in a row copied from the source.",
  },
  {
    test: /likelihood capped/i,
    text: "The article only speculates about this risk, so the likelihood was kept at 2 or lower.",
  },
  {
    test: /evidence fields missing/i,
    text: "Some evidence details were missing and were filled in automatically. Check the evidence type, the paper's stance, and the mitigations.",
  },
];

/** Reviewer-facing sentence for one evidence-discipline reason. */
export function plainGroundingReason(raw: string): string {
  const trimmed = raw.trim();
  if (isVerifierReason(trimmed)) return plainVerifierReason(trimmed);
  for (const rule of PLAIN_GROUNDING_REASONS) {
    if (rule.test.test(trimmed)) return rule.text;
  }

  const absence = trimmed.match(
    /mitigation asserts absence from silence[\s\S]*\(got:\s*"([^"]*)"\)/i,
  );
  if (absence || /mitigation asserts absence/i.test(trimmed)) {
    const quoted = absence?.[1]?.trim();
    const what = quoted ? ` ("${quoted}")` : "";
    return `A mitigation says a safeguard is missing${what}, but the article does not say that. Use "not described in source" unless the source states the safeguard is absent.`;
  }

  return trimmed.replace(/\s*\(BUG-\d+\s*\/\s*TC-\d+\)\s*/gi, " ").replace(/\s+/g, " ").trim();
}

function plainGroundingReasons(reasons: string[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const raw of reasons) {
    const line = plainGroundingReason(raw);
    if (!line || seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }
  return lines.join("\n");
}

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

  if (hasEvidenceReviewReasons(input.extractionJson)) return true;

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
  const evidenceReasons = evidenceReviewReasons(input.extractionJson);
  if (evidenceReasons.length > 0) {
    // The verifier verdict (BUG-06) names the specific failure; it outranks
    // the mechanical quote check so the queue shows what actually went wrong.
    const label = evidenceReasons.some(isVerifierReason) ? "Verifier" : "Grounding";
    return { label, reason: plainGroundingReasons(evidenceReasons) };
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

