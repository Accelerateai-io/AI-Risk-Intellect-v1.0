import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EXTRACTION_SECONDARY_RISKS,
  SECONDARY_RISK_MAP,
  normalizeRiskLabel,
  primaryAlignmentScore,
  secondaryAlignmentScore,
  splitCatalogRiskList,
  taxonomyAlignmentScore,
} from "./riskTaxonomyMap.js";

// Every distinct secondary label observed in risk_mappings (June 2026 dump).
const CATALOG_SECONDARY_VALUES = [
  "Security Risk; Data Risk",
  "Security Risk; Privacy Risk",
  "Compliance/Regulatory Risk",
  "Operational Risk; Compliance/Regulatory Risk",
  "Operational Risk",
  "Compliance/Regulatory Risk; Legal/Liability Risk",
  "Reputational Risk; Ethical Risk",
  "Reputational Risk; Strategic Risk",
  "Business/Financial Risk; Reputational Risk",
  "Data Risk; Security Risk",
  "Compliance/Regulatory Risk; Third-Party/Vendor Risk",
  "Reputational Risk",
];

describe("normalizeRiskLabel", () => {
  it("is case and punctuation insensitive", () => {
    assert.equal(
      normalizeRiskLabel("Technical/Performance Risk"),
      normalizeRiskLabel("technical performance risk"),
    );
  });

  it("treats singular and plural risk labels as equal", () => {
    assert.equal(
      normalizeRiskLabel("Technical Risks"),
      normalizeRiskLabel("Technical Risk"),
    );
  });

  it("handles null/empty input", () => {
    assert.equal(normalizeRiskLabel(null), "");
    assert.equal(normalizeRiskLabel("  "), "");
  });
});

describe("splitCatalogRiskList", () => {
  it("splits semicolon-separated values", () => {
    assert.deepEqual(splitCatalogRiskList("Security Risk; Data Risk"), [
      "Security Risk",
      "Data Risk",
    ]);
  });

  it("returns empty array for null", () => {
    assert.deepEqual(splitCatalogRiskList(null), []);
  });
});

describe("secondaryAlignmentScore", () => {
  it("scores exact matches 1.0 even inside a list", () => {
    assert.equal(
      secondaryAlignmentScore("Data Risk", "Security Risk; Data Risk"),
      1,
    );
  });

  it("maps Technical/Performance Risk to Operational Risk as equivalent", () => {
    assert.equal(
      secondaryAlignmentScore("Technical/Performance Risk", "Operational Risk"),
      0.8,
    );
  });

  it("maps Technical/Performance Risk to Security Risk; Data Risk as related", () => {
    assert.equal(
      secondaryAlignmentScore(
        "Technical/Performance Risk",
        "Security Risk; Data Risk",
      ),
      0.4,
    );
  });

  it("scores unrelated classes 0", () => {
    assert.equal(
      secondaryAlignmentScore("Strategic Risk", "Security Risk; Data Risk"),
      0,
    );
  });

  it("takes the best score across the catalog list", () => {
    // Privacy Risk: equivalent to Data Risk (0.8) beats related Security Risk (0.4).
    assert.equal(
      secondaryAlignmentScore("Privacy Risk", "Security Risk; Data Risk"),
      0.8,
    );
  });

  it("handles missing inputs", () => {
    assert.equal(secondaryAlignmentScore(null, "Security Risk"), 0);
    assert.equal(secondaryAlignmentScore("Security Risk", null), 0);
  });

  it("gives every extraction secondary a path to every observed catalog value or 0", () => {
    // Coverage: each extraction label must score > 0 against at least one
    // observed catalog value, otherwise the mapping leaves it unreachable.
    for (const extracted of EXTRACTION_SECONDARY_RISKS) {
      const best = Math.max(
        ...CATALOG_SECONDARY_VALUES.map((value) =>
          secondaryAlignmentScore(extracted, value),
        ),
      );
      assert.ok(
        best > 0,
        `extraction secondary "${extracted}" matches no catalog value`,
      );
    }
  });

  it("references only real catalog labels in the map", () => {
    const catalogLabels = new Set(
      CATALOG_SECONDARY_VALUES.flatMap((value) =>
        splitCatalogRiskList(value),
      ).map(normalizeRiskLabel),
    );
    for (const equivalence of Object.values(SECONDARY_RISK_MAP)) {
      for (const label of [...equivalence.equivalent, ...equivalence.related]) {
        assert.ok(
          catalogLabels.has(normalizeRiskLabel(label)),
          `mapped label "${label}" does not exist in catalog vocabulary`,
        );
      }
    }
  });
});

describe("primaryAlignmentScore", () => {
  it("scores exact matches 1.0 across plural forms", () => {
    assert.equal(primaryAlignmentScore("Technical Risks", "Technical Risks"), 1);
    assert.equal(primaryAlignmentScore("Technical Risk", "Technical Risks"), 1);
  });

  it("gives related categories partial credit", () => {
    assert.equal(
      primaryAlignmentScore("Business Risks", "Operational Risks"),
      0.4,
    );
    assert.equal(
      primaryAlignmentScore("Technical Risks", "Operational Risks"),
      0.4,
    );
  });

  it("scores Technical vs Business 0", () => {
    assert.equal(primaryAlignmentScore("Technical Risks", "Business Risks"), 0);
  });
});

describe("taxonomyAlignmentScore", () => {
  it("weights secondary over primary (0.4/0.6)", () => {
    const score = taxonomyAlignmentScore({
      primaryRisk: "Technical Risks",
      secondaryRisk: "Technical/Performance Risk",
      catalogPrimary: "Technical Risks",
      catalogSecondary: "Operational Risk",
    });
    assert.equal(score, 0.4 * 1 + 0.6 * 0.8);
  });

  it("returns 0 when nothing aligns", () => {
    assert.equal(
      taxonomyAlignmentScore({
        primaryRisk: "Technical Risks",
        secondaryRisk: "Strategic Risk",
        catalogPrimary: "Business Risks",
        catalogSecondary: "Security Risk; Data Risk",
      }),
      0,
    );
  });
});
