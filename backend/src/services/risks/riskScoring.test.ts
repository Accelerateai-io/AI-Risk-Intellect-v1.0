import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clampScale1to5,
  computeSeverityScore,
  impactLabel,
  likelihoodLabel,
  resolveRiskScoring,
  severityBandFromScore,
} from "./riskScoring.js";

test("clampScale1to5 clamps numerics and rejects non-numerics", () => {
  assert.equal(clampScale1to5(3), 3);
  assert.equal(clampScale1to5(0), 1);
  assert.equal(clampScale1to5(9), 5);
  assert.equal(clampScale1to5(4.4), 4);
  assert.equal(clampScale1to5("4"), 4);
  assert.equal(clampScale1to5("4 — Likely"), 4);
  assert.equal(clampScale1to5("Impact: 5"), 5);
  assert.equal(clampScale1to5(null), null);
  assert.equal(clampScale1to5(undefined), null);
  assert.equal(clampScale1to5("abc"), null);
  assert.equal(clampScale1to5(true), null);
  assert.equal(clampScale1to5(""), null);
});

test("computeSeverityScore propagates nulls", () => {
  assert.equal(computeSeverityScore(4, 3), 12);
  assert.equal(computeSeverityScore(null, 3), null);
  assert.equal(computeSeverityScore(4, null), null);
  assert.equal(computeSeverityScore(null, null), null);
});

test("severityBandFromScore band edges", () => {
  assert.equal(severityBandFromScore(1), "Low");
  assert.equal(severityBandFromScore(4), "Low");
  assert.equal(severityBandFromScore(5), "Medium");
  assert.equal(severityBandFromScore(9), "Medium");
  assert.equal(severityBandFromScore(10), "High");
  assert.equal(severityBandFromScore(16), "High");
  assert.equal(severityBandFromScore(17), "Critical");
  assert.equal(severityBandFromScore(25), "Critical");
  assert.equal(severityBandFromScore(null), null);
});

test("likelihood/impact labels", () => {
  assert.equal(likelihoodLabel(1), "Rare");
  assert.equal(likelihoodLabel(5), "Almost Certain");
  assert.equal(likelihoodLabel(null), null);
  assert.equal(impactLabel(1), "Negligible");
  assert.equal(impactLabel(5), "Severe");
  assert.equal(impactLabel(null), null);
});

test("resolveRiskScoring prefers columns over JSON", () => {
  const resolved = resolveRiskScoring({
    likelihood: 4,
    impact: 5,
    extractionJson: {
      risk_scoring: {
        likelihood: 1,
        impact: 1,
        likelihood_reasoning: "from json",
        impact_reasoning: "also json",
        loss_categories: ["Reputation", "Bogus", "Reputation"],
      },
    },
  });
  assert.equal(resolved.likelihood, 4);
  assert.equal(resolved.impact, 5);
  assert.equal(resolved.severityScore, 20);
  assert.equal(resolved.severityBand, "Critical");
  assert.equal(resolved.likelihoodReasoning, "from json");
  assert.equal(resolved.impactReasoning, "also json");
  assert.deepEqual(resolved.lossCategories, ["Reputation"]);
});

test("resolveRiskScoring falls back to extraction_json.risk_scoring", () => {
  const resolved = resolveRiskScoring({
    likelihood: null,
    impact: null,
    extractionJson: {
      risk_scoring: { likelihood: 3, impact: 2 },
    },
  });
  assert.equal(resolved.likelihood, 3);
  assert.equal(resolved.impact, 2);
  assert.equal(resolved.severityScore, 6);
  assert.equal(resolved.severityBand, "Medium");
});

test("resolveRiskScoring handles legacy rows with no scoring anywhere", () => {
  const resolved = resolveRiskScoring({
    likelihood: null,
    impact: null,
    extractionJson: {},
  });
  assert.equal(resolved.likelihood, null);
  assert.equal(resolved.impact, null);
  assert.equal(resolved.severityScore, null);
  assert.equal(resolved.severityBand, null);
  assert.equal(resolved.likelihoodReasoning, "");
  assert.deepEqual(resolved.lossCategories, []);
});
