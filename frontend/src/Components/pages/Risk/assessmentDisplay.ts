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

function bareCheckResult(reason: string): boolean {
  const text = reason.trim();
  if (!text) return true;
  if (/^(failed|check failed|catalog judge score)$/i.test(text)) return true;
  if (/^[\d.\s%]+$/.test(text)) return true;
  return /^(below|under|over|above)\s+\d+(\.\d+)?\s*percent$/i.test(text);
}

export function assessmentCheckReason(check: {
  name: string;
  pass: boolean | null;
  reason: string;
}): string {
  if (check.pass === true) return assessmentCheckPassDescription(check.name);
  const stored = check.reason.trim();
  const fallback =
    check.pass === false
      ? (FAILED_CHECK_DESCRIPTIONS[check.name] ?? "This check failed.")
      : "This check did not run, so there is no verdict to trace.";
  if (!bareCheckResult(stored)) return stored;
  if (stored) return `${fallback} Recorded result: ${stored}.`;
  return fallback;
}

export function formatGroundingScore(score: number | null | undefined): string {
  return typeof score === "number" && Number.isFinite(score) ? score.toFixed(2) : "—";
}

export function formatStoredToken(value: string | null | undefined): string {
  const text = value?.trim();
  return text ? text : "—";
}

/** Stored codes such as REPAIR_FAILED, shown as "Repair failed". */
export function formatDecisionReason(value: string | null | undefined): string {
  const text = value?.trim();
  if (!text) return "—";
  const words = text.toLowerCase().split("_").filter(Boolean);
  if (words.length === 0) return "—";
  return words
    .map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(" ");
}

const HOLD_NOTES: Record<string, string> = {
  REPAIR_FAILED: "A clause was removed, and these checks still failed.",
  CLAIM_UNSUPPORTED: "The main claim is not supported by the source.",
  RATIONALE_UNSUPPORTED: "A likelihood or impact explanation is not supported by the source.",
  SEVERITY_UNSUPPORTED: "The likelihood or impact goes beyond what the source reports.",
  SAFETY_HOLD: "The record asserts a real-world safety harm.",
};

/** Checks whose failure holds the record. Other failed checks stay in the full list. */
const HOLDING_CHECK_NAMES = new Set([
  "claim_is_demonstrated",
  "not_attributed_to_proposed_method",
  "severity_within_evidence",
  "rationale_supported",
]);

export function decisionHoldNote(reason: string | null | undefined): string | null {
  const text = reason?.trim() ?? "";
  return HOLD_NOTES[text] ?? null;
}

function holdReasonSentence(reason: string): string {
  const beforeQuote = reason.split(/\s+Source quote:/i)[0]?.trim() ?? "";
  return beforeQuote || reason.trim();
}

export type HoldCheckSummary = { name: string; label: string; reason: string };

/** Failed checks that explain a hold, without the long source quote. */
export function holdCheckSummaries(
  checks: AssessmentCheckView[],
): HoldCheckSummary[] {
  return checks
    .filter((check) => check.pass === false && HOLDING_CHECK_NAMES.has(check.name))
    .map((check) => ({
      name: check.name,
      label: assessmentCheckLabel(check.name),
      reason: holdReasonSentence(assessmentCheckReason(check)),
    }));
}

export type IndexedAssessmentCheck = AssessmentCheckView & { number: number };

export type AssessmentCheckGroups = {
  held: IndexedAssessmentCheck[];
  notes: IndexedAssessmentCheck[];
  rest: IndexedAssessmentCheck[];
  heldLead: string | null;
  notesLead: string | null;
};

/** One sentence for the checks that decided a hold. Null when the record is published. */
export function assessmentHeldLead(reason: string | null | undefined): string | null {
  const note = decisionHoldNote(reason);
  if (!note) return null;
  return `These checks kept the status ${reason?.trim()}. ${note}`;
}

/** One sentence for failed checks that do not decide a hold. */
export function assessmentNotesLead(
  reason: string | null | undefined,
  held: boolean,
): string {
  if (held) return "These checks are saved with the record. They do not hold it.";
  const code = reason?.trim() ?? "";
  if (code === "CATALOG_SUGGESTED") {
    return "These checks explain the catalog suggestion. The record is published.";
  }
  if (code === "REPAIRED") {
    return "A clause was removed and the record was published. These checks are notes.";
  }
  return "These checks are notes. The record is published.";
}

/**
 * Split the nine checks from the stored decision.
 * Holding failures explain a hold. Every other failure is a note.
 * Passed checks stay in rest. Check numbers keep their original order.
 */
export function splitAssessmentChecks(
  checks: AssessmentCheckView[],
  decisionReason: string | null | undefined,
): AssessmentCheckGroups {
  const indexed = checks.map((check, index) => ({ ...check, number: index + 1 }));
  const heldDecision = decisionHoldNote(decisionReason) != null;
  const held = heldDecision
    ? indexed.filter((check) => check.pass === false && HOLDING_CHECK_NAMES.has(check.name))
    : [];
  const heldNames = new Set(held.map((check) => check.name));
  const notes = indexed.filter((check) => check.pass === false && !heldNames.has(check.name));
  const rest = indexed.filter((check) => check.pass !== false);
  return {
    held,
    notes,
    rest,
    heldLead: assessmentHeldLead(decisionReason),
    notesLead: notes.length > 0 ? assessmentNotesLead(decisionReason, heldDecision) : null,
  };
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
