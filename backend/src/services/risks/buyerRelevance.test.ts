/**
 * Buyer relevance (approved by Asad, 24 Nov 2026, after Ghassan's golden retest).
 * An accurate record with no plausible adverse consequence in a buyer use case
 * (R-160 method design property, R-175 benchmark baseline) is published as
 * research only and is never VERIFIED.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ASSESSMENT_CHECKS,
  NOT_BUYER_RELEVANT_NOTE,
  decideWorkflow,
  runFactsV2AssessmentCycle,
  type RiskAssessment,
} from "./workflowDecision.js";

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

const decide = (a: RiskAssessment) =>
  decideWorkflow({ stage: "extracted", assessment: a, evidenceType: "demonstrated" });

test("all checks pass but not buyer relevant: PUBLISHED_LABELLED with a note, not VERIFIED", () => {
  const d = decide(assessment({ buyer_relevance: { pass: false } }));
  assert.equal(d.reason, "PUBLISHED_LABELLED");
  assert.equal(d.publication, "publish");
  assert.ok(d.notes.includes(NOT_BUYER_RELEVANT_NOTE));
});

test("buyer relevant and all checks pass: VERIFIED", () => {
  const d = decide(
    assessment({ buyer_relevance: { pass: true, use_case: "hospital triage tool", consequence: "urgent cases delayed" } }),
  );
  assert.equal(d.reason, "VERIFIED");
});

test("no buyer relevance verdict changes nothing", () => {
  assert.equal(decide(assessment()).reason, "VERIFIED");
  assert.equal(decide(assessment({ buyer_relevance: null })).reason, "VERIFIED");
  assert.equal(decide(assessment({ buyer_relevance: { pass: null } })).reason, "VERIFIED");
});

test("not buyer relevant with a weak catalog match: PUBLISHED_LABELLED, not CATALOG_SUGGESTED", () => {
  const d = decide(
    assessment({
      buyer_relevance: { pass: false },
      checks: checks({ catalog_match: { pass: false, best_id: "RISK-1", verdict: "topical only", percent: 20 } }),
    }),
  );
  assert.equal(d.reason, "PUBLISHED_LABELLED");
});

test("buyer relevant with a weak catalog match stays CATALOG_SUGGESTED", () => {
  const d = decide(
    assessment({
      buyer_relevance: { pass: true, use_case: "triage", consequence: "delay" },
      checks: checks({ catalog_match: { pass: false, best_id: "RISK-1", verdict: "topical only", percent: 20 } }),
    }),
  );
  assert.equal(d.reason, "CATALOG_SUGGESTED");
});

test("hold rules still win over buyer relevance", () => {
  const d = decide(
    assessment({
      buyer_relevance: { pass: false },
      checks: checks({ rationale_supported: { pass: false, quote: "not in the source" } }),
    }),
  );
  assert.equal(d.reason, "RATIONALE_UNSUPPORTED");
  assert.equal(d.publication, "hold");
});

test("end to end: the verdict is stored and the record is labelled", async () => {
  const extraction: Record<string, unknown> = {
    risk: {
      risk_title: "Baseline model underperforms the proposed method",
      description: "Direct inference scored 14-62% on benchmarks.",
      demonstrated_finding: "Direct inference scored 14-62%.",
      evidence_type: "demonstrated",
      domains: "AI System Safety, Failures, and Limitations",
      primary_risk: "Technical Risks",
      secondary_risks: "Technical/Performance Risk",
    },
    risk_scoring: { likelihood: 4, likelihood_reasoning: "Measured on 12 datasets.", impact: 2, impact_reasoning: "Research setting only." },
  };
  const result = await runFactsV2AssessmentCycle({
    extractionJson: extraction,
    sourceText: "Direct inference scored 14-62% on twelve benchmark datasets.",
    catalogCandidates: [],
    hints: {},
    assess: async () => assessment({ buyer_relevance: { pass: false, use_case: "", consequence: "" } }),
  });
  assert.equal(result.decision.reason, "PUBLISHED_LABELLED");
  assert.equal(extraction.decision_reason, "PUBLISHED_LABELLED");
  assert.deepEqual(extraction.buyer_relevance, { pass: false, use_case: "", consequence: "" });
});

test("R-164: one unsupported clause is repaired and published, not held", async () => {
  const clause = "and potential legal exposure from unauthorized likeness use";
  const extraction: Record<string, unknown> = {
    risk: {
      risk_title: "Viral deepfake of celebrities without consent",
      description: "A deepfake video of celebrities went viral.",
      demonstrated_finding: "The video circulated online.",
      evidence_type: "demonstrated",
      domains: "Misinformation",
      primary_risk: "Business Risks",
      secondary_risks: "Reputational Risk",
    },
    risk_scoring: {
      likelihood: 5,
      likelihood_reasoning: "The incident occurred.",
      impact: 3,
      impact_reasoning: `The incident caused reputational harm ${clause}.`,
    },
  };
  let calls = 0;
  const result = await runFactsV2AssessmentCycle({
    extractionJson: extraction,
    sourceText: "A deepfake video of celebrities went viral. She said it was circulating online.",
    catalogCandidates: [],
    hints: {},
    assess: async () => {
      calls += 1;
      return calls === 1
        ? assessment({
            checks: checks({ rationale_supported: { pass: false, quote: "no legal exposure is reported" } }),
            repair: { drop_clause: clause, reason: "legal exposure is not in the source" },
            buyer_relevance: { pass: true, use_case: "brand monitoring", consequence: "reputational harm" },
          })
        : assessment({ buyer_relevance: { pass: true, use_case: "brand monitoring", consequence: "reputational harm" } });
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.decision.reason, "REPAIRED");
  assert.equal(result.decision.publication, "publish");
  const impact = (extraction.risk_scoring as { impact_reasoning: string }).impact_reasoning;
  assert.ok(!impact.includes("legal exposure"));
});
