/**
 * Force full re-extraction of every article that has risks, using the
 * current prompt/model, with review state preserved (riskReviewState.ts).
 *
 * REQUIRES the Python extraction service to be running (npm run py:dev).
 * Sequential and resumable: risks already stamped `_reextracted_at` are
 * skipped, so the script can be stopped and re-run in chunks. Budget
 * ~35-70s per article (extraction + embedding + judge); a full 1,700-article
 * corpus is a 16-32h job — run it in chunks with --limit.
 *
 * Usage: npm run reextract:all [-- --limit 200] [--start-after <articleId>]
 *        [--dry-run] [--sleep-ms 2000] [--force]
 *   --force re-extracts articles even when already stamped.
 */
import { asc, eq, sql } from "drizzle-orm";
import { db, pool } from "../database/db.js";
import { articles } from "../schema/articles/articles.js";
import { risks } from "../schema/risks/risks.js";
import { extractRiskForArticle } from "../services/worker/extractRisk.service.js";

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index !== -1 ? (process.argv[index + 1] ?? null) : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const limit = Number(argValue("--limit")) || Infinity;
  const startAfter = Number(argValue("--start-after")) || 0;
  const dryRun = process.argv.includes("--dry-run");
  const force = process.argv.includes("--force");
  const sleepMs = Number(argValue("--sleep-ms")) || 2000;

  // Articles that have at least one risk, with a flag for whether every one
  // of their risks was already re-extracted (resume marker).
  const rows = await db
    .select({
      articleId: risks.articleId,
      total: sql<number>`count(*)`,
      reextracted: sql<number>`count(*) filter (where ${risks.extractionJson} ->> '_reextracted_at' is not null)`,
    })
    .from(risks)
    .innerJoin(articles, eq(risks.articleId, articles.id))
    .groupBy(risks.articleId)
    .orderBy(asc(risks.articleId));

  const pending = rows.filter(
    (row) =>
      row.articleId > startAfter &&
      (force || Number(row.reextracted) < Number(row.total)),
  );

  console.log(
    `Articles with risks: ${rows.length}; pending re-extraction: ${pending.length}` +
      `${Number.isFinite(limit) ? `; limited to ${limit}` : ""}`,
  );
  if (dryRun) {
    console.log(
      "Dry run — first pending article ids:",
      pending.slice(0, 20).map((r) => r.articleId),
    );
    await pool.end();
    process.exit(0);
  }

  let done = 0;
  let skippedByExtractor = 0;
  let errors = 0;
  const startedAt = Date.now();

  for (const row of pending) {
    if (done + skippedByExtractor + errors >= limit) break;
    try {
      const result = await extractRiskForArticle(row.articleId, {
        forceReextract: true,
      });
      if (result.outcome === "done") {
        done += 1;
      } else {
        skippedByExtractor += 1;
        console.log(`article ${row.articleId}: skipped (${result.reason})`);
      }
    } catch (err) {
      errors += 1;
      console.error(
        `article ${row.articleId}: failed —`,
        (err as Error)?.message ?? err,
      );
    }

    const total = done + skippedByExtractor + errors;
    if (total % 25 === 0) {
      const elapsedMin = (Date.now() - startedAt) / 60000;
      const rate = total / Math.max(elapsedMin, 0.01);
      console.log(
        `Progress: ${total} processed (${done} ok, ${skippedByExtractor} skipped, ${errors} errors); ` +
          `${rate.toFixed(1)} articles/min; last article id ${row.articleId}`,
      );
    }
    if (sleepMs > 0) await sleep(sleepMs);
  }

  console.log(
    `Done. Re-extracted ${done}, skipped ${skippedByExtractor}, errors ${errors}. ` +
      `Resume with: npm run reextract:all -- --start-after <last article id>`,
  );
  await pool.end();
  process.exit(errors > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("reextractAllArticles failed:", err);
  await pool.end();
  process.exit(1);
});
