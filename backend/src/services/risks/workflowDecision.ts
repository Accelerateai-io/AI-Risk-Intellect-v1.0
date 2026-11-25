/**
 * Workflow v2 decision for facts-only extractions.
 *
 * The extractor stamps two equivalent markers. Either one identifies a
 * facts-v2 record:
 *   - extraction_json.pipeline_version === "2026.11.facts-v2"
 *   - extraction_json._meta.extraction_contract === "facts_v2"
 *
 * Older rows have neither, and this module does not change how they publish.
 */

import { applyClaimSupportGuard, applyLimitedEvidenceLabel } from "./claimSupportGuard.js";
import { failedCheckExplanation, failedCheckNote } from "./checkExplanation.js";
import { alignSecondaryClassification } from "./classificationAlignment.js";
import {
  applyPreSaveFieldValidation,
  approvedDomain,
  approvedPrimary,
  approvedSecondary,
  domainSupportedBySource,
} from "./preSaveFieldValidation.js";
import { applySafetyClaimGuard } from "./safetyClaimGuard.js";

export const FACTS_V2_PIPELINE_VERSION = "2026.11.facts-v2";
export const FACTS_V2_EXTRACTION_CONTRACT = "facts_v2";

export const GROUNDING_MIN = 0.6;
export const CATALOG_SUGGEST_BELOW = 60;

export const ASSESSMENT_CHECKS = [
  "claim_is_demonstrated",
  "mitigations_reflected",
  "not_attributed_to_proposed_method",
  "severity_within_evidence",
  "evidence_type_consistent",
  "rationale_supported",
  "domain_correct",
  "primary_secondary_correct",
  "catalog_match",
] as const;

/**
 * Failures of these checks are notes. They do not hold a facts-v2 record.
 *
 * Workflow v2 section 6: checks 2, 5, 7 and 8 are notes. Check 3 is a
 * claim check (rule 1). Checks 4 and 6 were promoted to hold rules after
 * the 21 Nov golden retest found failed severity and rationale checks on
 * published records (approved by Asad, 21 Nov 2026).
 */
export const NON_HOLDING_CHECKS = [
  "mitigations_reflected",
  "evidence_type_consistent",
  "domain_correct",
  "primary_secondary_correct",
] as const;

/** Checks whose failure on the main claim holds the record (rule 1). */
export const CLAIM_CHECKS = ["claim_is_demonstrated", "not_attributed_to_proposed_method"] as const;

/** Checks whose failure holds the record with its own reason code. */
export const EVIDENCE_HOLD_CHECKS = ["rationale_supported", "severity_within_evidence"] as const;

export const DECISION_REASON_CODES = [
  "FETCH_FAIL",
  "NOT_AI",
  "MERGED",
  "CLAIM_UNSUPPORTED",
  "REPAIRED",
  "REPAIR_FAILED",
  "SAFETY_HOLD",
  "RATIONALE_UNSUPPORTED",
  "SEVERITY_UNSUPPORTED",
  "CATALOG_SUGGESTED",
  "PUBLISHED_LABELLED",
  "PUBLISHED_WITH_NOTES",
  "VERIFIED",
] as const;

export type DecisionReasonCode = (typeof DECISION_REASON_CODES)[number];

export type WorkflowDecision = {
  reason: DecisionReasonCode;
  /** publish stores a risk row; hold stores a risk row off the published list; skip stores no risk row. */
  publication: "publish" | "hold" | "skip";
  /** Set only when a secondary clause must be dropped and the assessor run again. */
  reassess?: { dropClause: string };
  confidence: "HIGH" | "MEDIUM" | "LOW";
  catalogMatchStatus: "established" | "suggested" | "none";
  notes: string[];
};

export type AssessmentCheck = {
  pass?: boolean | null;
  quote?: string;
  reason?: string;
  corrected?: string;
  corrected_primary?: string;
  corrected_secondary?: string;
  best_id?: string;
  verdict?: string;
  percent?: number | null;
};

export type RiskAssessment = {
  ran?: boolean;
  parsed?: boolean;
  checks?: Partial<Record<(typeof ASSESSMENT_CHECKS)[number], AssessmentCheck>>;
  grounding_score?: number | null;
  quoted_support?: string[];
  safety_claim?: string | null;
  repair?: { drop_clause?: string; reason?: string } | null;
  /** Plausible adverse consequence in an identifiable buyer use case. Null when not returned. */
  buyer_relevance?: { pass?: boolean | null; use_case?: string; consequence?: string } | null;
};

/** Note stored when a record is published as research-only for buyer relevance. */
export const NOT_BUYER_RELEVANT_NOTE =
  "Research only: the record does not describe a plausible adverse consequence in a buyer use case.";

export type EvidenceEntry = { article_id: number; url: string };

export function isFactsV2Extraction(extractionJson: unknown): boolean {
  const ext = (extractionJson ?? {}) as {
    pipeline_version?: unknown;
    _meta?: { extraction_contract?: unknown };
  };
  if (ext.pipeline_version === FACTS_V2_PIPELINE_VERSION) return true;
  return ext._meta?.extraction_contract === FACTS_V2_EXTRACTION_CONTRACT;
}

function judgedCatalogCheck(candidates: unknown[]): AssessmentCheck | null {
  let best: { id: string; percent: number } | null = null;
  for (const item of candidates) {
    if (!item || typeof item !== "object") continue;
    const row = item as { id?: unknown; percent?: unknown; judgeVerdict?: unknown };
    if (row.judgeVerdict !== "match" && row.judgeVerdict !== "no_match") continue;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const percent = typeof row.percent === "number" ? row.percent : Number(row.percent);
    if (!id || !Number.isFinite(percent)) continue;
    if (!best || percent > best.percent) best = { id, percent: Math.round(percent) };
  }
  if (!best) return null;
  const verdict =
    best.percent >= 60 ? "same mechanism" : best.percent >= 40 ? "related" : "topical only";
  return {
    pass: best.percent >= CATALOG_SUGGEST_BELOW,
    best_id: best.id,
    verdict,
    percent: best.percent,
    reason: "catalog judge score",
  };
}

function applyJudgedCatalogMatch(
  assessment: RiskAssessment,
  candidates: unknown[],
): RiskAssessment {
  const check = judgedCatalogCheck(candidates);
  if (!check) return assessment;
  return {
    ...assessment,
    checks: { ...assessment.checks, catalog_match: check },
  };
}

/**
 * The verifier names domains with "&" (Privacy & Security) while records store
 * the catalog spelling (Privacy and Security). A "correction" that maps to the
 * record's own catalog domain changes nothing that is stored, so it is a pass,
 * not a failed check.
 */
export function reconcileDomainCheck(
  extractionJson: Record<string, unknown>,
  assessment: RiskAssessment,
): RiskAssessment {
  const entry = assessment.checks?.domain_correct;
  if (!entry || entry.pass !== false) return assessment;
  const risk = (extractionJson.risk ?? {}) as Record<string, unknown>;
  const current = approvedDomain(String(risk.domains ?? ""));
  const corrected = approvedDomain(entry.corrected);
  if (!current || !corrected || current !== corrected) return assessment;
  return {
    ...assessment,
    checks: {
      ...assessment.checks,
      domain_correct: {
        ...entry,
        pass: true,
        corrected: "",
        reason: `The suggested domain is the record's own domain (${current}) spelled differently.`,
      },
    },
  };
}

function checkOf(
  assessment: RiskAssessment | null | undefined,
  name: (typeof ASSESSMENT_CHECKS)[number],
): AssessmentCheck {
  return assessment?.checks?.[name] ?? {};
}

function passes(
  assessment: RiskAssessment | null | undefined,
  name: (typeof ASSESSMENT_CHECKS)[number],
): boolean {
  return checkOf(assessment, name).pass === true;
}

function catalogPercent(assessment: RiskAssessment | null | undefined): number | null {
  const raw = checkOf(assessment, "catalog_match").percent;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function catalogStatus(
  assessment: RiskAssessment | null | undefined,
): WorkflowDecision["catalogMatchStatus"] {
  const match = checkOf(assessment, "catalog_match");
  const percent = catalogPercent(assessment);
  if (!match.best_id && percent == null) return "none";
  if (percent == null || percent < CATALOG_SUGGEST_BELOW) return "suggested";
  return "established";
}

const HOLDING_CHECKS = [...CLAIM_CHECKS, ...EVIDENCE_HOLD_CHECKS] as const;

const UNEVIDENCED_CLAIM_REASON =
  /^(The source does not show this risk as a measured result or a real incident\.|This check did not run, so there is no verdict to trace\.)/;

/**
 * A failure holds the record only when the assessor supplied a quote
 * or a reason of its own. A blank failure is not evidence that the finding
 * is unsupported.
 */
function evidencedClaimFailure(entry: AssessmentCheck): boolean {
  if (entry.pass !== false) return false;
  if (entry.quote?.trim()) return true;
  const reason = entry.reason?.trim() ?? "";
  if (!reason) return false;
  return !UNEVIDENCED_CLAIM_REASON.test(reason);
}

function nonHoldingNotes(assessment: RiskAssessment | null | undefined): string[] {
  const notes: string[] = [];
  for (const name of NON_HOLDING_CHECKS) {
    const entry = checkOf(assessment, name);
    if (entry.pass === false) notes.push(failedCheckNote(name, entry));
  }
  for (const name of HOLDING_CHECKS) {
    const entry = checkOf(assessment, name);
    if (entry.pass === false && !evidencedClaimFailure(entry)) {
      notes.push(failedCheckNote(name, entry));
    }
  }
  return notes;
}

/** Holding checks that failed with evidence, in rule order. */
function heldChecks(
  assessment: RiskAssessment | null | undefined,
  names: readonly (typeof ASSESSMENT_CHECKS)[number][],
): (typeof ASSESSMENT_CHECKS)[number][] {
  return names.filter((name) => evidencedClaimFailure(checkOf(assessment, name)));
}

function evidenceHoldReason(
  failed: readonly (typeof ASSESSMENT_CHECKS)[number][],
): DecisionReasonCode | null {
  if (failed.includes("rationale_supported")) return "RATIONALE_UNSUPPORTED";
  if (failed.includes("severity_within_evidence")) return "SEVERITY_UNSUPPORTED";
  return null;
}

/** VERIFIED means every check passed (Workflow v2 rule 6). */
function allChecksPass(assessment: RiskAssessment | null | undefined): boolean {
  return ASSESSMENT_CHECKS.every((name) => {
    if (name === "catalog_match") return catalogStatus(assessment) === "established";
    return passes(assessment, name);
  });
}

/** Every check that failed or never ran, with a traceable sentence. */
export function failedAssessmentNotes(
  assessment: RiskAssessment | null | undefined,
): string[] {
  const notes: string[] = [];
  for (const name of ASSESSMENT_CHECKS) {
    const entry = checkOf(assessment, name);
    const holding = (HOLDING_CHECKS as readonly string[]).includes(name);
    if (entry.pass === false || (entry.pass !== true && holding)) {
      notes.push(failedCheckNote(name, entry));
    }
  }
  const score = assessment?.grounding_score;
  if (typeof score !== "number" || score < GROUNDING_MIN) {
    notes.push(
      typeof score === "number"
        ? `Grounding: score ${score.toFixed(2)} is below ${GROUNDING_MIN.toFixed(2)}, so the claim is not strongly traced to the source.`
        : "Grounding: no score was recorded, so the claim cannot be traced to the source.",
    );
  }
  return notes;
}

function confidenceFor(
  assessment: RiskAssessment | null | undefined,
  reason: DecisionReasonCode,
  evidenceType: string | null,
): WorkflowDecision["confidence"] {
  if (
    reason === "REPAIRED" ||
    reason === "REPAIR_FAILED" ||
    reason === "CLAIM_UNSUPPORTED" ||
    reason === "RATIONALE_UNSUPPORTED" ||
    reason === "SEVERITY_UNSUPPORTED" ||
    reason === "SAFETY_HOLD"
  ) {
    return "LOW";
  }
  if (
    reason === "CATALOG_SUGGESTED" ||
    reason === "PUBLISHED_LABELLED" ||
    reason === "PUBLISHED_WITH_NOTES"
  ) {
    return "MEDIUM";
  }
  if (reason !== "VERIFIED") return "LOW";
  if (allChecksPass(assessment) && evidenceType === "demonstrated") return "HIGH";
  return "MEDIUM";
}

/**
 * Ordered workflow-v2 rules. The first match wins.
 * A repair proposal is not a final reason: the caller drops the clause,
 * reassesses once, and calls again with `repaired: true`.
 */
export function decideWorkflow(input: {
  stage?: "fetch_fail" | "not_ai" | "duplicate" | "extracted";
  forceReprocess?: boolean;
  assessment?: RiskAssessment | null;
  evidenceType?: string | null;
  repaired?: boolean;
}): WorkflowDecision {
  const stage = input.stage ?? "extracted";
  const finish = (
    reason: DecisionReasonCode,
    publication: WorkflowDecision["publication"],
    notes: string[] = [],
  ): WorkflowDecision => ({
    reason,
    publication,
    confidence: confidenceFor(input.assessment, reason, input.evidenceType ?? null),
    catalogMatchStatus: catalogStatus(input.assessment),
    notes,
  });

  if (stage === "fetch_fail") return finish("FETCH_FAIL", "skip");
  if (stage === "not_ai") return finish("NOT_AI", "skip");
  if (stage === "duplicate" && !input.forceReprocess) return finish("MERGED", "skip");

  const assessment = input.assessment ?? null;
  const grounding = assessment?.grounding_score;
  const groundingFail =
    typeof grounding !== "number" || grounding < GROUNDING_MIN;
  const mainClaimFail = heldChecks(assessment, CLAIM_CHECKS).length > 0;
  const evidenceHold = evidenceHoldReason(heldChecks(assessment, EVIDENCE_HOLD_CHECKS));
  if (mainClaimFail || assessment?.parsed === false || assessment?.ran === false) {
    return finish(
      input.repaired ? "REPAIR_FAILED" : "CLAIM_UNSUPPORTED",
      "hold",
      nonHoldingNotes(assessment),
    );
  }
  if (groundingFail) {
    // Name the failed check when there is one, so the queue says why.
    return finish(
      input.repaired ? "REPAIR_FAILED" : (evidenceHold ?? "CLAIM_UNSUPPORTED"),
      "hold",
      nonHoldingNotes(assessment),
    );
  }

  const dropClause = assessment?.repair?.drop_clause?.trim() ?? "";
  if (!input.repaired && dropClause) {
    return {
      ...finish("REPAIRED", "publish"),
      reassess: { dropClause },
    };
  }

  if (assessment?.safety_claim === "real_world") {
    return finish("SAFETY_HOLD", "hold", nonHoldingNotes(assessment));
  }

  // Rule 2 runs first: a proposed repair can clear a failed rationale or
  // severity check. Without one, or after it, those failures hold. The
  // safety hold keeps its own label.
  if (evidenceHold) {
    return finish(input.repaired ? "REPAIR_FAILED" : evidenceHold, "hold", nonHoldingNotes(assessment));
  }

  if (input.repaired) {
    return finish("REPAIRED", "publish", nonHoldingNotes(assessment));
  }

  // Buyer relevance (approved by Asad, 24 Nov 2026): an accurate record with no
  // plausible adverse consequence in a buyer use case is published as research
  // only, never VERIFIED. A missing verdict changes nothing. It runs before the
  // catalog rule because CATALOG_SUGGESTED records also go to AI-Q (Asad, 24 Nov).
  if (assessment?.buyer_relevance?.pass === false) {
    return finish("PUBLISHED_LABELLED", "publish", [
      ...nonHoldingNotes(assessment),
      NOT_BUYER_RELEVANT_NOTE,
    ]);
  }

  const match = checkOf(assessment, "catalog_match");
  const percent = catalogPercent(assessment);
  if (!match.best_id || percent == null || percent < CATALOG_SUGGEST_BELOW) {
    return finish("CATALOG_SUGGESTED", "publish", nonHoldingNotes(assessment));
  }

  const evidenceType = (input.evidenceType ?? "").trim();
  if (
    evidenceType === "hypothesized" ||
    evidenceType === "mitigation_target" ||
    assessment?.safety_claim === "research_only"
  ) {
    return finish("PUBLISHED_LABELLED", "publish", nonHoldingNotes(assessment));
  }

  if (!allChecksPass(assessment)) {
    return finish("PUBLISHED_WITH_NOTES", "publish", nonHoldingNotes(assessment));
  }
  return finish("VERIFIED", "publish", nonHoldingNotes(assessment));
}

function replaceClause(value: unknown, clause: string): { next: unknown; removed: boolean } {
  if (typeof value !== "string" || !value.includes(clause)) {
    return { next: value, removed: false };
  }
  const next = value
    .replace(clause, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;])/g, "$1")
    .trim();
  return { next, removed: next !== value };
}

/** Drop a secondary clause. Returns whether the stored text actually changed. */
export function dropSecondaryClause(
  extractionJson: Record<string, unknown>,
  clause: string,
): { extractionJson: Record<string, unknown>; removed: boolean } {
  const copy = JSON.parse(JSON.stringify(extractionJson)) as Record<string, unknown>;
  const needle = clause.trim();
  if (!needle) return { extractionJson: copy, removed: false };
  let removed = false;
  const risk = (copy.risk ?? {}) as Record<string, unknown>;
  for (const field of ["description", "secondary_risks", "stated_implication"]) {
    const replaced = replaceClause(risk[field], needle);
    risk[field] = replaced.next;
    removed = removed || replaced.removed;
  }
  const scoring = (copy.risk_scoring ?? {}) as Record<string, unknown>;
  for (const field of ["likelihood_reasoning", "impact_reasoning"]) {
    const replaced = replaceClause(scoring[field], needle);
    scoring[field] = replaced.next;
    removed = removed || replaced.removed;
  }
  copy.risk = risk;
  copy.risk_scoring = scoring;
  return { extractionJson: copy, removed };
}

export function applyAssessorCorrections(
  extractionJson: Record<string, unknown>,
  assessment: RiskAssessment | null | undefined,
  sourceText = "",
): void {
  const risk = (extractionJson.risk ?? {}) as Record<string, unknown>;
  const domain = approvedDomain(checkOf(assessment, "domain_correct").corrected);
  const currentDomain = approvedDomain(String(risk.domains ?? ""));
  // Keep the extracted domain when the correction is a category name, or when
  // the article does not support the replacement.
  if (domain && domainSupportedBySource(domain, sourceText)) risk.domains = domain;
  else if (domain && !currentDomain) risk.domains = domain;
  const primary = approvedPrimary(
    checkOf(assessment, "primary_secondary_correct").corrected_primary,
  );
  const secondary = approvedSecondary(
    checkOf(assessment, "primary_secondary_correct").corrected_secondary,
  );
  if (primary) risk.primary_risk = primary;
  if (secondary) risk.secondary_risks = secondary;

  const aligned = alignSecondaryClassification(risk, sourceText);
  if (aligned) {
    risk.primary_risk = aligned.primary;
    risk.secondary_risks = aligned.secondary;
    if (assessment) {
      const checks = assessment.checks ?? {};
      checks.primary_secondary_correct = {
        ...checkOf(assessment, "primary_secondary_correct"),
        pass: false,
        corrected_primary: aligned.primary,
        corrected_secondary: aligned.secondary,
        reason: aligned.reason,
      };
      assessment.checks = checks;
    }
  }
  extractionJson.risk = risk;
}

function storedChecks(
  assessment: RiskAssessment | null | undefined,
): Record<string, AssessmentCheck> {
  const checks: Record<string, AssessmentCheck> = {};
  for (const name of ASSESSMENT_CHECKS) {
    const entry = checkOf(assessment, name);
    const reason =
      entry.pass === true
        ? entry.reason?.trim() || undefined
        : failedCheckExplanation(name, entry);
    checks[name] = {
      pass: entry.pass ?? null,
      ...(entry.quote ? { quote: entry.quote } : {}),
      ...(reason ? { reason } : {}),
      ...(entry.corrected ? { corrected: entry.corrected } : {}),
      ...(entry.corrected_primary ? { corrected_primary: entry.corrected_primary } : {}),
      ...(entry.corrected_secondary
        ? { corrected_secondary: entry.corrected_secondary }
        : {}),
      ...(entry.best_id ? { best_id: entry.best_id } : {}),
      ...(entry.verdict ? { verdict: entry.verdict } : {}),
      ...(entry.percent != null ? { percent: entry.percent } : {}),
    };
  }
  return checks;
}

export function applyDecisionToExtraction(
  extractionJson: Record<string, unknown>,
  decision: WorkflowDecision,
  assessment: RiskAssessment | null | undefined,
  sourceText = "",
): void {
  applyAssessorCorrections(extractionJson, assessment, sourceText);
  const published = decision.publication === "publish";
  extractionJson.pipeline_version = FACTS_V2_PIPELINE_VERSION;
  extractionJson.decision_reason = decision.reason;
  extractionJson.publication_status = published ? "published" : "held";
  extractionJson.publication_decision = published ? "publish" : "hold";
  extractionJson.review_status = published ? "approved" : "pending";
  extractionJson.published_automatically = published;
  extractionJson.confidence = decision.confidence;
  extractionJson.catalog_match_status = decision.catalogMatchStatus;
  extractionJson.verifier_checks = storedChecks(assessment);
  extractionJson.grounding_score = assessment?.grounding_score ?? null;
  extractionJson.quoted_support = assessment?.quoted_support ?? [];
  extractionJson.safety_claim = assessment?.safety_claim ?? null;
  extractionJson.buyer_relevance = assessment?.buyer_relevance ?? null;
  extractionJson.check_notes = decision.notes;
  const failedNotes = failedAssessmentNotes(assessment);
  if (!published) {
    extractionJson.review_reason = failedNotes.length
      ? `${decision.reason}. ${failedNotes.join(" ")}`
      : decision.reason;
  } else if (failedNotes.length) {
    extractionJson.review_reason = failedNotes.join(" ");
  }
  const scoring = (extractionJson.risk_scoring ?? {}) as {
    likelihood?: unknown;
    impact?: unknown;
  };
  const likelihood = Number(scoring.likelihood);
  const impact = Number(scoring.impact);
  if (
    Number.isInteger(likelihood) &&
    Number.isInteger(impact) &&
    likelihood >= 1 &&
    impact >= 1
  ) {
    extractionJson.risk_scoring = {
      ...scoring,
      severity_score: likelihood * impact,
    };
  }
}

export type AssessRequest = {
  sourceText: string;
  record: Record<string, unknown>;
  catalogCandidates: unknown[];
  hints: unknown;
};

/**
 * One assessor call, or two when the first result asks for a secondary-clause
 * repair. REPAIRED is stored only when the second call clears the hold rules.
 * REPAIR_FAILED keeps the clause removed and does not publish.
 */
export async function runFactsV2AssessmentCycle(input: {
  extractionJson: Record<string, unknown>;
  sourceText: string;
  catalogCandidates: unknown[];
  hints: unknown;
  assess: (request: AssessRequest) => Promise<RiskAssessment>;
}): Promise<{ assessCalls: number; decision: WorkflowDecision }> {
  const requestFor = (extractionJson: Record<string, unknown>): AssessRequest => ({
    sourceText: input.sourceText,
    record: extractionJson,
    catalogCandidates: input.catalogCandidates,
    hints: input.hints,
  });

  let extractionJson = input.extractionJson;
  applyLimitedEvidenceLabel(extractionJson);
  let assessCalls = 0;
  const evidenceTypeOf = () =>
    String(((extractionJson.risk ?? {}) as { evidence_type?: unknown }).evidence_type ?? "");

  let assessment = applyJudgedCatalogMatch(
    applyClaimSupportGuard(
      extractionJson,
      input.sourceText,
      applySafetyClaimGuard(
        extractionJson,
        input.sourceText,
        reconcileDomainCheck(extractionJson, await input.assess(requestFor(extractionJson))),
      ),
    ),
    input.catalogCandidates,
  );
  assessCalls += 1;
  let decision = decideWorkflow({
    stage: "extracted",
    assessment,
    evidenceType: evidenceTypeOf(),
  });

  if (decision.reassess) {
    const dropped = dropSecondaryClause(extractionJson, decision.reassess.dropClause);
    if (!dropped.removed) {
      decision = {
        ...decideWorkflow({
          stage: "extracted",
          assessment: { ...assessment, ran: false },
          evidenceType: evidenceTypeOf(),
          repaired: true,
        }),
        notes: ["repair clause was not found in the record"],
      };
    } else {
      Object.keys(extractionJson).forEach((key) => {
        delete extractionJson[key];
      });
      Object.assign(extractionJson, dropped.extractionJson);
      applyLimitedEvidenceLabel(extractionJson);
      assessment = applyJudgedCatalogMatch(
        applyClaimSupportGuard(
          extractionJson,
          input.sourceText,
          applySafetyClaimGuard(
            extractionJson,
            input.sourceText,
            reconcileDomainCheck(extractionJson, await input.assess(requestFor(extractionJson))),
          ),
        ),
        input.catalogCandidates,
      );
      assessCalls += 1;
      decision = decideWorkflow({
        stage: "extracted",
        assessment,
        evidenceType: evidenceTypeOf(),
        repaired: true,
      });
    }
  }

  applyDecisionToExtraction(extractionJson, decision, assessment, input.sourceText);
  applyPreSaveFieldValidation(extractionJson, input.sourceText);
  return { assessCalls, decision };
}

/** Keep prior evidence entries, append one new pair, and ignore an exact duplicate. */
export function appendEvidenceEntry(
  existing: unknown,
  entry: EvidenceEntry,
): EvidenceEntry[] {
  const kept: EvidenceEntry[] = [];
  const seen = new Set<string>();
  const add = (articleId: unknown, url: unknown) => {
    const id = Number(articleId);
    const href = String(url ?? "").trim();
    if (!Number.isInteger(id) || !href) return;
    const key = `${id}|${href}`;
    if (seen.has(key)) return;
    seen.add(key);
    kept.push({ article_id: id, url: href });
  };
  if (Array.isArray(existing)) {
    for (const item of existing) {
      if (!item || typeof item !== "object") continue;
      const row = item as { article_id?: unknown; url?: unknown };
      add(row.article_id, row.url);
    }
  }
  add(entry.article_id, entry.url);
  return kept;
}
