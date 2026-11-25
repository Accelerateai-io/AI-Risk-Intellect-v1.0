import assert from "node:assert/strict";
import { test } from "node:test";
import {
  finalizeRiskPage,
  isFullListRequest,
  normalizeRiskListParams,
  riskRowMatchesFilters,
  sortRiskRecords,
  toLightRecord,
  type RiskFilterRow,
  type RiskLightRecord,
} from "./riskListQuery.js";

function lightRecords(n: number): RiskLightRecord[] {
  // createdAt ascending with index; index 0 is the oldest.
  return Array.from({ length: n }, (_, i) => ({
    id: `id-${String(i).padStart(4, "0")}`,
    createdAt: new Date(2026, 0, 1, 0, 0, i),
    severityScore: i % 25,
    quality100: i,
    primaryKey:
      i % 3 === 0 ? "technical" : i % 3 === 1 ? "operational" : "business",
  }));
}

function filterRow(overrides: Partial<RiskFilterRow> = {}): RiskFilterRow {
  return {
    id: "r1",
    createdAt: new Date(2026, 0, 1),
    domains: "AI System Safety, Failures, and Limitations",
    primaryRisk: "Technical Risks",
    secondaryRisk: "Performance",
    sector: "Public",
    industry: "Government",
    riskTitle: "Hallucination in government SLMs",
    articleTitle: "Making AI operational",
    articleUrl: "https://arxiv.org/abs/2602.13473",
    aiProductName: null,
    aiProductVendor: null,
    qualityScore: 95,
    severityScore: 12,
    extractionJson: {},
    ...overrides,
  };
}

test("finalizeRiskPage returns the right slice, total, hasMore and metrics", () => {
  const records = lightRecords(125);

  const firstPage = finalizeRiskPage(records, {
    limit: 50,
    offset: 0,
    order: "newest",
  });
  assert.equal(firstPage.pageRecords.length, 50);
  assert.equal(firstPage.total, 125);
  assert.equal(firstPage.hasMore, true);
  // newest first => the highest index (newest createdAt) leads.
  assert.equal(firstPage.pageRecords[0]!.id, "id-0124");
  assert.equal(firstPage.pageRecords.at(-1)!.id, "id-0075");
  // metrics count the full visible set, not just the page.
  assert.equal(firstPage.metrics.total, 125);
  assert.equal(
    firstPage.metrics.technical +
      firstPage.metrics.operational +
      firstPage.metrics.business,
    125,
  );

  const secondPage = finalizeRiskPage(records, {
    limit: 50,
    offset: 50,
    order: "newest",
  });
  assert.equal(secondPage.pageRecords[0]!.id, "id-0074");
  assert.equal(secondPage.hasMore, true);

  const lastPage = finalizeRiskPage(records, {
    limit: 50,
    offset: 100,
    order: "newest",
  });
  assert.equal(lastPage.pageRecords.length, 25);
  assert.equal(lastPage.hasMore, false);

  // No overlap and full coverage across the three pages.
  const ids = new Set(
    [
      ...firstPage.pageRecords,
      ...secondPage.pageRecords,
      ...lastPage.pageRecords,
    ].map((r) => r.id),
  );
  assert.equal(ids.size, 125);
});

test("finalizeRiskPage with limit 0 returns metrics/total only (no rows)", () => {
  const res = finalizeRiskPage(lightRecords(40), {
    limit: 0,
    offset: 0,
    order: "newest",
  });
  assert.equal(res.pageRecords.length, 0);
  assert.equal(res.total, 40);
  assert.equal(res.hasMore, false);
  assert.equal(res.metrics.total, 40);
});

test("sortRiskRecords orders by newest/oldest/score/severity", () => {
  const records = lightRecords(5);
  assert.deepEqual(
    sortRiskRecords(records, "oldest").map((r) => r.id),
    ["id-0000", "id-0001", "id-0002", "id-0003", "id-0004"],
  );
  assert.deepEqual(
    sortRiskRecords(records, "newest").map((r) => r.id),
    ["id-0004", "id-0003", "id-0002", "id-0001", "id-0000"],
  );
  // score desc (quality100 == index) => highest index first.
  assert.equal(sortRiskRecords(records, "score")[0]!.id, "id-0004");
  // severity desc (severityScore == index % 25) => index 4 first here.
  assert.equal(sortRiskRecords(records, "severity")[0]!.id, "id-0004");
});

test("sortRiskRecords puts null scores last", () => {
  const records: RiskLightRecord[] = [
    {
      id: "a",
      createdAt: new Date(2026, 0, 1),
      severityScore: null,
      quality100: null,
      primaryKey: "technical",
    },
    {
      id: "b",
      createdAt: new Date(2026, 0, 2),
      severityScore: 9,
      quality100: 80,
      primaryKey: "technical",
    },
  ];
  assert.equal(sortRiskRecords(records, "score")[0]!.id, "b");
  assert.equal(sortRiskRecords(records, "score").at(-1)!.id, "a");
  assert.equal(sortRiskRecords(records, "severity")[0]!.id, "b");
});

test("riskRowMatchesFilters applies primaryKey, tag and search", () => {
  const row = filterRow();
  // primaryKey
  assert.equal(
    riskRowMatchesFilters(row, { primaryKey: "technical", tag: null, search: null }),
    true,
  );
  assert.equal(
    riskRowMatchesFilters(row, { primaryKey: "business", tag: null, search: null }),
    false,
  );
  // tag (domain -> safety)
  assert.equal(
    riskRowMatchesFilters(row, { primaryKey: null, tag: "safety", search: null }),
    true,
  );
  assert.equal(
    riskRowMatchesFilters(row, { primaryKey: null, tag: "bias", search: null }),
    false,
  );
  // search (case-insensitive, across title/domain/sector/...)
  assert.equal(
    riskRowMatchesFilters(row, { primaryKey: null, tag: null, search: "hallucination" }),
    true,
  );
  assert.equal(
    riskRowMatchesFilters(row, { primaryKey: null, tag: null, search: "GOVERNMENT" }),
    true,
  );
  assert.equal(
    riskRowMatchesFilters(row, { primaryKey: null, tag: null, search: "2602.13473" }),
    true,
  );
  assert.equal(
    riskRowMatchesFilters(row, { primaryKey: null, tag: null, search: "no-such-term" }),
    false,
  );
  assert.equal(
    riskRowMatchesFilters(
      { ...row, displayId: "R-149" },
      { primaryKey: null, tag: null, search: "R-149" },
    ),
    true,
  );
  assert.equal(
    riskRowMatchesFilters(
      { ...row, displayId: "R-09" },
      { primaryKey: null, tag: null, search: "R-9" },
    ),
    true,
  );
  assert.equal(
    riskRowMatchesFilters(
      { ...row, displayId: "R-19" },
      { primaryKey: null, tag: null, search: "R-9" },
    ),
    false,
  );
  assert.equal(
    riskRowMatchesFilters(
      { ...row, displayId: "R-09" },
      { primaryKey: null, tag: null, search: "9" },
    ),
    true,
  );
  assert.equal(
    riskRowMatchesFilters(
      { ...row, displayId: "R-149" },
      { primaryKey: null, tag: null, search: "R-14" },
    ),
    false,
  );
  // null filters never exclude.
  assert.equal(
    riskRowMatchesFilters(row, { primaryKey: null, tag: null, search: null }),
    true,
  );
});

test("riskRowMatchesFilters falls back to extraction_json for domain/primary", () => {
  const row = filterRow({
    domains: null,
    primaryRisk: null,
    extractionJson: {
      risk: {
        domains: "Discrimination and Toxicity",
        primary_risk: "Business Risks",
      },
    },
  });
  assert.equal(
    riskRowMatchesFilters(row, { primaryKey: "business", tag: null, search: null }),
    true,
  );
  assert.equal(
    riskRowMatchesFilters(row, { primaryKey: null, tag: "bias", search: null }),
    true,
  );
});

test("toLightRecord resolves quality and primaryKey from the row", () => {
  const rec = toLightRecord(
    filterRow({ qualityScore: 88, severityScore: 7, primaryRisk: "Operational Risks" }),
  );
  assert.equal(rec.quality100, 88);
  assert.equal(rec.severityScore, 7);
  assert.equal(rec.primaryKey, "operational");
});

test("normalizeRiskListParams applies defaults, clamping and aliases", () => {
  const def = normalizeRiskListParams({});
  assert.equal(def.limit, 50);
  assert.equal(def.offset, 0);
  assert.equal(def.order, "newest");
  assert.equal(def.includeMetrics, true);
  assert.equal(def.primaryKey, null);
  assert.equal(def.tag, null);
  assert.equal(def.search, null);

  // limit clamps to 200; offset floors at 0; "all" -> null; includeMetrics="0" -> false.
  const clamped = normalizeRiskListParams({
    limit: "1000",
    offset: "-5",
    order: "severity",
    includeMetrics: "0",
    primaryKey: "all",
    tag: "bias",
    search: "  spaced  ",
  });
  assert.equal(clamped.limit, 200);
  assert.equal(clamped.offset, 0);
  assert.equal(clamped.order, "severity");
  assert.equal(clamped.includeMetrics, false);
  assert.equal(clamped.primaryKey, null);
  assert.equal(clamped.tag, "bias");
  assert.equal(clamped.search, "spaced");

  // limit 0 (metrics-only) is preserved; unknown order falls back to newest.
  const metricsOnly = normalizeRiskListParams({ limit: "0", order: "bogus" });
  assert.equal(metricsOnly.limit, 0);
  assert.equal(metricsOnly.order, "newest");
});

test("normalizeRiskListParams derives offset from page when offset absent", () => {
  assert.equal(normalizeRiskListParams({ page: "3", limit: "20" }).offset, 60);
  // explicit offset wins over page.
  assert.equal(
    normalizeRiskListParams({ page: "3", offset: "5", limit: "20" }).offset,
    5,
  );
  // page with no limit uses the default page size.
  assert.equal(normalizeRiskListParams({ page: "2" }).offset, 100);
});

test("isFullListRequest: AI-Q compatibility (API key, no offset/page)", () => {
  // AI-Q's two real calls: both omit offset/page → full list for API-key callers.
  assert.equal(isFullListRequest({ limit: "50", sector: "Public" }, true), true);
  assert.equal(isFullListRequest({}, true), true);
  // Any paging param (offset or page) opts into pagination.
  assert.equal(isFullListRequest({ offset: "0" }, true), false);
  assert.equal(isFullListRequest({ page: "1" }, true), false);
  // Empty paging values are treated as absent.
  assert.equal(isFullListRequest({ offset: "" }, true), true);
  // JWT (UI) callers are always paginated, even without offset/page.
  assert.equal(isFullListRequest({ limit: "50" }, false), false);
  assert.equal(isFullListRequest({}, false), false);
});
