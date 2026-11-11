import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_LIMIT,
  DEFAULT_MIN_QUALITY,
  EXPORTABLE_REVIEW_STATUS,
  MAX_LIMIT,
  RISK_EXPORT_SCHEMA_VERSION,
  toRiskExportItem,
} from "./risksServiceExport.service.js";

/**
 * Contract guard for the AI-Q service-to-service export (B-7 PR1 did NOT touch
 * risksServiceExport.service.ts). If the frozen envelope constants or the
 * export item key set change, this test fails so the AI-Q client contract is
 * never altered unintentionally by paginating/streaming the admin endpoints.
 */

test("AI-Q export envelope constants are unchanged", () => {
  assert.equal(RISK_EXPORT_SCHEMA_VERSION, "1.0");
  assert.equal(MAX_LIMIT, 100);
  assert.equal(DEFAULT_LIMIT, 25);
  assert.equal(DEFAULT_MIN_QUALITY, 70);
  assert.equal(EXPORTABLE_REVIEW_STATUS, "approved");
});

test("AI-Q export item shape is unchanged (exact key set)", () => {
  const item = toRiskExportItem({
    id: "11111111-1111-1111-1111-111111111111",
    riskTitle: "Prompt injection",
    domains: "Privacy and Security",
    primaryRisk: "Data exfiltration",
    sector: "Financial Services",
    industry: "Banking",
    qualityScore: 91,
    extractionJson: {
      risk: {
        description: "Prompt-injection exfiltrates data.",
        attack_vector: "Indirect prompt injection",
      },
      review_status: "approved",
      catalog_matches: [{ riskId: "RISK-091", title: "Prompt injection" }],
    },
    articleUrl: "https://example.com/a",
    articleTitle: "Example",
    articleCreatedAt: new Date("2026-01-01T00:00:00Z"),
  });

  assert.deepEqual(
    Object.keys(item).sort(),
    [
      "articleDate",
      "articleTitle",
      "attackVector",
      "catalogMatchId",
      "catalogMatchTitle",
      "description",
      "domain",
      "id",
      "industry",
      "ingestedAt",
      "primaryRisk",
      "qualityScore",
      "riskTitle",
      "sector",
      "sourceUrl",
    ],
    "AI-Q export item keys must not change",
  );

  // articleDate is always null (RI has no publication date) — part of the contract.
  assert.equal(item.articleDate, null);
});
