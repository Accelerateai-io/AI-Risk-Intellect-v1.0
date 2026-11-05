/**
 * Automatic publication gate.
 *
 * A record is published only when source support, evidence labels, risk
 * classification, and the existing review holds all pass. Anything else is
 * held for review. Job retries persist through extractRiskForArticle, so a
 * retry output is judged by this same function.
 */

import { isDomainInTaxonomy } from "./riskCatalogMatch.service.js";
import {
  DOMAIN_REVIEW_REASON,
  DUPLICATE_RISK_REVIEW_REASON,
  evidenceReviewReasons,
  JUDGE_NO_MATCH_REVIEW_REASON,
  MISSING_JUSTIFICATION_REVIEW_REASON,
  needsQualityReview,
  NON_ENGLISH_REVIEW_REASON,
  QUALITY_REVIEW_REASON,
  isDuplicateFlaggedRisk,
  isJudgeNoMatchRisk,
  isNonEnglishRisk,
} from "./riskQuality.js";

export type PublicationDecision = "publish" | "hold";

type PublicationMeta = {
  decision?: unknown;
  hold_reasons?: unknown;
};

function pythonPublication(extractionJson: Record<string, unknown>): PublicationMeta {
  const meta = extractionJson._meta as
    | { verification?: { publication?: PublicationMeta } }
    | undefined;
  return meta?.verification?.publication ?? {};
}

/** Reasons that keep a record off the published register. */
export function publicationHolds(input: {
  qualityScore: number | null;
  extractionJson: Record<string, unknown>;
  domains: string | null;
}): string[] {
  const ext = input.extractionJson;
  const holds: string[] = [];
  const push = (reason: string) => {
    const text = reason.trim();
    if (text && !holds.includes(text)) holds.push(text);
  };

  if (isNonEnglishRisk(ext)) push(NON_ENGLISH_REVIEW_REASON);
  if (isDuplicateFlaggedRisk(ext)) push(DUPLICATE_RISK_REVIEW_REASON);
  if (isJudgeNoMatchRisk(ext)) push(JUDGE_NO_MATCH_REVIEW_REASON);
  if (
    needsQualityReview({
      qualityScore: input.qualityScore,
      extractionJson: ext,
    })
  ) {
    push(QUALITY_REVIEW_REASON);
  }
  for (const reason of evidenceReviewReasons(ext)) push(reason);
  if (!isDomainInTaxonomy((input.domains ?? "").trim())) {
    push(DOMAIN_REVIEW_REASON);
  }
  const stored = String(ext.review_reason ?? "");
  if (stored.includes(MISSING_JUSTIFICATION_REVIEW_REASON)) {
    push(MISSING_JUSTIFICATION_REVIEW_REASON);
  }

  const publication = pythonPublication(ext);
  if (publication.decision === "hold") {
    const reasons = Array.isArray(publication.hold_reasons)
      ? publication.hold_reasons
      : [];
    if (reasons.length === 0) {
      push("Publication checks failed.");
    }
    for (const reason of reasons) push(String(reason ?? ""));
  }

  return holds;
}

/**
 * Publish when every hold is clear. Otherwise keep the record for review.
 * Mutates `extractionJson` in place.
 */
export function applyPublicationDecision(input: {
  qualityScore: number | null;
  extractionJson: Record<string, unknown>;
  domains: string | null;
}): PublicationDecision {
  const ext = input.extractionJson;
  const holds = publicationHolds(input);
  if (holds.length > 0) {
    ext.publication_status = "held";
    ext.publication_decision = "hold";
    ext.review_status = "pending";
    ext.published_automatically = false;
    const existing = String(ext.review_reason ?? "").trim();
    if (!existing) ext.review_reason = holds[0];
    return "hold";
  }

  ext.publication_status = "published";
  ext.publication_decision = "publish";
  ext.review_status = "approved";
  ext.published_automatically = true;
  if (!ext.approved_at) ext.approved_at = new Date().toISOString();
  return "publish";
}
