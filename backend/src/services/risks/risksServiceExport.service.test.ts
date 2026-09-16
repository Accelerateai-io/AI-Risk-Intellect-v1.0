import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deriveTopCatalogMatch,
  toRiskExportItem,
} from "./risksServiceExport.service.js";

const richExtraction = {
  risk: {
    description: "Prompt-injection exfiltrates data via the assistant.",
    attack_vector: "Indirect prompt injection",
    risk_title: "Prompt injection",
  },
  review_status: "approved",
  review_reason: "internal-only note that must never leak",
  catalog_matches: [
    { riskId: "RISK-014", title: "Data exfiltration", accuracyPercent: 62 },
    { riskId: "RISK-091", title: "Prompt injection", accuracyPercent: 88 },
  ],
  prompt: "SECRET SYSTEM PROMPT — must never leak",
};

const richRow = {
  id: "11111111-1111-1111-1111-111111111111",
  riskTitle: "Prompt injection",
  domains: "Security & Data Protection",
  primaryRisk: "Data exfiltration",
  sector: "Financial Services",
  industry: "Banking",
  qualityScore: 91,
  extractionJson: richExtraction,
  articleUrl: "https://example.com/incident",
  articleTitle: "AI assistant leaked records",
  articleCreatedAt: new Date("2026-05-01T00:00:00.000Z"),
};

describe("deriveTopCatalogMatch", () => {
  it("returns the highest-accuracy match regardless of array order", () => {
    const out = deriveTopCatalogMatch(richExtraction);
    assert.equal(out.id, "RISK-091");
    assert.equal(out.title, "Prompt injection");
  });

  it("returns nulls when there are no catalog matches", () => {
    assert.deepEqual(deriveTopCatalogMatch({ catalog_matches: [] }), {
      id: null,
      title: null,
    });
    assert.deepEqual(deriveTopCatalogMatch({}), { id: null, title: null });
    assert.deepEqual(deriveTopCatalogMatch(null), { id: null, title: null });
  });
});

describe("toRiskExportItem", () => {
  it("maps a rich record to the exact AI-Q contract fields", () => {
    const item = toRiskExportItem(richRow);
    assert.deepEqual(item, {
      id: "11111111-1111-1111-1111-111111111111",
      riskTitle: "Prompt injection",
      domain: "Security & Data Protection",
      qualityScore: 91,
      description: "Prompt-injection exfiltrates data via the assistant.",
      attackVector: "Indirect prompt injection",
      primaryRisk: "Data exfiltration",
      sector: "Financial Services",
      industry: "Banking",
      sourceUrl: "https://example.com/incident",
      articleTitle: "AI assistant leaked records",
      articleDate: null,
      ingestedAt: "2026-05-01T00:00:00.000Z",
      catalogMatchId: "RISK-091",
      catalogMatchTitle: "Prompt injection",
    });
  });

  it("never leaks internal extraction fields (prompt, review notes, raw json)", () => {
    const item = toRiskExportItem(richRow) as Record<string, unknown>;
    const keys = Object.keys(item);
    for (const forbidden of [
      "prompt",
      "review_status",
      "review_reason",
      "extractionJson",
      "extraction_json",
      "catalog_matches",
    ]) {
      assert.ok(!keys.includes(forbidden), `leaked field: ${forbidden}`);
    }
    assert.ok(!JSON.stringify(item).includes("SECRET SYSTEM PROMPT"));
    assert.ok(!JSON.stringify(item).includes("internal-only note"));
  });

  it("preserves nulls for a partial record", () => {
    const item = toRiskExportItem({
      id: "22222222-2222-2222-2222-222222222222",
      riskTitle: "Partial risk",
      domains: "Operational",
      primaryRisk: null,
      sector: null,
      industry: null,
      qualityScore: 74,
      extractionJson: { risk: { description: "Only a description." } },
      articleUrl: "https://example.com/partial",
      articleTitle: null,
      articleCreatedAt: null,
    });
    assert.equal(item.description, "Only a description.");
    assert.equal(item.attackVector, null);
    assert.equal(item.primaryRisk, null);
    assert.equal(item.sector, null);
    assert.equal(item.ingestedAt, null);
    assert.equal(item.catalogMatchId, null);
    assert.equal(item.articleDate, null);
  });

  it("is null-safe for a sparse record with empty extraction and no article", () => {
    const item = toRiskExportItem({
      id: "33333333-3333-3333-3333-333333333333",
      riskTitle: "Sparse risk",
      domains: null,
      primaryRisk: null,
      sector: null,
      industry: null,
      qualityScore: null,
      extractionJson: {},
      articleUrl: null,
      articleTitle: null,
      articleCreatedAt: null,
    });
    assert.equal(item.domain, null);
    assert.equal(item.qualityScore, null);
    assert.equal(item.description, null);
    assert.equal(item.sourceUrl, null);
    assert.equal(item.catalogMatchId, null);
    assert.equal(item.catalogMatchTitle, null);
    // id and title (NOT NULL columns) always survive
    assert.equal(item.id, "33333333-3333-3333-3333-333333333333");
    assert.equal(item.riskTitle, "Sparse risk");
  });
});
