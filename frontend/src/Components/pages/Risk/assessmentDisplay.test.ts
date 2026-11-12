import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FACTS_V2_CHECK_LABELS,
  assessmentCheckLabel,
  assessmentCheckPassDescription,
  assessmentCheckReason,
  displayGroundingScore,
  formatGroundingScore,
  formatPublicationStatus,
  formatStoredToken,
  groundingSortValue,
  verifierCardMode,
  type FactsV2AssessmentView,
} from "./assessmentDisplay.ts";

const assessment: FactsV2AssessmentView = {
  pipelineVersion: "2026.11.facts-v2",
  groundingScore: 0.95,
  confidence: "MEDIUM",
  decisionReason: "CATALOG_SUGGESTED",
  publicationStatus: "published",
  checks: Object.keys(FACTS_V2_CHECK_LABELS).map((name) => ({
    name,
    pass: name !== "catalog_match",
    reason: name === "catalog_match" ? "below 60 percent" : "",
    quote: name === "claim_is_demonstrated" ? "models leaked training text" : "",
  })),
};

test("facts-v2 detail hides the old verifier card and keeps nine check labels", () => {
  assert.equal(verifierCardMode(assessment, { ran: false }), "hidden");
  assert.equal(Object.keys(FACTS_V2_CHECK_LABELS).length, 9);
  assert.equal(assessment.checks.length, 9);
  assert.equal(assessmentCheckLabel("catalog_match"), "Catalog match");
  assert.equal(formatGroundingScore(assessment.groundingScore), "0.95");
  assert.equal(formatStoredToken(assessment.confidence), "MEDIUM");
  assert.equal(formatStoredToken(assessment.decisionReason), "CATALOG_SUGGESTED");
  assert.equal(formatStoredToken(assessment.publicationStatus), "published");
  assert.equal(formatPublicationStatus(assessment.publicationStatus), "Published");
  assert.equal(formatPublicationStatus("held"), "Held");
  assert.equal(assessment.checks[0].quote, "models leaked training text");
  assert.equal(assessment.checks.find((check) => check.name === "catalog_match")?.reason, "below 60 percent");
  for (const name of Object.keys(FACTS_V2_CHECK_LABELS)) {
    const description = assessmentCheckPassDescription(name);
    assert.ok(description.length > 20);
    assert.equal(description.includes("%"), false);
  }
  assert.equal(
    assessmentCheckPassDescription("claim_is_demonstrated"),
    "The source reports this risk as a measured result or a real incident.",
  );
  assert.equal(
    assessmentCheckReason(assessment.checks[0]),
    "The source reports this risk as a measured result or a real incident.",
  );
  assert.equal(
    assessmentCheckReason(
      assessment.checks.find((check) => check.name === "catalog_match")!,
    ),
    "No catalog entry describes this same risk.",
  );
});

test("displayed score is grounding, not the quality score", () => {
  assert.equal(displayGroundingScore({ assessment }), "0.95");
  assert.equal(groundingSortValue({ assessment }), 0.95);
  assert.equal(
    displayGroundingScore({
      assessment: null,
      evidenceDiscipline: { verifier: { ran: true, groundingScore: 0.42 } },
    }),
    "0.42",
  );
  assert.equal(
    displayGroundingScore({
      assessment: null,
      evidenceDiscipline: { verifier: { ran: false, groundingScore: null } },
    }),
    "—",
  );
});

test("v1 detail keeps the existing verifier card states", () => {
  assert.equal(verifierCardMode(null, null), "absent");
  assert.equal(verifierCardMode(undefined, undefined), "absent");
  assert.equal(verifierCardMode(null, { ran: false }), "did-not-run");
  assert.equal(verifierCardMode(null, { ran: true }), "verdict");
});
