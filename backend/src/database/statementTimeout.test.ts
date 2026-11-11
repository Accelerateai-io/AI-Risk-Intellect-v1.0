import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldApplyWebStatementTimeout } from "./db.js";

/**
 * The per-statement timeout must apply ONLY to the web request pool (B-7).
 * Scripts, migrations and the worker run legitimately long queries and are
 * detected by their entrypoint; PG_STATEMENT_TIMEOUT_MS=0 disables it entirely.
 */

test("applies to the web server entrypoint (dev + prod)", () => {
  assert.equal(
    shouldApplyWebStatementTimeout("/app/backend/src/server.ts", 30_000),
    true,
  );
  assert.equal(
    shouldApplyWebStatementTimeout("/app/backend/dist/server.js", 30_000),
    true,
  );
});

test("does NOT apply to scripts, migrations or the worker", () => {
  for (const entry of [
    "/app/backend/src/scripts/backfillRiskScoring.ts",
    "/app/backend/src/schema/migrate.ts",
    "/app/backend/src/workers/jobWorker.ts",
    "/app/backend/dist/scripts/resetDb.js",
  ]) {
    assert.equal(
      shouldApplyWebStatementTimeout(entry, 30_000),
      false,
      `${entry} must not be timed out`,
    );
  }
});

test("a zero/undefined timeout disables the guard even for the web server", () => {
  assert.equal(shouldApplyWebStatementTimeout("/x/server.ts", 0), false);
  assert.equal(shouldApplyWebStatementTimeout("/x/server.ts", -1), false);
  assert.equal(shouldApplyWebStatementTimeout(undefined, 30_000), false);
});
