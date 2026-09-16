/**
 * Backfill likelihood/impact scoring + AI product for risks analyzed before
 * the scoring columns existed.
 *
 * Two passes:
 *   1. Cheap pass (no LLM): promote scores already present in
 *      extraction_json.risk_scoring into the new columns.
 *   2. LLM pass: re-run extraction for articles whose risks still have no
 *      likelihood. Goes through extractRiskForArticle(), so results flow
 *      through the full validated prompt -> repair -> merge -> persist
 *      pipeline (the widened refresh condition persists the new scores).
 *
 * Run: npx tsx src/scripts/backfillRiskScoring.ts [--limit N] [--skip-llm]
 *   --limit N    max articles to re-extract in the LLM pass (default 25)
 *   --skip-llm   only run the cheap JSON-promotion pass
 *
 * Idempotent: rows are selected by `likelihood IS NULL`, so re-running only
 * touches rows that still lack scores.
 */
import "../bootstrap.js";
import { isNull, sql } from "drizzle-orm";
import { db, pool } from "../database/db.js";
import { risks } from "../schema/risks/risks.js";
import { extractRiskForArticle } from "../services/worker/extractRisk.service.js";
import {
  resolveRiskScoring,
} from "../services/risks/riskScoring.js";

function parseArgs(): { limit: number; skipLlm: boolean } {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf("--limit");
  const limit =
    limitIdx >= 0 && args[limitIdx + 1]
      ? Math.max(0, Number.parseInt(args[limitIdx + 1]!, 10) || 0)
      : 25;
  return { limit, skipLlm: args.includes("--skip-llm") };
}

/** Pass 1: promote scores stored in extraction_json into the columns. */
async function promoteFromJson(): Promise<number> {
  const rows = await db
    .select({
      id: risks.id,
      extractionJson: risks.extractionJson,
    })
    .from(risks)
    .where(isNull(risks.likelihood));

  let promoted = 0;
  for (const row of rows) {
    const ext = (row.extractionJson ?? {}) as {
      risk?: { ai_product_name?: unknown; ai_product_vendor?: unknown };
    };
    const scoring = resolveRiskScoring({
      likelihood: null,
      impact: null,
      extractionJson: row.extractionJson,
    });
    const productName =
      typeof ext.risk?.ai_product_name === "string" &&
      ext.risk.ai_product_name.trim()
        ? ext.risk.ai_product_name.trim()
        : null;
    const productVendor =
      productName != null &&
      typeof ext.risk?.ai_product_vendor === "string" &&
      ext.risk.ai_product_vendor.trim()
        ? ext.risk.ai_product_vendor.trim()
        : null;

    if (
      scoring.likelihood == null &&
      scoring.impact == null &&
      productName == null
    ) {
      continue;
    }

    await db
      .update(risks)
      .set({
        likelihood: scoring.likelihood,
        impact: scoring.impact,
        severityScore: scoring.severityScore,
        severityBand: scoring.severityBand,
        aiProductName: productName,
        aiProductVendor: productVendor,
        updatedAt: new Date(),
      })
      .where(sql`${risks.id} = ${row.id}`);
    promoted += 1;
  }
  return promoted;
}

/** Pass 2: re-extract articles whose risks still lack likelihood scores. */
async function reExtractMissing(limit: number): Promise<void> {
  const articleRows = await db
    .selectDistinct({ articleId: risks.articleId })
    .from(risks)
    .where(isNull(risks.likelihood))
    .limit(limit);

  console.log(`LLM pass: re-extracting ${articleRows.length} article(s) (limit ${limit})...`);
  let done = 0;
  let skipped = 0;
  for (const { articleId } of articleRows) {
    try {
      const result = await extractRiskForArticle(articleId);
      if (result.outcome === "done") {
        done += 1;
      } else {
        skipped += 1;
        console.warn(`  article ${articleId}: skipped (${result.reason})`);
      }
    } catch (err) {
      skipped += 1;
      console.error(`  article ${articleId}: failed`, err);
    }
  }
  console.log(`LLM pass complete: ${done} re-extracted, ${skipped} skipped/failed.`);
}

async function main() {
  const { limit, skipLlm } = parseArgs();

  console.log("Pass 1: promoting scores already present in extraction_json...");
  const promoted = await promoteFromJson();
  console.log(`Pass 1 complete: ${promoted} row(s) promoted without LLM calls.`);

  if (!skipLlm && limit > 0) {
    await reExtractMissing(limit);
  } else {
    console.log("Skipping LLM pass.");
  }

  const [remaining] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(risks)
    .where(isNull(risks.likelihood));
  console.log(`Remaining rows without likelihood: ${remaining?.count ?? "?"}.`);

  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
