/**
 * A finding that says the authors observed something the source only says
 * "may" happen is not a demonstrated claim. decideWorkflow then holds it
 * as CLAIM_UNSUPPORTED. A real-world safety hold is left unchanged.
 */

type GuardedAssessment = {
  safety_claim?: string | null;
  checks?: {
    claim_is_demonstrated?: {
      pass?: boolean | null;
      quote?: string;
      reason?: string;
    };
  };
};

const OBSERVED_HEDGE =
  /\b(?:observed|found|showed|shown|demonstrated|demonstrates)\b[\s\S]{0,120}\b(?:may|might)\b/i;

const FACT_CLAIM =
  /\b(?:demonstrat\w*|observ\w*|showed|shown|found|experiments?)\b/i;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function recordText(record: Record<string, unknown>): string {
  const risk = asRecord(record.risk ?? record);
  return ["demonstrated_finding", "description", "risk_title"]
    .map((field) => (typeof risk[field] === "string" ? String(risk[field]).trim() : ""))
    .filter(Boolean)
    .join("\n");
}

function dehyphen(text: string): string {
  return text.replace(/(\w)-\s+(\w)/g, "$1$2");
}

function hedgedClauseNeedles(sourceText: string): string[] {
  const needles: string[] = [];
  for (const sentence of sentences(dehyphen(sourceText))) {
    const match = sentence.match(/\b(?:may|might)\s+((?:[\w'-]+\s+){2,6})/i);
    const needle = match?.[1]?.toLowerCase().replace(/\s+/g, " ").trim() ?? "";
    const words = needle.split(" ").slice(0, 4).join(" ");
    if (words.length >= 12) needles.push(words);
  }
  return needles;
}

function sourceStatesUnhedged(sourceText: string, needle: string): boolean {
  return sentences(dehyphen(sourceText)).some((sentence) => {
    if (/\b(?:may|might)\b/i.test(sentence)) return false;
    return sentence.toLowerCase().replace(/\s+/g, " ").includes(needle);
  });
}

/** The record states a source "may" warning as something the paper demonstrated. */
function recordDemonstratesHedgedSource(
  record: Record<string, unknown>,
  sourceText: string,
): boolean {
  const text = dehyphen(recordText(record)).toLowerCase();
  return hedgedClauseNeedles(sourceText).some((needle) => {
    if (sourceStatesUnhedged(sourceText, needle)) return false;
    return sentences(text).some(
      (sentence) => sentence.includes(needle) && FACT_CLAIM.test(sentence),
    );
  });
}
function sourceStatesClauseAsFact(needle: string, sourceText: string): boolean {
  const compact = needle.toLowerCase().replace(/\s+/g, " ").trim();
  if (compact.length < 8) return false;
  return sentences(sourceText).some((sentence) => {
    if (/\b(?:may|might)\b/i.test(sentence)) return false;
    return sentence.toLowerCase().replace(/\s+/g, " ").includes(compact);
  });
}

export function recordTreatsSpeculationAsObserved(
  record: Record<string, unknown>,
  sourceText: string,
): boolean {
  for (const sentence of sentences(recordText(record))) {
    if (!OBSERVED_HEDGE.test(sentence)) continue;
    const clause = sentence.match(/\b(?:may|might)\s+((?:[\w-]+\s+){1,6})/i);
    const needle = clause?.[1]?.trim() ?? "";
    if (needle && sourceStatesClauseAsFact(needle, sourceText ?? "")) continue;
    return true;
  }
  return recordDemonstratesHedgedSource(record, sourceText ?? "");
}

/**
 * An ablation of the authors' own component, with the impact denying reported
 * harm, is the risk that component is meant to prevent. Keep that label so
 * the row can publish as labelled rather than as a real-world incident.
 */
export function applyLimitedEvidenceLabel(extractionJson: Record<string, unknown>): void {
  const risk = asRecord(extractionJson.risk);
  const scoring = asRecord(extractionJson.risk_scoring);
  const finding = `${risk.demonstrated_finding ?? ""}\n${risk.description ?? ""}`;
  const impact = String(scoring.impact_reasoning ?? "");
  const ablation = /\b(?:removing|removed|ablation)\b/i.test(finding);
  const deniesHarm =
    /\bno reported\b[\s\S]{0,80}\b(?:harm|patient safety)\b/i.test(impact);
  if (!ablation || !deniesHarm) return;
  risk.evidence_type = "mitigation_target";
  extractionJson.risk = risk;
}

const MEASURED_LIMITATION =
  /\b(?:ablation|removing|removed|degrad\w*|benchmarks?)\b/i;

/**
 * A mitigation-target record can quote a measured ablation or benchmark drop.
 * That quote is the result. It is not evidence that the claim is unsupported
 * merely because no deployed incident occurred.
 */
function quoteReportsMeasuredLimitation(quote: string): boolean {
  const text = quote.trim();
  if (!text || /\b(?:may|might)\b/i.test(text)) return false;
  return MEASURED_LIMITATION.test(text);
}

function clearMeasuredLimitationClaimFailure<T extends GuardedAssessment>(
  record: Record<string, unknown>,
  assessment: T,
): T {
  const checks = { ...(assessment.checks ?? {}) };
  const current = checks.claim_is_demonstrated ?? {};
  if (current.pass !== false) return assessment;
  if (!quoteReportsMeasuredLimitation(current.quote ?? "")) return assessment;
  const risk = asRecord(record.risk ?? record);
  const evidence = String(risk.evidence_type ?? "");
  const finding = String(risk.demonstrated_finding ?? "");
  const limited =
    evidence === "mitigation_target" ||
    /\b(?:ablation|removing|removed)\b/i.test(finding);
  if (!limited) return assessment;
  checks.claim_is_demonstrated = {
    ...current,
    pass: true,
    reason:
      "The source reports a measured ablation or benchmark result. A deployed incident is not required for this mitigation target.",
  };
  return { ...assessment, checks };
}

export function applyClaimSupportGuard<T extends GuardedAssessment>(
  record: Record<string, unknown>,
  sourceText: string,
  assessment: T,
): T {
  if (assessment.safety_claim === "real_world") return assessment;
  if (recordTreatsSpeculationAsObserved(record, sourceText ?? "")) {
    const checks = { ...(assessment.checks ?? {}) };
    const current = checks.claim_is_demonstrated ?? {};
    checks.claim_is_demonstrated = {
      ...current,
      pass: false,
      reason:
        current.reason?.trim() ||
        "The record says this was observed, but the source only says it may happen.",
    };
    return { ...assessment, checks };
  }
  return clearMeasuredLimitationClaimFailure(record, assessment);
}
