/**
 * Match-score distribution report: recomputes catalog matches for a random
 * sample of risks in two modes (lexical-only vs +embeddings) and prints
 * mean / stdev / decile histograms. Use it to verify scores actually
 * discriminate (baseline before this overhaul: top-1 mean 48.4, stdev 3.6)
 * and to calibrate EMBEDDING_SCORE_FLOOR/CEIL.
 *
 * Read-only: never writes to the database. Judge mode (--judge, applies to
 * at most 25 sampled risks) costs ~$0.005 per risk.
 *
 * Usage: npm run report:match-distribution [-- --sample 300] [--judge]
 */
import { pool, db } from "../database/db.js";
import { risks } from "../schema/risks/risks.js";
import {
  extractMatchSignalsFromExtraction,
  findCatalogRiskMatches,
} from "../services/risks/riskCatalogMatch.service.js";
import { embedText } from "../services/aws/bedrockEmbeddings.service.js";
import { buildRiskEmbeddingText } from "../services/risks/riskEmbedding.service.js";
import { judgeAndApplyVerdicts } from "../services/risks/riskMatchJudge.service.js";

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index !== -1 ? (process.argv[index + 1] ?? null) : null;
}

function stats(values: number[]): { mean: number; stdev: number } {
  if (values.length === 0) return { mean: 0, stdev: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(values.length - 1, 1);
  return { mean, stdev: Math.sqrt(variance) };
}

function printHistogram(name: string, values: number[]): void {
  const { mean, stdev } = stats(values);
  console.log(
    `\n${name}: n=${values.length} mean=${mean.toFixed(1)} stdev=${stdev.toFixed(1)} ` +
      `min=${Math.min(...values)} max=${Math.max(...values)}`,
  );
  const buckets = new Map<number, number>();
  for (const v of values) {
    const bucket = Math.min(90, Math.floor(v / 10) * 10);
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }
  for (let b = 0; b <= 90; b += 10) {
    const count = buckets.get(b) ?? 0;
    if (count === 0) continue;
    const bar = "#".repeat(Math.max(1, Math.round((count * 60) / values.length)));
    console.log(`  ${String(b).padStart(3)}-${b + 9}: ${bar} ${count}`);
  }
}

async function main() {
  const sampleSize = Number(argValue("--sample")) || 300;
  const withJudge = process.argv.includes("--judge");

  const rows = await db
    .select({
      id: risks.id,
      riskTitle: risks.riskTitle,
      domains: risks.domains,
      primaryRisk: risks.primaryRisk,
      secondaryRisk: risks.secondaryRisk,
      extractionJson: risks.extractionJson,
    })
    .from(risks);

  // Deterministic sample: sort by uuid and stride through the corpus.
  const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id));
  const stride = Math.max(1, Math.floor(sorted.length / sampleSize));
  const sample = sorted.filter((_, i) => i % stride === 0).slice(0, sampleSize);

  console.log(`Sampling ${sample.length} of ${rows.length} risks…`);

  const lexicalTop1: number[] = [];
  const embeddingTop1: number[] = [];
  const judgeTop1: number[] = [];
  let embeddingsUsed = 0;

  for (const [index, row] of sample.entries()) {
    const ext = (row.extractionJson ?? {}) as { risk?: Record<string, unknown> };
    const description = String(
      ext.risk?.description ?? row.riskTitle ?? "",
    ).trim();
    const signals = extractMatchSignalsFromExtraction(row.extractionJson);

    const base = {
      domain: row.domains ?? "",
      title: row.riskTitle,
      description: description || row.riskTitle,
      primaryRisk: row.primaryRisk ?? undefined,
      secondaryRisk: row.secondaryRisk ?? undefined,
      keywordMatches: signals.keywordMatches,
      evidenceExcerpts: signals.evidenceExcerpts,
      evidenceStrengthScore: signals.evidenceStrengthScore,
      limit: 5,
    };

    const lexical = await findCatalogRiskMatches({ ...base, riskEmbedding: null });
    if (lexical[0]) lexicalTop1.push(lexical[0].accuracyPercent);

    const riskEmbedding = await embedText(
      buildRiskEmbeddingText(row.riskTitle, description || row.riskTitle),
    );
    let semantic = lexical;
    if (riskEmbedding) {
      semantic = await findCatalogRiskMatches({ ...base, riskEmbedding });
      if (semantic[0]) {
        embeddingTop1.push(semantic[0].accuracyPercent);
        if (semantic[0].embeddingMatchPercent != null) embeddingsUsed += 1;
      }
    }

    if (withJudge && index < 25 && semantic.length > 0) {
      const judged = await judgeAndApplyVerdicts(semantic, {
        title: row.riskTitle,
        description: description || row.riskTitle,
        domain: row.domains,
        primaryRisk: row.primaryRisk,
        secondaryRisk: row.secondaryRisk,
        keywordMatches: signals.keywordMatches,
      });
      if (judged[0]) judgeTop1.push(judged[0].accuracyPercent);
    }

    if ((index + 1) % 50 === 0) console.log(`…${index + 1}/${sample.length}`);
  }

  printHistogram("Lexical top-1 accuracy %", lexicalTop1);
  if (embeddingTop1.length > 0) {
    printHistogram("Embedding top-1 accuracy %", embeddingTop1);
    console.log(
      `\nCandidates scored with catalog embeddings: ${embeddingsUsed}/${embeddingTop1.length} ` +
        `(low? run backfill:catalog-embeddings first)`,
    );
  } else {
    console.log(
      "\nNo embedding-mode results — Bedrock unavailable or embeddings not backfilled.",
    );
  }
  if (judgeTop1.length > 0) {
    printHistogram("Judge-adjusted top-1 accuracy % (subsample)", judgeTop1);
  }

  await pool.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("matchDistributionReport failed:", err);
  await pool.end();
  process.exit(1);
});
