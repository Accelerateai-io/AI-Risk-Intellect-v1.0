import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isNonEnglishRisk,
  needsHumanReview,
  needsQualityReview,
} from "./riskQuality.js";
import {
  isRiskInReviewQueue,
  isRiskVisibleInMainList,
} from "./risks.service.js";

test("isNonEnglishRisk detects stored non-English flags", () => {
  assert.equal(isNonEnglishRisk({ is_non_english: true }), true);
  assert.equal(isNonEnglishRisk({ source_language: "fr" }), true);
  assert.equal(isNonEnglishRisk({ source_language: "en" }), false);
  assert.equal(isNonEnglishRisk({ source_language: "en-us" }), false);
  assert.equal(isNonEnglishRisk({}), false);
});

test("needsHumanReview routes high-quality non-English risks to review", () => {
  const highQualityNonEnglish = {
    domains: "discrimination",
    qualityScore: 95,
    extractionJson: {
      is_non_english: true,
      source_language: "de",
      risk: { domains: "discrimination" },
    },
  };

  assert.equal(needsQualityReview(highQualityNonEnglish), false);
  assert.equal(needsHumanReview(highQualityNonEnglish), true);
  assert.equal(isRiskVisibleInMainList(highQualityNonEnglish), false);
  assert.equal(isRiskInReviewQueue(highQualityNonEnglish), true);
});

test("needsHumanReview keeps high-quality English risks on main list", () => {
  const highQualityEnglish = {
    domains: "discrimination",
    qualityScore: 95,
    extractionJson: {
      source_language: "en",
      risk: { domains: "discrimination" },
    },
  };

  assert.equal(needsHumanReview(highQualityEnglish), false);
  assert.equal(isRiskVisibleInMainList(highQualityEnglish), true);
  assert.equal(isRiskInReviewQueue(highQualityEnglish), false);
});
