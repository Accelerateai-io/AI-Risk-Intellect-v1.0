import assert from "node:assert/strict";
import { test } from "node:test";
import { applyPublicationDecision } from "./publicationGate.js";
import {
  isRiskInReviewQueue,
  isRiskVisibleInMainList,
} from "./risks.service.js";

const DOMAIN = "7. AI System Safety, Failures, & Limitations";

function baseExtraction(): Record<string, unknown> {
  return {
    source_language: "en",
    risk: { domains: DOMAIN },
    justification: {
      self_assessment: { total_score: 95 },
    },
  };
}

test("publishes only when every publication check passes", () => {
  const extractionJson = baseExtraction();
  const decision = applyPublicationDecision({
    qualityScore: 95,
    extractionJson,
    domains: DOMAIN,
  });
  assert.equal(decision, "publish");
  assert.equal(extractionJson.publication_status, "published");
  assert.equal(extractionJson.review_status, "approved");
  assert.equal(extractionJson.published_automatically, true);
  assert.equal(
    isRiskVisibleInMainList({
      domains: DOMAIN,
      qualityScore: 95,
      extractionJson,
    }),
    true,
  );
  assert.equal(
    isRiskInReviewQueue({
      domains: DOMAIN,
      qualityScore: 95,
      extractionJson,
    }),
    false,
  );
});

test("holds a healthcare or evidence failure for review", () => {
  const extractionJson = baseExtraction();
  extractionJson._meta = {
    verification: {
      review_reasons: [
        "Unsupported healthcare claim: the record states harm the source does not show.",
      ],
      publication: { decision: "hold", hold_reasons: ["Unsupported healthcare claim."] },
    },
  };
  const decision = applyPublicationDecision({
    qualityScore: 95,
    extractionJson,
    domains: DOMAIN,
  });
  assert.equal(decision, "hold");
  assert.equal(extractionJson.publication_status, "held");
  assert.equal(extractionJson.review_status, "pending");
  assert.equal(
    isRiskVisibleInMainList({
      domains: DOMAIN,
      qualityScore: 95,
      extractionJson,
    }),
    false,
  );
  assert.equal(
    isRiskInReviewQueue({
      domains: DOMAIN,
      qualityScore: 95,
      extractionJson,
    }),
    true,
  );
});

test("a retry output is held by the same gate", () => {
  const extractionJson = baseExtraction();
  extractionJson._meta = {
    verification: {
      publication: {
        decision: "hold",
        hold_reasons: ["Claim extends beyond the tasks tested in the source."],
      },
    },
  };
  assert.equal(
    applyPublicationDecision({
      qualityScore: 95,
      extractionJson,
      domains: DOMAIN,
    }),
    "hold",
  );
});
