/**
 * Re-score catalog matches for existing risks using the current scoring
 * pipeline (evidence signals + embeddings + optional judge) WITHOUT
 * re-running LLM extraction. Review state is untouched: only the
 * `catalog_matches` key (and the risk's stored embedding) is refreshed.
 *
 * Run AFTER backfill:catalog-embeddings. ~1s (embed) + ~4s (judge) per risk;
 * pass --no-judge for a fast heuristic-only pass.
 *
 * Usage: npm run backfill:matches [-- --limit 100] [--no-judge] [--dry-run]
 *        [--force] [--sleep-ms 250]
 *   --force re-scores rows that already have new-style match scores.
 */
import { count, eq } from "drizzle-orm";
import { db, pool } from "../database/db.js";
import { risks } from "../schema/risks/risks.js";
import { riskMappingEmbeddings } from "../schema/riskMappings/riskMappingEmbeddings.js";
import {
  extractMatchSignalsFromExtraction,
  findCatalogRiskMatches,
  mergeCatalogMatchesIntoExtraction,
  parseCatalogMatchesFromExtraction,
} from "../services/risks/riskCatalogMatch.service.js";
import { embedText, embeddingTextHash } from "../services/aws/bedrockEmbeddings.service.js";
import {
  buildRiskEmbeddingText,
  getRiskEmbedding,
  upsertRiskEmbedding,
} from "../services/risks/riskEmbedding.service.js";
import {
  isJudgeEnabled,
  judgeAndApplyVerdicts,
} from "../services/risks/riskMatchJudge.service.js";

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index !== -1 ? (process.argv[index + 1] ?? null) : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function storedDomainConfidence(extractionJson: unknown): number | undefined {
  const ext = (extractionJson ?? {}) as {
    domain_resolution?: { confidence?: unknown };
  };
  const raw = Number(ext.domain_resolution?.confidence);
  if (!Number.isFinite(raw)) return undefined;
  // Stored as 0-100 integer at extraction time.
  return Math.max(0, Math.min(1, raw / 100));
}

async function main() {
  const limit = Number(argValue("--limit")) || Infinity;
  const dryRun = process.argv.includes("--dry-run");
  const force = process.argv.includes("--force");
  const useJudge = !process.argv.includes("--no-judge") && isJudgeEnabled();
  const sleepMs = Number(argValue("--sleep-ms")) || 250;

  const rows = await db
    .select({
      id: risks.id,
      riskTitle: risks.riskTitle,
      domains: risks.domains,
      primaryRisk: risks.primaryRisk,
      secondaryRisk: risks.secondaryRisk,
      extractionJson: risks.extractionJson,
    })
    .from(risks)
    .orderBy(risks.createdAt);

  console.log(
    `Risks: ${rows.length}; judge: ${useJudge ? "on" : "off"}; dryRun: ${dryRun}`,
  );

  // Rollout-safety preflight (advisory only — does not change scoring): this
  // script relies on catalog embeddings. If they haven't been backfilled yet,
  // matching silently degrades to lexical and results will differ once the
  // embeddings exist. Warn loudly so the operator runs the steps in order.
  const [catalogEmbeddingCount] = await db
    .select({ n: count() })
    .from(riskMappingEmbeddings);
  if (Number(catalogEmbeddingCount?.n ?? 0) === 0) {
    console.warn(
      "WARNING: no catalog embeddings found (risk_mapping_embeddings is empty). " +
        "Matching will fall back to lexical scoring and re-scored results will " +
        "differ once embeddings exist. Run `npm run backfill:catalog-embeddings` first.",
    );
  }

  let processed = 0;
  let skipped = 0;
  let failedEmbeddings = 0;
  let failed = 0;

  for (const row of rows) {
    if (processed >= limit) break;

    try {
      const stored = parseCatalogMatchesFromExtraction(row.extractionJson);
      const alreadyRescored = stored?.some((m) => m.heuristicPercent != null);
      if (alreadyRescored && !force) {
        skipped += 1;
        continue;
      }

      const ext = (row.extractionJson ?? {}) as {
        risk?: Record<string, unknown>;
      };
      const description = String(
        ext.risk?.description ?? row.riskTitle ?? "",
      ).trim();
      const signals = extractMatchSignalsFromExtraction(row.extractionJson);

      // Reuse the stored embedding when the text is unchanged.
      const embeddingText = buildRiskEmbeddingText(
        row.riskTitle,
        description || row.riskTitle,
      );
      const textHash = embeddingTextHash(embeddingText);
      const storedEmbedding = await getRiskEmbedding(row.id);
      let riskEmbedding =
        storedEmbedding?.textHash === textHash ? storedEmbedding.embedding : null;
      if (!riskEmbedding) {
        riskEmbedding = await embedText(embeddingText);
        if (riskEmbedding && !dryRun) {
          await upsertRiskEmbedding({
            riskId: row.id,
            embedding: riskEmbedding,
            text: embeddingText,
          });
        }
      }
      if (!riskEmbedding) failedEmbeddings += 1;

      let matches = await findCatalogRiskMatches({
        domain: row.domains ?? "",
        title: row.riskTitle,
        description: description || row.riskTitle,
        primaryRisk: row.primaryRisk ?? undefined,
        secondaryRisk: row.secondaryRisk ?? undefined,
        domainConfidence: storedDomainConfidence(row.extractionJson) ?? 1,
        keywordMatches: signals.keywordMatches,
        evidenceExcerpts: signals.evidenceExcerpts,
        riskEmbedding,
        evidenceStrengthScore: signals.evidenceStrengthScore,
        limit: 5,
      });

      if (useJudge && matches.length > 0) {
        matches = await judgeAndApplyVerdicts(matches, {
          title: row.riskTitle,
          description: description || row.riskTitle,
          domain: row.domains,
          primaryRisk: row.primaryRisk,
          secondaryRisk: row.secondaryRisk,
          keywordMatches: signals.keywordMatches,
        });
      }

      if (!dryRun) {
        // Merge into the existing object: review state and every other key
        // in extraction_json stay untouched.
        const updated = mergeCatalogMatchesIntoExtraction(
          (row.extractionJson ?? {}) as Record<string, unknown>,
          matches,
        );
        await db
          .update(risks)
          .set({ extractionJson: updated, updatedAt: new Date() })
          .where(eq(risks.id, row.id));
      }

      processed += 1;
      if (processed % 50 === 0) {
        console.log(
          `Re-scored ${processed} risks (skipped: ${skipped}, embed failures: ${failedEmbeddings}, failed: ${failed})`,
        );
      }
    } catch (err) {
      // Isolate per-record failures: one bad risk must not abort the whole
      // backfill. Log it and continue; the record keeps its existing matches.
      failed += 1;
      console.error(
        `backfillRiskMatches: failed to re-score risk ${row.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
    if (sleepMs > 0) await sleep(sleepMs);
  }

  console.log(
    `Done. Re-scored ${processed}, skipped ${skipped} (already re-scored), embedding failures ${failedEmbeddings}, failed ${failed}.`,
  );
  await pool.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("backfillRiskMatches failed:", err);
  await pool.end();
  process.exit(1);
});
