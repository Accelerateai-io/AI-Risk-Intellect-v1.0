import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evidenceReviewReasons,
  hasEvidenceReviewReasons,
  isNonEnglishRisk,
  needsHumanReview,
  needsQualityReview,
  resolveReviewWhy,
  reviewQualityThreshold,
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

// TC-17: the review threshold is read from REVIEW_QUALITY_THRESHOLD, defaulting
// to 0.9 (no behaviour change when unset) (BUG-06).
test("reviewQualityThreshold is read from the environment (TC-17)", () => {
  const saved = process.env.REVIEW_QUALITY_THRESHOLD;
  try {
    delete process.env.REVIEW_QUALITY_THRESHOLD;
    assert.equal(reviewQualityThreshold(), 0.9);
    // A score of 0.85 needs review at the 0.9 default.
    assert.equal(
      needsQualityReview({ qualityScore: 85, extractionJson: {} }),
      true,
    );

    // Lowering the threshold via env changes routing at call time.
    process.env.REVIEW_QUALITY_THRESHOLD = "0.75";
    assert.equal(reviewQualityThreshold(), 0.75);
    assert.equal(
      needsQualityReview({ qualityScore: 85, extractionJson: {} }),
      false,
    );
    assert.equal(
      needsQualityReview({ qualityScore: 74, extractionJson: {} }),
      true,
    );

    // Invalid or out-of-range values fall back to the default.
    process.env.REVIEW_QUALITY_THRESHOLD = "not-a-number";
    assert.equal(reviewQualityThreshold(), 0.9);
    process.env.REVIEW_QUALITY_THRESHOLD = "2";
    assert.equal(reviewQualityThreshold(), 0.9);
  } finally {
    if (saved === undefined) delete process.env.REVIEW_QUALITY_THRESHOLD;
    else process.env.REVIEW_QUALITY_THRESHOLD = saved;
  }
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

test("evidenceReviewReasons reads _meta.verification.review_reasons", () => {
  const ext = {
    _meta: {
      verification: {
        review_reasons: [
          "Likelihood capped: evidence is hypothesized",
          "  ",
          "Likelihood capped: evidence is hypothesized",
          "Uncited likelihood_reasoning: no 5-word span found in the source (BUG-04 / TC-09)",
        ],
      },
    },
  };
  assert.deepEqual(evidenceReviewReasons(ext), [
    "Likelihood capped: evidence is hypothesized",
    "Uncited likelihood_reasoning: no 5-word span found in the source (BUG-04 / TC-09)",
  ]);
  assert.equal(hasEvidenceReviewReasons(ext), true);
  assert.equal(hasEvidenceReviewReasons({}), false);
  assert.equal(hasEvidenceReviewReasons({ _meta: { verification: {} } }), false);
});

test("needsHumanReview routes high-quality records with evidence reasons", () => {
  const grounded = {
    qualityScore: 95,
    extractionJson: {
      source_language: "en",
      risk: { domains: "discrimination" },
      _meta: {
        verification: {
          review_reasons: ["Likelihood capped: evidence is hypothesized"],
        },
      },
    },
  };
  assert.equal(needsQualityReview(grounded), false);
  assert.equal(needsHumanReview(grounded), true);
});

test("resolveReviewWhy surfaces the evidence reasons to the reviewer", () => {
  const why = resolveReviewWhy({
    qualityScore: 95,
    domains: "discrimination",
    extractionJson: {
      source_language: "en",
      risk: { domains: "discrimination" },
      _meta: {
        verification: {
          review_reasons: [
            "Likelihood capped: evidence is hypothesized",
            'Mitigation asserts absence from silence; the only allowed negative is "not described in source" (got: "none")',
          ],
        },
      },
    },
  });
  assert.equal(why.label, "Grounding");
  assert.ok(why.reason.includes("likelihood was kept at 2 or lower"));
  assert.ok(
    why.reason.includes(
      'A mitigation says a safeguard is missing ("none"), but the article does not say that.',
    ),
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
