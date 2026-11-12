import assert from "node:assert/strict";
import { test } from "node:test";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { risks } from "../../schema/risks/risks.js";
import {
  buildRiskDisplayIdMap,
  riskIngestSequenceSql,
} from "./riskSequence.js";

test("ingest sequence ranks each risk by created time then id", () => {
  const map = buildRiskDisplayIdMap([
    { id: "b", createdAt: new Date("2026-01-02T00:00:00Z") },
    { id: "a", createdAt: new Date("2026-01-01T00:00:00Z") },
    { id: "c", createdAt: new Date("2026-01-02T00:00:00Z") },
  ]);
  assert.equal(map.get("a"), "R-1");
  assert.equal(map.get("b"), "R-2");
  assert.equal(map.get("c"), "R-3");
});

test("page sequence SQL compares against the outer risk row", () => {
  const db = drizzle({} as never);
  const query = db
    .select({ id: risks.id, seq: riskIngestSequenceSql() })
    .from(risks)
    .where(inArray(risks.id, ["11111111-1111-1111-1111-111111111111"]));
  const rendered = query.toSQL().sql;

  assert.match(rendered, /earlier\.created_at < "risks"\."created_at"/);
  assert.match(rendered, /earlier\.id <= "risks"\."id"/);
  assert.doesNotMatch(
    rendered,
    /earlier\.created_at < "created_at"/,
  );
});
