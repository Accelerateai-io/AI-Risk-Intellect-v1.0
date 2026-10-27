import assert from "node:assert/strict";
import { test } from "node:test";
import { mapEvidenceDiscipline, mapRiskRowToDto } from "./riskDto.js";

const row = {
  id: "r1",
  articleId: 3,
  riskTitle: "Hallucination in EEG pipelines",
  domains: "AI System Safety, Failures, and Limitations",
  primaryRisk: "Technical Risks",
  secondaryRisk: "Technical/Performance Risk",
  sector: "Private",
  industry: "Healthcare",
  intent: "Accidental",
  qualityScore: 93,
  likelihood: 4,
  impact: 4,
  severityScore: 16,
  severityBand: "High",
  aiProductName: "NeuroWeaver",
  aiProductVendor: "Rutgers",
  modelName: "us.deepseek.r1-v1:0",
  createdAt: new Date("2026-10-24T18:17:05Z"),
  articleTitle: "T",
  articleUrl: "https://arxiv.org/abs/2602.13473",
  extractionJson: {
    risk: {
      risk_title: "Hallucination in EEG pipelines",
      description: "desc",
      source_type: "empirical_study",
      evidence_type: "hypothesized",
      demonstrated_finding: null,
      stated_implication: "The authors suggest pipelines may be implausible.",
      paper_stance: "proposes_mitigation",
      proposed_mitigation: "NeuroWeaver domain priors",
      mitigations_in_source: ["Validation on three EEG datasets", "Expert review"],
    },
    _meta: {
      model_used: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
      model_fallback: true,
      extraction: {
        mode: "whole",
        chunks: 1,
        llm_calls: 1,
        merge_strategy: null,
        preprocess: { references_removed: true },
      },
      verification: {
        review_reasons: ["Verifier: severity_within_evidence failed - x: y"],
      },
      verifier: {
        ran: true,
        passed: false,
        grounding_score: 0.42,
        model_used: "us.anthropic.claude-sonnet-5",
        unsupported_claims: ["HIPAA violation"],
        checks: {
          claim_is_demonstrated: { pass: true, reason: "ok" },
          mitigations_reflected: { pass: true, reason: "ok" },
          not_attributed_to_proposed_method: { pass: true, reason: "ok" },
          severity_within_evidence: { pass: false, reason: "rationale is about privacy" },
        },
      },
    },
  },
};

test("mapEvidenceDiscipline exposes BUG-01/02/03 fields and the verifier verdict", () => {
  const dto = mapRiskRowToDto(row, "R-03");
  const ed = dto.evidenceDiscipline;
  assert.equal(ed.evidenceType, "hypothesized");
  assert.equal(ed.paperStance, "proposes_mitigation");
  assert.equal(ed.proposedMitigation, "NeuroWeaver domain priors");
  assert.deepEqual(ed.mitigationsInSource, ["Validation on three EEG datasets", "Expert review"]);
  assert.equal(ed.statedImplication, "The authors suggest pipelines may be implausible.");
  assert.equal(ed.demonstratedFinding, null);
  assert.deepEqual(ed.reviewReasons, ["Verifier: severity_within_evidence failed - x: y"]);

  assert.ok(ed.verifier);
  assert.equal(ed.verifier.ran, true);
  assert.equal(ed.verifier.passed, false);
  assert.equal(ed.verifier.groundingScore, 0.42);
  assert.equal(ed.verifier.modelUsed, "us.anthropic.claude-sonnet-5");
  assert.deepEqual(ed.verifier.unsupportedClaims, ["HIPAA violation"]);
  assert.equal(ed.verifier.checks.length, 4);
  assert.deepEqual(ed.verifier.checks[3], {
    name: "severity_within_evidence",
    pass: false,
    reason: "rationale is about privacy",
  });

  assert.equal(ed.extraction.mode, "whole");
  assert.equal(ed.extraction.modelUsed, "us.anthropic.claude-haiku-4-5-20251001-v1:0");
  assert.equal(ed.extraction.modelFallback, true);
  assert.equal(ed.extraction.referencesRemoved, true);
  assert.equal(dto.reviewWhy, "Verifier");
});

test("mapEvidenceDiscipline is safe on legacy records without the fields", () => {
  const ed = mapEvidenceDiscipline({ risk: { risk_title: "x" } });
  assert.equal(ed.evidenceType, null);
  assert.deepEqual(ed.mitigationsInSource, []);
  assert.equal(ed.verifier, null);
  assert.equal(ed.extraction.mode, null);
  assert.equal(ed.extraction.modelFallback, false);
  assert.deepEqual(ed.reviewReasons, []);
});
