import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildEvidenceTokenWeights,
  evidenceGateMultiplier,
  parseCatalogMatchesFromExtraction,
  scaledEmbeddingScore,
  scoreCatalogRow,
  weightedOverlapCoefficient,
  type ScoreCatalogRowInput,
} from "./riskCatalogMatch.service.js";

function tokenSet(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/\s+/).filter(Boolean));
}

describe("buildEvidenceTokenWeights", () => {
  it("weights keywords over excerpts over base text", () => {
    const weights = buildEvidenceTokenWeights({
      title: "model hallucination",
      description: "outputs fabricated citations",
      keywordMatches: ["hallucination"],
      evidenceExcerpts: ["fabricated legal citations"],
    });
    assert.equal(weights.get("hallucination"), 3);
    assert.equal(weights.get("fabricated"), 2);
    assert.equal(weights.get("outputs"), 1);
  });

  it("keeps the highest weight when a token appears at several levels", () => {
    const weights = buildEvidenceTokenWeights({
      title: "hallucination",
      description: "",
      keywordMatches: ["hallucination"],
      evidenceExcerpts: ["hallucination"],
    });
    assert.equal(weights.get("hallucination"), 3);
  });
});

describe("weightedOverlapCoefficient", () => {
  it("returns 1 when all evidence tokens appear in the catalog text", () => {
    const weights = new Map([
      ["hallucination", 3],
      ["citations", 1],
    ]);
    const catalog = tokenSet(
      "hallucination fabricated citations misinformation model outputs",
    );
    assert.equal(weightedOverlapCoefficient(weights, catalog), 1);
  });

  it("is not punished by long catalog texts (unlike Jaccard)", () => {
    const weights = new Map([["hallucination", 3]]);
    const longCatalog = tokenSet(
      "hallucination " + Array.from({ length: 200 }, (_, i) => `filler${i}`).join(" "),
    );
    assert.equal(weightedOverlapCoefficient(weights, longCatalog), 1);
  });

  it("returns 0 for empty inputs", () => {
    assert.equal(weightedOverlapCoefficient(new Map(), tokenSet("a b c")), 0);
    assert.equal(
      weightedOverlapCoefficient(new Map([["x", 1]]), new Set<string>()),
      0,
    );
  });

  it("clamps at 1 when catalog text is shorter than the evidence weight sum", () => {
    const weights = new Map([
      ["alpha", 3],
      ["beta", 3],
    ]);
    const catalog = tokenSet("alpha");
    const score = weightedOverlapCoefficient(weights, catalog);
    assert.ok(score <= 1);
    assert.ok(score > 0);
  });
});

describe("scaledEmbeddingScore", () => {
  it("clamps below the floor to 0", () => {
    assert.equal(scaledEmbeddingScore(0.1), 0);
  });

  it("clamps above the ceiling to 1", () => {
    assert.equal(scaledEmbeddingScore(0.95), 1);
  });

  it("rescales the midpoint linearly", () => {
    assert.ok(Math.abs(scaledEmbeddingScore(0.55) - 0.5) < 1e-9);
  });
});

describe("evidenceGateMultiplier", () => {
  it("returns 1 when disabled (default)", () => {
    delete process.env.MATCH_EVIDENCE_GATE_ENABLED;
    assert.equal(evidenceGateMultiplier(3), 1);
  });

  it("scales 0.8–1.0 when enabled", () => {
    process.env.MATCH_EVIDENCE_GATE_ENABLED = "true";
    try {
      assert.equal(evidenceGateMultiplier(0), 0.8);
      assert.equal(evidenceGateMultiplier(15), 1);
      assert.equal(evidenceGateMultiplier(null), 1);
    } finally {
      delete process.env.MATCH_EVIDENCE_GATE_ENABLED;
    }
  });
});

function baseScoreInput(
  overrides: Partial<ScoreCatalogRowInput> = {},
): ScoreCatalogRowInput {
  const title = "LLM hallucination produces fabricated legal citations";
  const description =
    "A large language model generated fabricated court citations in filings.";
  return {
    row: {
      riskTitle: "AI hallucination and fabricated outputs",
      domains: "Misinformation",
      description:
        "Language models produce hallucinated content including fabricated citations and false statements presented as fact.",
      executiveSummary: "Hallucination risks mislead users of AI systems.",
      primaryRisk: "Technical Risks",
      secondaryRisks: "Operational Risk",
      embedding: null,
    },
    extractedDomain: "Misinformation",
    extractedText: `${title} ${description}`,
    extractedTokens: new Set(
      `${title} ${description}`.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [],
    ),
    evidenceWeights: buildEvidenceTokenWeights({
      title,
      description,
      keywordMatches: ["hallucination", "fabricated"],
    }),
    domainConfidence: 1,
    primaryRisk: "Technical Risks",
    secondaryRisk: "Technical/Performance Risk",
    riskEmbedding: null,
    ...overrides,
  };
}

describe("scoreCatalogRow", () => {
  it("uses the lexical fallback when no embeddings are present", () => {
    const score = scoreCatalogRow(baseScoreInput());
    assert.equal(score.embeddingScore, null);
    assert.ok(score.accuracy > 0);
    assert.ok(score.evidenceScore > 0);
    // Taxonomy: primary exact (1.0) + secondary Technical/Performance→Operational (0.8)
    assert.ok(Math.abs(score.taxonomyScore - (0.4 * 1 + 0.6 * 0.8)) < 1e-9);
  });

  it("uses embedding-dominant weights when both embeddings exist", () => {
    // Identical vectors → cosine 1 → scaled 1.
    const vec = [0.6, 0.8];
    const withEmb = scoreCatalogRow(
      baseScoreInput({
        riskEmbedding: vec,
        row: { ...baseScoreInput().row, embedding: vec },
      }),
    );
    assert.equal(withEmb.embeddingScore, 1);
    const withoutEmb = scoreCatalogRow(baseScoreInput());
    assert.ok(withEmb.accuracy > withoutEmb.accuracy);
  });

  it("scales the domain component by domain confidence", () => {
    const confident = scoreCatalogRow(baseScoreInput({ domainConfidence: 1 }));
    const unsure = scoreCatalogRow(baseScoreInput({ domainConfidence: 0 }));
    assert.ok(confident.domainScore > unsure.domainScore);
    assert.equal(unsure.domainScore, confident.domainScore * 0.5);
  });

  it("no longer awards a flat domain constant to same-domain rows", () => {
    // A same-domain row with zero text/taxonomy overlap must score low.
    const score = scoreCatalogRow(
      baseScoreInput({
        row: {
          riskTitle: "Deepfake political disinformation campaigns",
          domains: "Misinformation",
          description: "Synthetic media used to impersonate politicians.",
          executiveSummary: "Election interference via generated video.",
          primaryRisk: "Business Risks",
          secondaryRisks: "Reputational Risk",
          embedding: null,
        },
      }),
    );
    // Old formula floored same-domain rows at 0.35; new one must not.
    assert.ok(score.accuracy < 0.35);
  });
});

describe("parseCatalogMatchesFromExtraction round-trip", () => {
  it("preserves the new additive fields", () => {
    const stored = {
      catalog_matches: [
        {
          riskId: "MAP-1",
          title: "T",
          description: "D",
          domain: "Misinformation",
          accuracyPercent: 71,
          domainMatchPercent: 90,
          descriptionMatchPercent: 64,
          matchSummary: "s",
          heuristicPercent: 58,
          embeddingMatchPercent: 64,
          evidenceMatchPercent: 41,
          taxonomyMatchPercent: 88,
          judgeVerdict: "match",
          judgeReasoning: "Same mechanism.",
        },
      ],
    };
    const parsed = parseCatalogMatchesFromExtraction(stored);
    assert.ok(parsed);
    assert.equal(parsed[0].heuristicPercent, 58);
    assert.equal(parsed[0].embeddingMatchPercent, 64);
    assert.equal(parsed[0].evidenceMatchPercent, 41);
    assert.equal(parsed[0].taxonomyMatchPercent, 88);
    assert.equal(parsed[0].judgeVerdict, "match");
    assert.equal(parsed[0].judgeReasoning, "Same mechanism.");
  });

  it("still parses legacy matches without the new fields", () => {
    const stored = {
      catalog_matches: [
        {
          riskId: "MAP-2",
          title: "T",
          description: "D",
          domain: "Misinformation",
          accuracyPercent: 44,
          domainMatchPercent: 100,
          descriptionMatchPercent: 14,
          matchSummary: "s",
        },
      ],
    };
    const parsed = parseCatalogMatchesFromExtraction(stored);
    assert.ok(parsed);
    assert.equal(parsed[0].accuracyPercent, 44);
    assert.equal(parsed[0].heuristicPercent, undefined);
    assert.equal(parsed[0].judgeVerdict, undefined);
  });

  it("rejects invalid judge verdict values", () => {
    const parsed = parseCatalogMatchesFromExtraction({
      catalog_matches: [
        {
          riskId: "MAP-3",
          title: "T",
          description: "D",
          domain: "X",
          accuracyPercent: 10,
          domainMatchPercent: 10,
          descriptionMatchPercent: 10,
          matchSummary: "s",
          judgeVerdict: "maybe",
        },
      ],
    });
    assert.ok(parsed);
    assert.equal(parsed[0].judgeVerdict, undefined);
  });
});
