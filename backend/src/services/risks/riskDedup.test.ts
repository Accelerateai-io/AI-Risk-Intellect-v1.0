import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  findDuplicateAmongRows,
  getDedupThreshold,
  type DedupCandidateRow,
} from "./riskDedup.service.js";

function row(overrides: Partial<DedupCandidateRow> = {}): DedupCandidateRow {
  return {
    riskId: "risk-1",
    articleId: 1,
    domains: "Misinformation",
    embedding: [1, 0, 0],
    ...overrides,
  };
}

describe("getDedupThreshold", () => {
  it("defaults to 0.92 and honours a valid env override", () => {
    delete process.env.RISK_DEDUP_THRESHOLD;
    assert.equal(getDedupThreshold(), 0.92);
    process.env.RISK_DEDUP_THRESHOLD = "0.85";
    try {
      assert.equal(getDedupThreshold(), 0.85);
    } finally {
      delete process.env.RISK_DEDUP_THRESHOLD;
    }
  });

  it("ignores invalid env values", () => {
    process.env.RISK_DEDUP_THRESHOLD = "nonsense";
    try {
      assert.equal(getDedupThreshold(), 0.92);
    } finally {
      delete process.env.RISK_DEDUP_THRESHOLD;
    }
  });
});

describe("findDuplicateAmongRows", () => {
  it("flags an identical same-domain embedding", () => {
    const hit = findDuplicateAmongRows({
      embedding: [1, 0, 0],
      domain: "Misinformation",
      rows: [row()],
    });
    assert.ok(hit);
    assert.equal(hit.riskId, "risk-1");
    assert.ok(hit.similarity > 0.99);
  });

  it("ignores rows below the threshold", () => {
    const hit = findDuplicateAmongRows({
      embedding: [1, 0, 0],
      domain: "Misinformation",
      rows: [row({ embedding: [0, 1, 0] })],
    });
    assert.equal(hit, null);
  });

  it("filters by domain when the new risk has one", () => {
    const hit = findDuplicateAmongRows({
      embedding: [1, 0, 0],
      domain: "Privacy and Security",
      rows: [row({ domains: "Misinformation" })],
    });
    assert.equal(hit, null);
  });

  it("compares across all domains when the new risk has none", () => {
    const hit = findDuplicateAmongRows({
      embedding: [1, 0, 0],
      domain: null,
      rows: [row({ domains: "Misinformation" })],
    });
    assert.ok(hit);
  });

  it("excludes the risk's own article", () => {
    const hit = findDuplicateAmongRows({
      embedding: [1, 0, 0],
      domain: "Misinformation",
      excludeArticleId: 1,
      rows: [row({ articleId: 1 })],
    });
    assert.equal(hit, null);
  });

  it("returns the most similar duplicate when several qualify", () => {
    const hit = findDuplicateAmongRows({
      embedding: [1, 0, 0],
      domain: "Misinformation",
      threshold: 0.9,
      rows: [
        row({ riskId: "risk-a", embedding: [0.95, 0.05, 0] }),
        row({ riskId: "risk-b", embedding: [1, 0, 0] }),
      ],
    });
    assert.ok(hit);
    assert.equal(hit.riskId, "risk-b");
  });
});
