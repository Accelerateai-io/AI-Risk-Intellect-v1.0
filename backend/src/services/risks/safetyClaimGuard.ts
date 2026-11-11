/**
 * Interpretation B safety label.
 *
 * The assessor proposes safety_claim. This guard runs after that proposal and
 * before decideWorkflow. A finding or impact that asserts actual or potential
 * health or physical-safety harm is real_world, including when the source only
 * reports a test, benchmark, or simulation. A measured accuracy result with no
 * such assertion is left on the assessor's non-hold label.
 *
 * Workflow v2 previously used real_world only when the record stated that harm
 * as having occurred. This guard is the approved change to that definition.
 * decideWorkflow still holds only on the exact value real_world.
 */

const HARM_SENTENCE =
  /\b(?:patients?|clinical|physical|bodily|surgical|healthcare)\b[\s\S]{0,80}\b(?:harm(?:ed|s|ful)?|injur(?:e|es|y|ies|ed)|deaths?|killed|unsafe)\b|\b(?:harm(?:ed|s|ful)?|injur(?:e|es|y|ies|ed)|deaths?|killed)\b[\s\S]{0,80}\b(?:patients?|clinical|physical|bodily)\b|operational harm to healthcare|incorrect prioritization[\s\S]{0,80}\b(?:patients?|surgical|clinical|hospital)\b|misdiagnos\w*|inappropriate treatment|\bpatient safety\b|loss of life|bodily harm|physical injury|physical-safety harm/i;

const NOT_A_HARM_CLAIM =
  /\b(?:is an inference|not shown|not reported|not demonstrated|not established|does not (?:show|report|demonstrate)|no (?:patient|clinical|physical) harm|not a (?:deployed|real-world) incident)\b|\bharm\w*\s+(?:was|is|were|are)\s+not\b|\bnot\b[\s\S]{0,40}\b(?:harm|injury|death|misdiagnos)/i;

const METRIC_ONLY =
  /\b(?:auc|f1|accuracy|precision|recall|confusion matrix)\b/i;

const CONSEQUENCE =
  /\b(?:could|may|might|harmed|injur|misdiagnos|incorrect prioritization|operational harm)\b/i;

export type GuardedSafetyClaim = "real_world" | "research_only" | "none";

type GuardedAssessment = {
  safety_claim?: string | null;
  repair?: { drop_clause?: string; reason?: string } | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/**
 * Impact reasoning is the harm justification. The demonstrated finding counts
 * with it. When impact reasoning is present and does not assert harm, a
 * conditional sentence elsewhere in the record does not create a hold.
 */
export function safetyHarmText(record: Record<string, unknown>): string {
  const risk = asRecord(record.risk ?? record);
  const scoring = asRecord(record.risk_scoring);
  const impact = typeof scoring.impact_reasoning === "string" ? scoring.impact_reasoning.trim() : "";
  const finding = typeof risk.demonstrated_finding === "string" ? risk.demonstrated_finding.trim() : "";
  const description = typeof risk.description === "string" ? risk.description.trim() : "";
  const parts = impact ? [impact, finding] : [finding, description];
  return parts.filter(Boolean).join("\n");
}

function sentenceAssertsHarm(sentence: string): boolean {
  if (!HARM_SENTENCE.test(sentence) || NOT_A_HARM_CLAIM.test(sentence)) return false;
  if (METRIC_ONLY.test(sentence) && !CONSEQUENCE.test(sentence)) return false;
  return true;
}

/**
 * True when the finding or impact asserts health or physical-safety harm.
 * Source text is the check that a clinical metric quoted from a benchmark,
 * with no consequence of its own, stays a metric.
 */
export function assertsSafetyHarm(recordText: string, sourceText: string): boolean {
  for (const sentence of sentences(recordText)) {
    if (!sentenceAssertsHarm(sentence)) continue;
    const echoedMetric =
      METRIC_ONLY.test(sentence) &&
      METRIC_ONLY.test(sourceText) &&
      !CONSEQUENCE.test(sentence);
    if (echoedMetric) continue;
    return true;
  }
  return false;
}

export function resolveSafetyClaim(
  record: Record<string, unknown>,
  sourceText: string,
  modelClaim: string | null | undefined,
): GuardedSafetyClaim {
  if (assertsSafetyHarm(safetyHarmText(record), sourceText ?? "")) {
    return "real_world";
  }
  const model = String(modelClaim ?? "").trim().toLowerCase();
  if (model === "research_only") return "research_only";
  return "none";
}

/**
 * Replace the assessor's safety label and, when the result is a safety hold,
 * drop any repair proposal so the harm sentence cannot be removed and published.
 */
export function applySafetyClaimGuard<T extends GuardedAssessment>(
  record: Record<string, unknown>,
  sourceText: string,
  assessment: T,
): T {
  const safety_claim = resolveSafetyClaim(
    record,
    sourceText,
    assessment.safety_claim,
  );
  return {
    ...assessment,
    safety_claim,
    repair: safety_claim === "real_world" ? null : assessment.repair ?? null,
  };
}
