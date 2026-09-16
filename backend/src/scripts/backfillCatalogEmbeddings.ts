/**
 * Backfill Titan embeddings for every `risk_mappings` row.
 *
 * Run FIRST after deploying migration 0040 — catalog matching degrades to
 * lexical scoring until these rows exist. Safe to re-run: rows whose text
 * hash is unchanged are skipped. Uses conservative concurrency (2) to stay
 * under Bedrock throttling limits; expect ~15-25 min for ~1,250 rows.
 *
 * Note: running API/worker processes see the new embeddings within 5 minutes
 * (catalog cache TTL).
 *
 * Usage: npm run backfill:catalog-embeddings [-- --dry-run]
 */
import { eq } from "drizzle-orm";
import { db, pool } from "../database/db.js";
import { riskMappings } from "../schema/riskMappings/riskMappings.js";
import { riskMappingEmbeddings } from "../schema/riskMappings/riskMappingEmbeddings.js";
import {
  EMBEDDING_DIMS,
  EMBEDDING_MODEL_ID,
  embedTexts,
  embeddingTextHash,
} from "../services/aws/bedrockEmbeddings.service.js";

const BATCH_SIZE = 20;
const CONCURRENCY = 2;

function catalogEmbeddingText(row: {
  riskTitle: string | null;
  description: string | null;
  executiveSummary: string | null;
}): string {
  return [row.riskTitle ?? "", row.description ?? "", row.executiveSummary ?? ""]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const rows = await db
    .select({
      riskMappingId: riskMappings.riskMappingId,
      riskTitle: riskMappings.riskTitle,
      description: riskMappings.description,
      executiveSummary: riskMappings.executiveSummary,
    })
    .from(riskMappings);

  const existing = await db
    .select({
      riskMappingId: riskMappingEmbeddings.riskMappingId,
      textHash: riskMappingEmbeddings.textHash,
      model: riskMappingEmbeddings.model,
    })
    .from(riskMappingEmbeddings);
  const existingByid = new Map(existing.map((e) => [e.riskMappingId, e]));

  const pending = rows
    .map((row) => ({ row, text: catalogEmbeddingText(row) }))
    .filter(({ text }) => text.length > 0)
    .filter(({ row, text }) => {
      const current = existingByid.get(row.riskMappingId);
      return (
        !current ||
        current.textHash !== embeddingTextHash(text) ||
        current.model !== EMBEDDING_MODEL_ID
      );
    });

  console.log(
    `Catalog rows: ${rows.length}; up to date: ${rows.length - pending.length}; to embed: ${pending.length}`,
  );
  if (dryRun || pending.length === 0) {
    await pool.end();
    process.exit(0);
  }

  let done = 0;
  let failed = 0;
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    const embeddings = await embedTexts(
      batch.map((b) => b.text),
      { concurrency: CONCURRENCY },
    );
    for (let j = 0; j < batch.length; j += 1) {
      const embedding = embeddings[j];
      const { row, text } = batch[j];
      if (!embedding) {
        failed += 1;
        continue;
      }
      const values = {
        riskMappingId: row.riskMappingId,
        model: EMBEDDING_MODEL_ID,
        dims: EMBEDDING_DIMS,
        textHash: embeddingTextHash(text),
        embedding,
      };
      await db
        .insert(riskMappingEmbeddings)
        .values(values)
        .onConflictDoUpdate({
          target: riskMappingEmbeddings.riskMappingId,
          set: values,
        });
      done += 1;
    }
    if (done % 100 < BATCH_SIZE) {
      console.log(`Embedded ${done}/${pending.length} (failed: ${failed})`);
    }
  }

  console.log(`Done. Embedded ${done}, failed ${failed} of ${pending.length}.`);
  if (failed > 0) {
    console.log("Failed rows can be retried by re-running this script.");
  }
  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("backfillCatalogEmbeddings failed:", err);
  await pool.end();
  process.exit(1);
});
