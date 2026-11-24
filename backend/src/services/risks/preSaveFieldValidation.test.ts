import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyPreSaveFieldValidation,
  factualTitle,
  intentFromSource,
} from "./preSaveFieldValidation.js";
import { runFactsV2AssessmentCycle, type RiskAssessment } from "./workflowDecision.js";

const DEEPFAKE =
  "The deepfake was created by a user and then went viral without consent.";

test("a deliberate deepfake is not stored as Accidental", () => {
  const extraction = {
    risk: {
      intent: "Accidental",
      domains: "Misinformation",
      primary_risk: "Technical Risks",
      secondary_risks: "Reputational Risk",
      risk_title: "A deepfake of a public figure was circulated",
      description: "A person created the video and it circulated without consent.",
    },
  };
  applyPreSaveFieldValidation(extraction, DEEPFAKE);
  assert.equal((extraction.risk as { intent: string }).intent, "Malicious");
});

test("Accidental is kept when the article describes an unintended failure", () => {
  assert.equal(
    intentFromSource(
      "Accidental",
      "The model produced the answer because of an unintended malfunction.",
    ),
    "Accidental",
  );
});

test("Accidental without any accidental evidence becomes Unknown", () => {
  assert.equal(
    intentFromSource("Accidental", "The paper measures accuracy on a benchmark."),
    "Unknown",
  );
});

test("a category name is replaced with one of the seven domains", () => {
  const extraction = {
    risk: {
      intent: "Systemic",
      domains: "Technical Risks",
      primary_risk: "Technical Risks",
      secondary_risks: "Security Risk",
      risk_title: "Prompt injection can expose credentials",
      description:
        "An adversarial attack uses prompt injection to leak secrets and bypass access control.",
    },
  };
  const source =
    "The blog describes privacy and security failures: prompt injection, unauthorized access, credential leak, and adversarial attack.";
  applyPreSaveFieldValidation(extraction, source);
  assert.equal((extraction.risk as { domains: string }).domains, "Privacy and Security");
  assert.equal((extraction.risk as { primary_risk: string }).primary_risk, "Technical Risks");
});

test("an overstated title is shortened to what the article states", () => {
  const source =
    "We study computational complexity in context-dependent argumentation frameworks.";
  const title =
    "Computational complexity and scalability limitations in context-dependent argumentation frameworks prevent real-time decision support";
  assert.equal(
    factualTitle(title, source),
    "Computational complexity in context-dependent argumentation frameworks",
  );
});

test("a supported domain correction is stored, and an unsupported one is not", async () => {
  const extraction: Record<string, unknown> = {
    pipeline_version: "2026.11.facts-v2",
    _meta: { extraction_contract: "facts_v2" },
    risk: {
      risk_title: "Accuracy drop on the benchmark",
      description: "The benchmark measured a three percent drop.",
      domains: "AI System Safety, Failures, and Limitations",
      primary_risk: "Technical Risks",
      secondary_risks: "Technical/Performance Risk",
      intent: "Accidental",
      evidence_type: "demonstrated",
    },
    risk_scoring: {
      likelihood: 2,
      likelihood_reasoning: "The benchmark measured a three percent drop.",
      impact: 2,
      impact_reasoning: "The benchmark measured a three percent drop.",
    },
  };
  await runFactsV2AssessmentCycle({
    extractionJson: extraction,
    sourceText: "The benchmark measured a three percent drop because of an unintended malfunction.",
    catalogCandidates: [],
    hints: {},
    assess: async () =>
      ({
        ran: true,
        parsed: true,
        grounding_score: 0.9,
        quoted_support: [],
        safety_claim: "none",
        repair: null,
        checks: {
          claim_is_demonstrated: { pass: true },
          mitigations_reflected: { pass: true },
          not_attributed_to_proposed_method: { pass: true },
          severity_within_evidence: { pass: true },
          evidence_type_consistent: { pass: true },
          rationale_supported: { pass: true },
          domain_correct: { pass: false, corrected: "Misinformation" },
          primary_secondary_correct: { pass: true },
          catalog_match: {
            pass: true,
            best_id: "AIQ-0100",
            verdict: "same mechanism",
            percent: 90,
          },
        },
      }) as RiskAssessment,
  });
  assert.equal(
    (extraction.risk as { domains: string }).domains,
    "AI System Safety, Failures, and Limitations",
  );
  assert.equal((extraction.risk as { intent: string }).intent, "Accidental");
});

test("assessor corrections that are not taxonomy values are not stored", async () => {
  const extraction: Record<string, unknown> = {
    pipeline_version: "2026.11.facts-v2",
    _meta: { extraction_contract: "facts_v2" },
    risk: {
      risk_title: "Agents with internal access can take harmful actions",
      description: "Internal agents may carry out cyber attacks.",
      domains: "Privacy and Security",
      primary_risk: "Technical Risks",
      secondary_risks: "Security Risk",
      intent: "Systemic",
      evidence_type: "mitigation_target",
    },
    risk_scoring: {
      likelihood: 2,
      likelihood_reasoning: "Internal agents may carry out cyber attacks.",
      impact: 2,
      impact_reasoning: "Internal agents may carry out cyber attacks.",
    },
  };
  const assessment = {
    ran: true,
    parsed: true,
    grounding_score: 0.9,
    quoted_support: [],
    safety_claim: "none",
    repair: null,
    checks: {
      claim_is_demonstrated: { pass: true },
      mitigations_reflected: { pass: true },
      not_attributed_to_proposed_method: { pass: true },
      severity_within_evidence: { pass: true },
      evidence_type_consistent: { pass: true },
      rationale_supported: { pass: true },
      domain_correct: { pass: false, corrected: "Technical Risks" },
      primary_secondary_correct: {
        pass: false,
        corrected_primary: "Privacy and Security",
        corrected_secondary: "not a category",
      },
      catalog_match: { pass: true, best_id: "AIQ-0100", verdict: "same mechanism", percent: 90 },
    },
  } as RiskAssessment;
  await runFactsV2AssessmentCycle({
    extractionJson: extraction,
    sourceText: "Internal agents may carry out cyber attacks.",
    catalogCandidates: [],
    hints: {},
    assess: async () => assessment,
  });
  const risk = extraction.risk as {
    domains: string;
    primary_risk: string;
    secondary_risks: string;
    intent: string;
  };
  assert.equal(risk.domains, "Privacy and Security");
  assert.equal(risk.primary_risk, "Technical Risks");
  assert.equal(risk.secondary_risks, "Security Risk");
  assert.equal(risk.intent, "Systemic");
});
