import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isNonEnglishRisk,
  needsHumanReview,
  needsQualityReview,
  resolveReviewWhy,
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

test("needsQualityReview excludes exactly 0.90 and includes scores below it", () => {
  assert.equal(
    needsQualityReview({ qualityScore: 90, extractionJson: {} }),
    false,
  );
  assert.equal(
    needsQualityReview({ qualityScore: 89, extractionJson: {} }),
    true,
  );
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

test("needsHumanReview flags semantic duplicates regardless of quality", () => {
  const duplicate = {
    qualityScore: 95,
    extractionJson: {
      source_language: "en",
      dedup: { duplicate_of_risk_id: "abc", similarity: 0.97 },
    },
  };
  assert.equal(needsHumanReview(duplicate), true);
});

test("resolveReviewWhy returns a one-word label for each gate", () => {
  assert.equal(
    resolveReviewWhy({
      qualityScore: 95,
      extractionJson: { is_non_english: true, source_language: "de" },
    }).label,
    "Language",
  );
  assert.equal(
    resolveReviewWhy({
      qualityScore: 95,
      extractionJson: { dedup: { duplicate_of_risk_id: "abc" } },
    }).label,
    "Duplicate",
  );
  assert.equal(
    resolveReviewWhy({
      qualityScore: 95,
      extractionJson: { catalog_matches: [{ judgeVerdict: "no_match" }] },
    }).label,
    "Catalog",
  );
  assert.equal(
    resolveReviewWhy({ qualityScore: 80, extractionJson: {} }).label,
    "Quality",
  );
  assert.equal(
    resolveReviewWhy({
      qualityScore: 95,
      domains: "not-a-taxonomy-domain",
      extractionJson: { source_language: "en" },
    }).label,
    "Domain",
  );
});

test("needsHumanReview flags judge-rejected top matches", () => {
  const judged = {
    qualityScore: 95,
    extractionJson: {
      source_language: "en",
      catalog_matches: [{ judgeVerdict: "no_match" }],
    },
  };
  assert.equal(needsHumanReview(judged), true);

  const matched = {
    qualityScore: 95,
    extractionJson: {
      source_language: "en",
      catalog_matches: [{ judgeVerdict: "match" }],
    },
  };
  assert.equal(needsHumanReview(matched), false);
});
