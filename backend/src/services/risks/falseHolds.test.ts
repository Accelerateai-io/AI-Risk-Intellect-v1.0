/**
 * Regression tests from the 24 Nov 2026 golden retest (Ghassan, rows R-14 and R-27).
 *  - R-162: an impact line that denies patient harm was held as a safety claim.
 *  - R-167: the domain check "corrected" Privacy and Security to Privacy & Security.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ASSESSMENT_CHECKS,
  decideWorkflow,
  reconcileDomainCheck,
  runFactsV2AssessmentCycle,
  type RiskAssessment,
} from "./workflowDecision.js";
import { resolveSafetyClaim } from "./safetyClaimGuard.js";

function checks(
  patch: Partial<Record<(typeof ASSESSMENT_CHECKS)[number], Record<string, unknown>>> = {},
): RiskAssessment["checks"] {
  const all = {} as NonNullable<RiskAssessment["checks"]>;
  for (const name of ASSESSMENT_CHECKS) {
    all[name] =
      name === "catalog_match"
        ? { pass: true, best_id: "RISK-1000", verdict: "related", percent: 80 }
        : { pass: true, quote: "measured result" };
  }
  return { ...all, ...patch } as RiskAssessment["checks"];
}

function assessment(patch: Partial<RiskAssessment> = {}): RiskAssessment {
  return {
    ran: true,
    parsed: true,
    checks: checks(),
    grounding_score: 0.92,
    quoted_support: ["test result"],
    safety_claim: "none",
    repair: null,
    ...patch,
  };
}

function record(impact: string, domains = "AI System Safety, Failures, and Limitations"): Record<string, unknown> {
  return {
    risk: {
      risk_title: "Measured model error",
      description: "The test reports a model error.",
      demonstrated_finding: "The test counted the errors.",
      stated_implication: "",
      evidence_type: "demonstrated",
      domains,
      primary_risk: "Technical Risks",
      secondary_risks: "Technical/Performance Risk",
    },
    risk_scoring: { likelihood: 3, likelihood_reasoning: "The test counted the errors.", impact: 2, impact_reasoning: impact },
  };
}

// R-162 impact reasoning, verbatim from AIRI dev (24 Nov 2026).
const R162_IMPACT =
  "The demonstrated impact is limited to pipeline quality variation and occasional generation failures in a research setting, with ablation studies showing performance degradation but no reports of harm to patients or clinical deployment failures.";

test("R-162: 'no reports of harm to patients' is not a safety claim", () => {
  const claim = resolveSafetyClaim(record(R162_IMPACT), "Ablation studies degraded benchmark metrics.", "none");
  assert.equal(claim, "none");
});

test("R-162: the record is not held as SAFETY_HOLD", () => {
  const safety = resolveSafetyClaim(record(R162_IMPACT), "Ablation studies degraded benchmark metrics.", "none");
  const decision = decideWorkflow({ stage: "extracted", assessment: assessment({ safety_claim: safety }), evidenceType: "demonstrated" });
  assert.notEqual(decision.reason, "SAFETY_HOLD");
});

test("'no evidence of injury to patients' is not a safety claim", () => {
  const claim = resolveSafetyClaim(
    record("The benchmark error rate rose, with no evidence of injury to patients in any deployment."),
    "Benchmark error rate rose.",
    "none",
  );
  assert.equal(claim, "none");
});

test("a harm claim after an unrelated 'no reports of' clause is still real_world", () => {
  const claim = resolveSafetyClaim(
    record("There were no reports of outages, and the misclassification injured patients awaiting surgery."),
    "Misclassification was observed.",
    "none",
  );
  assert.equal(claim, "real_world");
});

for (const sentence of [
  "No evidence of harm was found in trials, but in deployment the misdiagnosis injured patients.",
  "There were no reports of harm in the pilot, yet the deployed model killed two patients.",
]) {
  test(`a denial in one clause does not clear harm in another: ${sentence.slice(0, 40)}...`, () => {
    assert.equal(resolveSafetyClaim(record(sentence), "Deployment incident reported.", "none"), "real_world");
  });
}

test("a plain clinical harm claim is still real_world", () => {
  const claim = resolveSafetyClaim(
    record("The misclassification may injure patients by delaying urgent surgery."),
    "Errors were counted on a held-out transcription test.",
    "none",
  );
  assert.equal(claim, "real_world");
});

test("R-167: a domain 'correction' to the same domain spelled with & is a pass", () => {
  const a = assessment({
    checks: checks({ domain_correct: { pass: false, corrected: "Privacy & Security" } }),
  });
  const out = reconcileDomainCheck(record("No harm.", "Privacy and Security"), a);
  assert.equal(out.checks?.domain_correct?.pass, true);
  assert.equal(out.checks?.domain_correct?.corrected, "");
});

test("a real domain correction stays a failed check", () => {
  const a = assessment({
    checks: checks({ domain_correct: { pass: false, corrected: "Misinformation" } }),
  });
  const out = reconcileDomainCheck(record("No harm.", "Privacy and Security"), a);
  assert.equal(out.checks?.domain_correct?.pass, false);
  assert.equal(out.checks?.domain_correct?.corrected, "Misinformation");
});

test("a correction is kept when the record has no recognised domain", () => {
  const a = assessment({
    checks: checks({ domain_correct: { pass: false, corrected: "Privacy & Security" } }),
  });
  const out = reconcileDomainCheck(record("No harm.", ""), a);
  assert.equal(out.checks?.domain_correct?.pass, false);
});

test("end to end: a record whose only failure is the domain spelling is VERIFIED", async () => {
  const extraction = record("Benchmark accuracy fell in a research setting.", "Privacy and Security");
  const result = await runFactsV2AssessmentCycle({
    extractionJson: extraction,
    sourceText: "Benchmark accuracy fell. The system was evaluated on a privacy and security benchmark.",
    catalogCandidates: [],
    hints: {},
    assess: async () =>
      assessment({ checks: checks({ domain_correct: { pass: false, corrected: "Privacy & Security" } }) }),
  });
  assert.equal(result.decision.reason, "VERIFIED");
});
