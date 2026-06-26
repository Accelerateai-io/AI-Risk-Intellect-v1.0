import { and, desc, eq, isNotNull, or, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { ingestLinkItems } from "../../schema/ingestLinks/ingestLinkItems.js";
import { ingestLinks } from "../../schema/ingestLinks/ingestLinks.js";
import { jobs } from "../../schema/jobs/jobs.js";
import { normalizeUrl } from "../../utils/fetchUtils.js";

export type DiscoveryLogStatus =
  | "NOT PROCESSED"
  | "PENDING"
  | "RUNNING"
  | "EXECUTED"
  | "SKIPPED"
  | "FAILED";

export type DiscoveryLogDto = {
  ingestLinkId: number;
  ingestLinkItemId: number;
  extractedUrl: string;
  extractedAt: string | null;
  jobId: number | null;
  status: DiscoveryLogStatus;
  reason: string | null;
  executedAt: string | null;
  executionMs: number | null;
};

const TERMINAL_STATUSES = new Set([
  "done",
  "completed",
  "skipped",
  "error",
  "failed",
]);

function isMissingIngestRefColumnError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes('column "ingest_link_id" does not exist') ||
    message.includes('column "ingest_link_item_id" does not exist')
  );
}

function normalizeJobStatus(status: string): string {
  switch (status.toLowerCase()) {
    case "completed":
      return "done";
    case "failed":
      return "error";
    default:
      return status.toLowerCase();
  }
}

function toDisplayStatus(jobStatus: string): DiscoveryLogStatus {
  const s = normalizeJobStatus(jobStatus);
  switch (s) {
    case "pending":
      return "PENDING";
    case "running":
      return "RUNNING";
    case "done":
      return "EXECUTED";
    case "skipped":
      return "SKIPPED";
    case "error":
      return "FAILED";
    default:
      return "NOT PROCESSED";
  }
}

function resolveReason(
  displayStatus: DiscoveryLogStatus,
  errorMessage: string | null,
): string | null {
  const note = errorMessage?.trim() || null;
  switch (displayStatus) {
    case "PENDING":
      return note ?? "Queued by discovery — awaiting worker.";
    case "RUNNING":
      return note ?? "Processing.";
    case "EXECUTED":
      return note;
    case "SKIPPED":
      return note ?? "Skipped during ingest.";
    case "FAILED":
      return note ?? "Ingest failed.";
    default:
      return note;
  }
}

type DiscoveryJobRow = {
  jobId: number;
  jobStatus: string;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  ingestLinkItemId: number | null;
  ingestLinkId: number | null;
  jobUrl: string;
  itemUrl: string | null;
  itemCreatedAt: Date | null;
  itemIngestLinkId: number | null;
};

async function fetchDiscoveryJobRows(): Promise<DiscoveryJobRow[]> {
  const discoveryJobFilter = and(
    eq(jobs.source, "rss"),
    or(isNotNull(jobs.ingestLinkItemId), isNotNull(jobs.ingestLinkId)),
  );
  const activeFeedFilter = eq(ingestLinks.archived, false);

  try {
    return await db
      .select({
        jobId: jobs.id,
        jobStatus: jobs.status,
        errorMessage: jobs.errorMessage,
        createdAt: jobs.createdAt,
        updatedAt: jobs.updatedAt,
        ingestLinkItemId: jobs.ingestLinkItemId,
        ingestLinkId: jobs.ingestLinkId,
        jobUrl: jobs.url,
        itemUrl: ingestLinkItems.url,
        itemCreatedAt: ingestLinkItems.createdAt,
        itemIngestLinkId: ingestLinkItems.ingestLinkId,
      })
      .from(jobs)
      .leftJoin(ingestLinkItems, eq(ingestLinkItems.id, jobs.ingestLinkItemId))
      .innerJoin(
        ingestLinks,
        sql`${ingestLinks.id} = COALESCE(${ingestLinkItems.ingestLinkId}, ${jobs.ingestLinkId})`,
      )
      .where(and(discoveryJobFilter, activeFeedFilter))
      .orderBy(desc(jobs.createdAt))
      .limit(500);
  } catch (err) {
    if (!isMissingIngestRefColumnError(err)) {
      throw err;
    }

    return await db
      .select({
        jobId: jobs.id,
        jobStatus: jobs.status,
        errorMessage: jobs.errorMessage,
        createdAt: jobs.createdAt,
        updatedAt: jobs.updatedAt,
        ingestLinkItemId: ingestLinkItems.id,
        ingestLinkId: ingestLinkItems.ingestLinkId,
        jobUrl: jobs.url,
        itemUrl: ingestLinkItems.url,
        itemCreatedAt: ingestLinkItems.createdAt,
        itemIngestLinkId: ingestLinkItems.ingestLinkId,
      })
      .from(jobs)
      .innerJoin(ingestLinkItems, eq(ingestLinkItems.url, jobs.url))
      .innerJoin(ingestLinks, eq(ingestLinks.id, ingestLinkItems.ingestLinkId))
      .where(and(eq(jobs.source, "rss"), activeFeedFilter))
      .orderBy(desc(jobs.createdAt))
      .limit(500);
  }
}

function dedupeLatestJobPerItem(rows: DiscoveryJobRow[]): DiscoveryJobRow[] {
  const latest = new Map<string, DiscoveryJobRow>();

  for (const row of rows) {
    const key =
      row.ingestLinkItemId != null && row.ingestLinkItemId > 0
        ? `item:${row.ingestLinkItemId}`
        : `url:${row.jobUrl}`;
    const existing = latest.get(key);
    if (!existing || row.jobId > existing.jobId) {
      latest.set(key, row);
    }
  }

  return [...latest.values()].sort((a, b) => b.jobId - a.jobId);
}

/** Logs for URLs actually queued by the discovery service (RSS jobs tied to feed items). */
export async function listDiscoveryLogs(): Promise<DiscoveryLogDto[]> {
  const rows = dedupeLatestJobPerItem(await fetchDiscoveryJobRows());

  return rows.map((row) => {
    const ingestLinkId = row.itemIngestLinkId ?? row.ingestLinkId ?? 0;
    const ingestLinkItemId = row.ingestLinkItemId ?? 0;

    let extractedUrl = row.itemUrl ?? row.jobUrl;
    try {
      extractedUrl = normalizeUrl(extractedUrl);
    } catch {
      // keep raw
    }

    const displayStatus = toDisplayStatus(row.jobStatus);
    const reason = resolveReason(displayStatus, row.errorMessage);

    const executedAt = TERMINAL_STATUSES.has(normalizeJobStatus(row.jobStatus))
      ? row.updatedAt.toISOString()
      : null;
    const extractedAt = row.itemCreatedAt ? row.itemCreatedAt.toISOString() : null;
    const executionMs =
      executedAt && row.createdAt
        ? Math.max(0, row.updatedAt.getTime() - row.createdAt.getTime())
        : null;

    return {
      ingestLinkId,
      ingestLinkItemId,
      extractedUrl,
      extractedAt,
      jobId: row.jobId,
      status: displayStatus,
      reason,
      executedAt,
      executionMs,
    };
  });
}
