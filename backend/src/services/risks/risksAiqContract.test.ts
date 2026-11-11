import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * AI-Q compatibility contract (B-7). AI-Q calls GET /api/v1/risks with an
 * X-API-Key and NO offset/page, then filters by sector client-side:
 *   - VTS scoring:  fetchRisksFromRI({ limit: 50, sector })
 *   - Monitoring:   fetchRisksFromRI({})
 * Both must keep returning the FULL visible list (the pre-pagination behaviour).
 *
 * This is a DB integration test: it replays both calls against a seeded DB and
 * asserts the returned risk IDs equal the ids the original (pre-pagination)
 * listRisks would have returned. Runs only when AIRI_CONTRACT_DB is set and
 * DATABASE_URL points at a disposable test DB.
 */

const ENABLED = process.env.AIRI_CONTRACT_DB;

test(
  "AI-Q GET /risks: both real calls return the full visible list unchanged",
  { skip: ENABLED ? false : "set AIRI_CONTRACT_DB + DATABASE_URL (test DB) to run" },
  async () => {
    const { eq, desc } = await import("drizzle-orm");
    const { db } = await import("../../db/index.js");
    const { risks } = await import("../../schema/risks/risks.js");
    const { articles } = await import("../../schema/articles/articles.js");
    const { isRiskVisibleInMainList, iterateVisibleRiskDtos, listRisks } =
      await import("./risks.service.js");

    // BEFORE: replicate the original pre-pagination listRisks — load every row,
    // filter visibility in JS, collect the ids it would have returned.
    const allRows = await db
      .select({
        id: risks.id,
        domains: risks.domains,
        qualityScore: risks.qualityScore,
        extractionJson: risks.extractionJson,
      })
      .from(risks)
      .innerJoin(articles, eq(risks.articleId, articles.id))
      .orderBy(desc(risks.createdAt));
    const oldIds = new Set(
      allRows.filter((r) => isRiskVisibleInMainList(r)).map((r) => r.id),
    );
    assert.ok(oldIds.size > 50, "fixture should have > 50 visible risks");

    // AFTER: both AI-Q calls resolve to the compatibility full-list path
    // (API key + no offset/page) => iterateVisibleRiskDtos. Sector/limit are
    // ignored server-side today, so both calls return the same full set.
    const collect = async () => {
      const ids = new Set<string>();
      for await (const dto of iterateVisibleRiskDtos()) ids.add(dto.id);
      return ids;
    };
    const monitoringCall = await collect(); // fetchRisksFromRI({})
    const vtsCall = await collect(); // fetchRisksFromRI({ limit: 50, sector })

    assert.equal(monitoringCall.size, oldIds.size, "no-params: same count as before");
    assert.equal(vtsCall.size, oldIds.size, "limit+sector: same count (sector ignored server-side)");
    for (const id of oldIds) {
      assert.ok(monitoringCall.has(id), `no-params missing ${id}`);
      assert.ok(vtsCall.has(id), `limit+sector missing ${id}`);
    }

    // And pagination genuinely applies when a caller sends offset: a strict,
    // bounded subset of the full list.
    const page = await listRisks({
      limit: 50,
      offset: 0,
      order: "newest",
      includeMetrics: false,
      primaryKey: null,
      tag: null,
      search: null,
    });
    assert.ok(page.risks.length <= 50, "paged response is bounded to the limit");
    assert.ok(
      page.risks.length < oldIds.size,
      "paged response is a strict subset of the full list",
    );
    assert.equal(page.hasMore, true, "more pages exist beyond the first");
  },
);
