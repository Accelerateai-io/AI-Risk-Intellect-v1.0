import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "../../db/index.js";
import { aiidReports } from "../../schema/aiid/reports.js";
import { jobs } from "../../schema/jobs/jobs.js";
import { normalizeUrl } from "../../utils/fetchUtils.js";

export type ReportsLogStatus =
  | "NOT PROCESSED"
  | "PENDING"
  | "RUNNING"
  | "EXECUTED"
  | "SKIPPED"
  | "FAILED";

export type ReportsLogDto = {
  uploadId: number;
  reportId: number;
  reportUrl: string;
  importedAt: string | null;
  jobId: number | null;
  status: ReportsLogStatus;
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

function toDisplayStatus(jobStatus: string): ReportsLogStatus {
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
  displayStatus: ReportsLogStatus,
  errorMessage: string | null,
): string | null {
  const note = errorMessage?.trim() || null;
  switch (displayStatus) {
    case "PENDING":
      return note ?? "Queued by reports worker — awaiting worker.";
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

function isMissingEtlReportsSourceError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('invalid input value for enum job_source: "etl_reports"');
}

async function fetchReportJobLogRows() {
  const runQuery = (
    sources: ReadonlyArray<"etl_reports" | "api">,
  ) =>
    db
      .select({
        jobId: jobs.id,
        jobStatus: jobs.status,
        errorMessage: jobs.errorMessage,
        createdAt: jobs.createdAt,
        startedAt: jobs.startedAt,
        updatedAt: jobs.updatedAt,
        jobUrl: jobs.url,
        reportId: aiidReports.id,
        uploadId: aiidReports.uploadId,
        reportUrl: aiidReports.url,
        importedAt: aiidReports.importedAt,
      })
      .from(jobs)
      .innerJoin(aiidReports, eq(aiidReports.url, jobs.url))
      .where(
        and(inArray(jobs.source, [...sources]), isNotNull(aiidReports.uploadId)),
      )
      .orderBy(desc(jobs.createdAt))
      .limit(500);

  try {
    return await runQuery(["etl_reports", "api"]);
  } catch (err) {
    if (!isMissingEtlReportsSourceError(err)) {
      throw err;
    }
    return await runQuery(["api"]);
  }
}

/** Logs for report URLs queued by the reports worker (ETL/API jobs tied to aiid_reports). */
export async function listReportsLogs(): Promise<ReportsLogDto[]> {
  const rows = await fetchReportJobLogRows();

  return rows.map((row) => {
    const uploadId = row.uploadId ?? 0;

    let reportUrl = row.reportUrl ?? row.jobUrl;
    try {
      reportUrl = normalizeUrl(reportUrl);
    } catch {
      // keep raw
    }

    const displayStatus = toDisplayStatus(row.jobStatus);
    const reason = resolveReason(displayStatus, row.errorMessage);

    const executedAt = TERMINAL_STATUSES.has(normalizeJobStatus(row.jobStatus))
      ? row.updatedAt.toISOString()
      : null;
    const importedAt = row.importedAt ? row.importedAt.toISOString() : null;
    const runStartedAt = row.startedAt ?? row.createdAt;
    const executionMs =
      executedAt && runStartedAt
        ? Math.max(0, row.updatedAt.getTime() - runStartedAt.getTime())
        : null;

    return {
      uploadId,
      reportId: row.reportId,
      reportUrl,
      importedAt,
      jobId: row.jobId,
      status: displayStatus,
      reason,
      executedAt,
      executionMs,
    };
  });
}
