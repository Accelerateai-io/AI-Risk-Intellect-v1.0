/**
 * AIRI side of the Evidence Bridge (spec v1.3, section 5).
 *
 * runEvidenceExport() looks at every supersedes_id chain, builds the Evidence
 * Record v1 for the chain's newest row, and appends a new version to the export
 * log only when the content changed (or a retraction when an exported record no
 * longer qualifies). The read functions serve the stored payloads in checkpoint
 * order for AI-Q to pull.
 */
import { and, asc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { db, pool } from "../../database/db.js";
import { createLogger } from "../../logger/index.js";
import { articles } from "../../schema/articles/articles.js";
import { evidenceExportLog } from "../../schema/evidence/evidenceExportLog.js";
import { risks } from "../../schema/risks/risks.js";
import { FACTS_V2_PIPELINE_VERSION, mapRiskRowToDto } from "../risks/riskDto.js";
import { buildRiskDisplayIdMap } from "../risks/riskSequence.js";
import {
  isoUtc,
  RETRACTION_REASON_REMOVED,
  toRetraction,
  type EvidenceRecordV1,
} from "./evidenceRecord.js";
import { buildChains, planRecord, type Chain, type LatestRow } from "./evidenceExportPlan.js";

const log = createLogger("evidence-export");

/** One writer at a time across all API instances. */
const EXPORT_LOCK_KEY = "airi_evidence_export";
const LOAD_CHUNK = 200;
const INSERT_CHUNK = 200;
export const EXPORT_PAGE_MAX = 500;

export type ExportRunSummary = {
  ran: boolean;
  skippedReason?: string;
  recordsConsidered: number;
  versionsWritten: number;
  retractionsWritten: number;
  latestCheckpoint: number;
  durationMs: number;
};

function documentHashFrom(sha: string | null | undefined): string | null {
  const v = (sha ?? "").trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(v) ? `sha256:${v}` : null;
}

export async function getLatestCheckpoint(): Promise<number> {
  const [row] = await db
    .select({ m: sql<string | null>`max(${evidenceExportLog.checkpoint})` })
    .from(evidenceExportLog);
  return Number(row?.m ?? 0);
}

const SKIPPED = (started: number, reason: string): ExportRunSummary => ({
  ran: false,
  skippedReason: reason,
  recordsConsidered: 0,
  versionsWritten: 0,
  retractionsWritten: 0,
  latestCheckpoint: -1,
  durationMs: Date.now() - started,
});

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * One export run. A session-level advisory lock is taken first, then a
 * REPEATABLE READ transaction, so the whole run sees one snapshot of AIRI that
 * already includes the previous run's export rows (checkpoints stay gap-free and
 * in commit order, and a reprocess landing mid-run can't cause a false retraction).
 */
export async function runEvidenceExport(now: Date = new Date()): Promise<ExportRunSummary> {
  const started = Date.now();
  const publishedAt = isoUtc(now)!;
  const client = await pool.connect();
  let locked = false;
  try {
    const lock = await client.query<{ ok: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS ok",
      [EXPORT_LOCK_KEY],
    );
    locked = lock.rows[0]?.ok === true;
    if (!locked) return SKIPPED(started, "another export run holds the lock");

    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    try {
      const summary = await exportInSnapshot(drizzle(client), publishedAt, started);
      await client.query("COMMIT");
      log.info("Evidence export run", summary);
      return summary;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    }
  } finally {
    if (locked) {
      await client
        .query("SELECT pg_advisory_unlock(hashtext($1))", [EXPORT_LOCK_KEY])
        .catch(() => undefined);
    }
    client.release();
  }
}

type Tx = NodePgDatabase<Record<string, never>>;

async function exportInSnapshot(
  tx: Tx,
  publishedAt: string,
  started: number,
): Promise<ExportRunSummary> {
  const chainRows = await tx
    .select({ id: risks.id, supersedesId: risks.supersedesId, createdAt: risks.createdAt })
    .from(risks);
  const chains = buildChains(chainRows);
  // Same created-time-then-id sequence the Risks table prints, without a per-row count query.
  const displayIds = buildRiskDisplayIdMap(chainRows);
  const createdAtById = new Map(chainRows.map((r) => [r.id, r.createdAt.getTime()]));

  const factsRows = await tx
    .select({ id: risks.id })
    .from(risks)
    .where(sql`${risks.extractionJson}->>'pipeline_version' = ${FACTS_V2_PIPELINE_VERSION}`);
  const factsIds = new Set(factsRows.map((r) => r.id));

  const lastRes = await tx.execute(
    sql`SELECT DISTINCT ON (record_id) record_id, payload FROM evidence_export_log ORDER BY record_id, version DESC`,
  );
  const lastByRecord = new Map<string, EvidenceRecordV1>();
  for (const r of lastRes.rows as { record_id: string; payload: EvidenceRecordV1 }[]) {
    lastByRecord.set(r.record_id, r.payload);
  }
  // A row exported before keeps its record_id even if its chain's first row was
  // deleted later (supersedes_id is ON DELETE SET NULL).
  const rowsRes = await tx.execute(
    sql`SELECT DISTINCT airi_row_id, record_id FROM evidence_export_log`,
  );
  const recordIdByRow = new Map<string, string>();
  for (const r of rowsRes.rows as { airi_row_id: string; record_id: string }[]) {
    recordIdByRow.set(r.airi_row_id, r.record_id);
  }

  const recordIdOf = (c: Chain): string =>
    c.rowIds.map((id) => recordIdByRow.get(id)).find((x): x is string => !!x) ?? c.rootId;

  // Only chains whose newest row is facts-v2, or that were exported before.
  // Oldest newest-row first, then record id, so checkpoints follow ingest order.
  const wanted = chains
    .map((c) => ({ chain: c, recordId: recordIdOf(c) }))
    .filter(({ chain, recordId }) => factsIds.has(chain.latestId) || lastByRecord.has(recordId))
    .sort((a, b) => {
      const d =
        (createdAtById.get(a.chain.latestId) ?? 0) - (createdAtById.get(b.chain.latestId) ?? 0);
      return d !== 0 ? d : a.recordId.localeCompare(b.recordId);
    });

  const toWrite: EvidenceRecordV1[] = [];
  const seenRecords = new Set<string>();
  for (let i = 0; i < wanted.length; i += LOAD_CHUNK) {
    const slice = wanted.slice(i, i + LOAD_CHUNK);
    const rows = await tx
      .select({
        id: risks.id,
        articleId: risks.articleId,
        riskTitle: risks.riskTitle,
        domains: risks.domains,
        primaryRisk: risks.primaryRisk,
        secondaryRisk: risks.secondaryRisk,
        sector: risks.sector,
        industry: risks.industry,
        intent: risks.intent,
        qualityScore: risks.qualityScore,
        likelihood: risks.likelihood,
        impact: risks.impact,
        severityScore: risks.severityScore,
        severityBand: risks.severityBand,
        aiProductName: risks.aiProductName,
        aiProductVendor: risks.aiProductVendor,
        extractionJson: risks.extractionJson,
        modelName: risks.modelName,
        createdAt: risks.createdAt,
        articleTitle: articles.title,
        articleUrl: articles.url,
        articleSha256: articles.sha256,
        articleCreatedAt: articles.createdAt,
      })
      .from(risks)
      .innerJoin(articles, eq(risks.articleId, articles.id))
      .where(inArray(risks.id, slice.map((w) => w.chain.latestId)));
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const { chain, recordId } of slice) {
      const row = byId.get(chain.latestId);
      if (!row) continue;
      seenRecords.add(recordId);
      const latest: LatestRow = {
        dto: mapRiskRowToDto(row, displayIds.get(row.id) ?? "R-?"),
        documentHash: documentHashFrom(row.articleSha256),
        retrievedAt: isoUtc(row.articleCreatedAt),
      };
      const step = planRecord(recordId, latest, lastByRecord.get(recordId) ?? null, publishedAt);
      if (step.kind === "write") toWrite.push(step.record);
    }
    await yieldToEventLoop();
  }

  // Exported records whose AIRI rows no longer exist (article or risk deleted).
  for (const [recordId, last] of lastByRecord) {
    if (seenRecords.has(recordId) || last.status === "retracted") continue;
    toWrite.push(
      toRetraction(last, {
        version: last.version + 1,
        publishedAt,
        reason: RETRACTION_REASON_REMOVED,
      }),
    );
  }

  const [maxRow] = await tx
    .select({ m: sql<string | null>`max(${evidenceExportLog.checkpoint})` })
    .from(evidenceExportLog);
  let checkpoint = Number(maxRow?.m ?? 0);
  for (let i = 0; i < toWrite.length; i += INSERT_CHUNK) {
    const batch = toWrite.slice(i, i + INSERT_CHUNK).map((rec) => {
      checkpoint += 1;
      const { checkpoint: _drop, ...payload } = rec;
      return {
        checkpoint,
        recordId: rec.record_id,
        version: rec.version,
        airiRowId: rec.airi_row_id,
        status: rec.status,
        contentHash: rec.content_hash!,
        payload,
        publishedAt: new Date(rec.published_at),
      };
    });
    await tx.insert(evidenceExportLog).values(batch);
  }

  return {
    ran: true,
    recordsConsidered: wanted.length,
    versionsWritten: toWrite.length,
    retractionsWritten: toWrite.filter((r) => r.status === "retracted").length,
    latestCheckpoint: checkpoint,
    durationMs: Date.now() - started,
  };
}

export type ExportPage = {
  schema_version: string;
  after_checkpoint: number;
  to_checkpoint: number;
  next_after: number;
  has_more: boolean;
  count: number;
  records: (EvidenceRecordV1 & { checkpoint: number })[];
};

/** Records with after < checkpoint <= to, in checkpoint order (spec section 5). */
export async function getExportPage(opts: {
  after: number;
  to?: number;
  limit?: number;
}): Promise<ExportPage> {
  // Never past the latest checkpoint: an empty page must not move a reader past
  // checkpoints that don't exist yet.
  const latest = await getLatestCheckpoint();
  const to = Math.min(opts.to ?? latest, latest);
  const limit = Math.min(Math.max(opts.limit ?? EXPORT_PAGE_MAX, 1), EXPORT_PAGE_MAX);
  const rows =
    to > opts.after
      ? await db
          .select({ checkpoint: evidenceExportLog.checkpoint, payload: evidenceExportLog.payload })
          .from(evidenceExportLog)
          .where(
            and(
              gt(evidenceExportLog.checkpoint, opts.after),
              lte(evidenceExportLog.checkpoint, to),
            ),
          )
          .orderBy(asc(evidenceExportLog.checkpoint))
          .limit(limit)
      : [];
  const records = rows.map((r) => ({
    ...(r.payload as EvidenceRecordV1),
    checkpoint: Number(r.checkpoint),
  }));
  const last = records.length ? records[records.length - 1]!.checkpoint : to;
  const nextAfter = Math.max(opts.after, last);
  return {
    schema_version: "evidence-record-1.0",
    after_checkpoint: opts.after,
    to_checkpoint: to,
    next_after: nextAfter,
    has_more: records.length === limit && nextAfter < to,
    count: records.length,
    records,
  };
}

/** Every record's latest exported version, for AI-Q's nightly cross-check. */
export async function getCurrentIds(): Promise<
  { record_id: string; version: number; status: string }[]
> {
  const res = await db.execute(
    sql`SELECT DISTINCT ON (record_id) record_id, version, status FROM evidence_export_log ORDER BY record_id, version DESC`,
  );
  return (res.rows as { record_id: string; version: number; status: string }[]).map((r) => ({
    record_id: r.record_id,
    version: Number(r.version),
    status: r.status,
  }));
}
