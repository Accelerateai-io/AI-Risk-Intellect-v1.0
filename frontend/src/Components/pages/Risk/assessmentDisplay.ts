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

export function formatGroundingScore(score: number | null | undefined): string {
  return typeof score === "number" && Number.isFinite(score) ? score.toFixed(2) : "—";
}

export function formatStoredToken(value: string | null | undefined): string {
  const text = value?.trim();
  return text ? text : "—";
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
