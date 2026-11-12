/** Display helpers for the Risk Detail assessment card. No workflow decisions. */

export const FACTS_V2_CHECK_LABELS: Record<string, string> = {
  claim_is_demonstrated: "Claim is demonstrated",
  mitigations_reflected: "Mitigations reflected",
  not_attributed_to_proposed_method: "Not attributed to the proposed method",
  severity_within_evidence: "Severity within evidence",
  evidence_type_consistent: "Evidence type consistent",
  rationale_supported: "Rationale supported",
  domain_correct: "Domain correct",
  primary_secondary_correct: "Primary and secondary correct",
  catalog_match: "Catalog match",
};

export type AssessmentCheckView = {
  name: string;
  pass: boolean | null;
  reason: string;
  quote: string;
};

export type FactsV2AssessmentView = {
  pipelineVersion: string;
  groundingScore: number | null;
  confidence: string | null;
  decisionReason: string | null;
  publicationStatus: string | null;
  checks: AssessmentCheckView[];
};

export type LegacyVerifierView = { ran: boolean } | null | undefined;

export type VerifierCardMode = "hidden" | "absent" | "did-not-run" | "verdict";

/** Facts-v2 replaces the old verifier card. V1 keeps the existing card. */
export function verifierCardMode(
  assessment: FactsV2AssessmentView | null | undefined,
  verifier: LegacyVerifierView,
): VerifierCardMode {
  if (assessment) return "hidden";
  if (!verifier) return "absent";
  if (!verifier.ran) return "did-not-run";
  return "verdict";
}

export function assessmentCheckLabel(name: string): string {
  return FACTS_V2_CHECK_LABELS[name] ?? name;
}

/** Plain-language meaning of a passed check. Shown on the Overview. */
const PASSED_CHECK_DESCRIPTIONS: Record<string, string> = {
  claim_is_demonstrated:
    "The source reports this risk as a measured result or a real incident.",
  mitigations_reflected:
    "Safeguards and limitations from the source are included in the record.",
  not_attributed_to_proposed_method:
    "The risk is the problem the source documents.",
  severity_within_evidence:
    "The likelihood and impact stay within what the source reports.",
  evidence_type_consistent:
    "The evidence label matches the kind of result in the source.",
  rationale_supported:
    "The likelihood and impact explanations are supported by the source.",
  domain_correct: "The domain matches the harm described in the source.",
  primary_secondary_correct:
    "The risk categories match how the harm happens.",
  catalog_match: "A catalog entry describes this same risk.",
};

export function assessmentCheckPassDescription(name: string): string {
  return PASSED_CHECK_DESCRIPTIONS[name] ?? "This check passed.";
}

const FAILED_CHECK_DESCRIPTIONS: Record<string, string> = {
  claim_is_demonstrated:
    "The source does not show this risk as a measured result or a real incident.",
  mitigations_reflected:
    "Safeguards or limitations from the source are missing from the record.",
  not_attributed_to_proposed_method:
    "The record blames the method the source proposes.",
  severity_within_evidence:
    "The likelihood or impact goes beyond what the source reports.",
  evidence_type_consistent:
    "The evidence label does not match the kind of result in the source.",
  rationale_supported:
    "A likelihood or impact explanation is not supported by the source.",
  domain_correct: "The domain does not match the harm described in the source.",
  primary_secondary_correct:
    "The risk categories do not match how the harm happens.",
  catalog_match: "No catalog entry describes this same risk.",
};

export function assessmentCheckReason(check: {
  name: string;
  pass: boolean | null;
  reason: string;
}): string {
  if (check.pass === true) return assessmentCheckPassDescription(check.name);
  const stored = check.reason.trim();
  const storedIsScore = /\d|percent|%/i.test(stored);
  if (check.pass === false && stored && !storedIsScore) return stored;
  if (check.pass === false) {
    return FAILED_CHECK_DESCRIPTIONS[check.name] ?? "This check failed.";
  }
  return "This check did not run.";
}

export function formatGroundingScore(score: number | null | undefined): string {
  return typeof score === "number" && Number.isFinite(score) ? score.toFixed(2) : "—";
}

export function formatStoredToken(value: string | null | undefined): string {
  const text = value?.trim();
  return text ? text : "—";
}

export function formatPublicationStatus(value: string | null | undefined): string {
  const text = formatStoredToken(value);
  if (text === "—") return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

type GroundingSource = {
  assessment?: { groundingScore: number | null } | null;
  evidenceDiscipline?: {
    verifier?: { ran: boolean; groundingScore: number | null } | null;
  } | null;
};

/** Facts-v2 grounding, otherwise the v1 verifier score when that pass ran. */
export function displayGroundingScore(risk: GroundingSource): string {
  if (risk.assessment) return formatGroundingScore(risk.assessment.groundingScore);
  const verifier = risk.evidenceDiscipline?.verifier;
  if (verifier?.ran) return formatGroundingScore(verifier.groundingScore);
  return "—";
}

/** Numeric grounding for sorting. Rows without a score sort last. */
export function groundingSortValue(risk: GroundingSource): number {
  if (risk.assessment && typeof risk.assessment.groundingScore === "number") {
    return risk.assessment.groundingScore;
  }
  const verifier = risk.evidenceDiscipline?.verifier;
  if (verifier?.ran && typeof verifier.groundingScore === "number") {
    return verifier.groundingScore;
  }
  return -1;
}
