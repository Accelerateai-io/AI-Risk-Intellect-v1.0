import assert from "node:assert/strict";
import { test } from "node:test";
import { mapEvidenceDiscipline, mapFactsV2Assessment, mapRiskRowToDto } from "./riskDto.js";

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
  assert.equal(dto.assessment, null);
  assert.equal(dto.confidence, "HIGH");
  assert.equal(dto.qualityScore, "0.93");
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

test("facts-v2 detail mapping exposes the nine checks without changing quality confidence", () => {
  const dto = mapRiskRowToDto(
    {
      ...row,
      qualityScore: 50,
      extractionJson: {
        pipeline_version: "2026.11.facts-v2",
        grounding_score: 0.95,
        confidence: "HIGH",
        decision_reason: "CATALOG_SUGGESTED",
        publication_status: "published",
        verifier_checks: {
          claim_is_demonstrated: { pass: true, quote: "models leaked training text" },
          mitigations_reflected: { pass: true, reason: "controls listed" },
          not_attributed_to_proposed_method: { pass: true },
          severity_within_evidence: { pass: false, reason: "impact overstated" },
          evidence_type_consistent: { pass: true },
          rationale_supported: { pass: true },
          domain_correct: { pass: true },
          primary_secondary_correct: { pass: true },
          catalog_match: { pass: false, reason: "below 60 percent" },
        },
        _meta: {
          extraction_contract: "facts_v2",
          verifier: { ran: false, reason: "facts_v2 assessment runs in the worker" },
        },
        risk: { risk_title: "Hallucination in EEG pipelines", description: "desc" },
      },
    },
    "R-04",
  );

  assert.equal(dto.qualityScore, "0.50");
  assert.equal(dto.confidence, "LOW");
  assert.equal(dto.evidenceDiscipline.verifier?.ran, false);
  const assessment = dto.assessment;
  assert.ok(assessment);
  assert.equal(assessment.groundingScore, 0.95);
  assert.equal(assessment.confidence, "HIGH");
  assert.equal(assessment.decisionReason, "CATALOG_SUGGESTED");
  assert.equal(assessment.publicationStatus, "published");
  assert.equal(assessment.checks.length, 9);
  assert.deepEqual(assessment.checks[0], {
    name: "claim_is_demonstrated",
    pass: true,
    reason: "",
    quote: "models leaked training text",
  });
  assert.deepEqual(assessment.checks[3], {
    name: "severity_within_evidence",
    pass: false,
    reason: "impact overstated",
    quote: "",
  });
  assert.equal(assessment.checks[8].name, "catalog_match");
  assert.equal(
    assessment.checks[8].reason,
    "No catalog entry describes this risk, so the catalog match is shown as a suggestion.",
  );
  assert.equal(mapFactsV2Assessment({ pipeline_version: "2026.10" }), null);
});

test("catalog check explains a topical suggestion without a score", () => {
  const assessment = mapFactsV2Assessment({
    pipeline_version: "2026.11.facts-v2",
    verifier_checks: {
      catalog_match: {
        pass: false,
        best_id: "RISK-1242",
        verdict: "topical only",
        percent: 33,
        reason: "below 60 percent",
      },
    },
    catalog_matches: [
      {
        riskId: "RISK-1242",
        title: "Value Alignment Risks in Generative AI Systems",
        description: "Prompt wording can miss the user's intent.",
        domain: "AI System Safety, Failures, and Limitations",
        accuracyPercent: 33,
      },
    ],
  });
  assert.equal(
    assessment?.checks.find((check) => check.name === "catalog_match")?.reason,
    "The closest catalog entry, RISK-1242, “Value Alignment Risks in Generative AI Systems”, only shares the topic. It does not describe the same risk, so the catalog match is shown as a suggestion.",
  );
  assert.equal(assessment?.checks.find((check) => check.name === "catalog_match")?.reason.includes("33"), false);
});
