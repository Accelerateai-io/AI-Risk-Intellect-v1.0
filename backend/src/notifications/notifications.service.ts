import { and, count, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { etlReportUploads } from "../schema/aiid/reportUploads.js";
import { cronJobEvents } from "../schema/cronJobs/cronJobEvents.js";
import { formatCronNotificationText } from "./formatCronNotificationText.js";
import { ingestLinkItems } from "../schema/ingestLinks/ingestLinkItems.js";
import { ingestLinks } from "../schema/ingestLinks/ingestLinks.js";
import { jobs } from "../schema/jobs/jobs.js";
import type { NotificationDto, NotificationKind } from "./notifications.types.js";

const DEFAULT_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_NOTIFICATIONS = 60;

function truncateUrl(url: string, max = 52): string {
  const trimmed = url.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function formatJobSource(source: string): string {
  const normalized = source.trim().toLowerCase();
  if (normalized === "rss") return "RSS";
  if (normalized === "etl_reports" || normalized === "api") return "ETL Reports";
  if (normalized === "manual") return "Manual";
  return source;
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

function resolveJobNotificationDetail(
  kind: NotificationKind,
  row: {
    errorMessage: string | null;
    source: string;
    url: string;
  },
): string {
  const note = row.errorMessage?.trim() || null;
  if (note && (kind === "job_failed" || kind === "job_skipped")) {
    return note;
  }

  const sourceLabel = formatJobSource(row.source);
  const urlLabel = truncateUrl(row.url);

  switch (kind) {
    case "job_skipped":
      return note ?? "Skipped during ingest (no detailed reason recorded).";
    case "job_failed":
      return note ?? "Ingest failed (no detailed reason recorded).";
    default:
      return `${sourceLabel} · ${urlLabel}`;
  }
}

function mapJobNotification(row: {
  id: number;
  url: string;
  status: string;
  source: string;
  errorMessage: string | null;
  updatedAt: Date;
}): NotificationDto {
  const status = normalizeJobStatus(row.status);

  let kind: NotificationKind;
  let title: string;

  switch (status) {
    case "done":
      kind = "job_done";
      title = "Ingest completed";
      break;
    case "skipped":
      kind = "job_skipped";
      title = "Job skipped";
      break;
    case "error":
      kind = "job_failed";
      title = "Ingest failed";
      break;
    case "running":
      kind = "job_running";
      title = "Job running";
      break;
    case "pending":
    default:
      kind = "job_pending";
      title = "Job queued";
      break;
  }

  const detail = resolveJobNotificationDetail(kind, row);

  return {
    id: `job:${row.id}`,
    kind,
    title,
    message: detail,
    createdAt: row.updatedAt.toISOString(),
    href: "/jobs",
  };
}

function mapFeedExtractNotification(row: {
  id: number;
  url: string;
  suggestedName: string | null;
  itemCount: number;
  updatedAt: Date;
}): NotificationDto {
  const label =
    row.suggestedName?.trim() ||
    truncateUrl(row.url, 40) ||
    `Feed #${row.id}`;

  return {
    id: `feed_extract:${row.id}`,
    kind: "feed_extracted",
    title: "RSS feed extracted",
    message: `${row.itemCount} URL${row.itemCount === 1 ? "" : "s"} from ${label}`,
    createdAt: row.updatedAt.toISOString(),
    href: "/controls",
  };
}

function mapReportUploadNotification(row: {
  id: number;
  suggestedName: string | null;
  status: string;
  importedRows: number;
  totalRows: number;
  errorMessage: string | null;
  updatedAt: Date;
}): NotificationDto {
  const isFailed = row.status === "failed";
  const label = row.suggestedName?.trim() || `Upload #${row.id}`;

  return {
    id: `report_upload:${row.id}:${row.status}`,
    kind: isFailed ? "report_upload_failed" : "report_upload_completed",
    title: isFailed ? "Report upload failed" : "Report upload imported",
    message: isFailed
      ? (row.errorMessage?.trim() || `${label} could not be imported.`)
      : `${label} · ${row.importedRows} of ${row.totalRows} row${row.totalRows === 1 ? "" : "s"} imported`,
    createdAt: row.updatedAt.toISOString(),
    href: "/controls",
  };
}

function mapCronJobEventNotification(row: {
  id: number;
  jobId: string;
  eventType: "started" | "stopped" | "scheduled" | "completed";
  message: string | null;
  createdAt: Date;
}): NotificationDto {
  const defaults: Record<
    typeof row.eventType,
    { kind: NotificationKind; title: string; fallback: string }
  > = {
    scheduled: {
      kind: "cron_job_scheduled",
      title: "CRON job scheduled",
      fallback: "RSS feed discovery CRON job was scheduled.",
    },
    completed: {
      kind: "cron_job_completed",
      title: "CRON job completed",
      fallback: "CRON job is completed.",
    },
    started: {
      kind: "cron_job_started",
      title: "CRON job started",
      fallback: "CRON job has been started.",
    },
    stopped: {
      kind: "cron_job_stopped",
      title: "CRON job stopped",
      fallback: "RSS feed discovery CRON job stopped.",
    },
  };

  const meta = defaults[row.eventType];

  const message = formatCronNotificationText(
    row.message?.trim() || meta.fallback,
  );

  return {
    id: `cron_job:${row.jobId}:${row.eventType}:${row.id}`,
    kind: meta.kind,
    title: formatCronNotificationText(meta.title),
    message,
    createdAt: row.createdAt.toISOString(),
    href: "/controls",
  };
}

function collapseCronNotifications(
  notifications: NotificationDto[],
): NotificationDto[] {
  const latestCronByKey = new Map<string, NotificationDto>();
  const nonCron: NotificationDto[] = [];

  for (const item of notifications) {
    if (
      item.kind !== "cron_job_started" &&
      item.kind !== "cron_job_completed" &&
      item.kind !== "cron_job_stopped" &&
      item.kind !== "cron_job_scheduled"
    ) {
      nonCron.push(item);
      continue;
    }

    const match = /^cron_job:([^:]+):/.exec(item.id);
    const jobId = match?.[1] ?? item.id;
    const key = `${jobId}:${item.kind}`;
    const existing = latestCronByKey.get(key);
    if (
      !existing ||
      new Date(item.createdAt).getTime() >
        new Date(existing.createdAt).getTime()
    ) {
      latestCronByKey.set(key, item);
    }
  }

  return [...nonCron, ...latestCronByKey.values()];
}

const CRON_LIFECYCLE_EVENT_TYPES = [
  "started",
  "completed",
  "stopped",
  "scheduled",
] as const;

/** At most one notification per cron lifecycle type (latest row only). */
async function loadLatestCronEventNotifications(
  since: Date,
): Promise<NotificationDto[]> {
  const notifications: NotificationDto[] = [];

  for (const eventType of CRON_LIFECYCLE_EVENT_TYPES) {
    const [row] = await db
      .select({
        id: cronJobEvents.id,
        jobId: cronJobEvents.jobId,
        eventType: cronJobEvents.eventType,
        message: cronJobEvents.message,
        createdAt: cronJobEvents.createdAt,
      })
      .from(cronJobEvents)
      .where(
        and(
          eq(cronJobEvents.eventType, eventType),
          gte(cronJobEvents.createdAt, since),
        ),
      )
      .orderBy(desc(cronJobEvents.createdAt))
      .limit(1);

    if (row) {
      notifications.push(mapCronJobEventNotification(row));
    }
  }

  return notifications;
}

export async function listNotifications(options?: {
  since?: Date;
}): Promise<NotificationDto[]> {
  const since =
    options?.since ?? new Date(Date.now() - DEFAULT_LOOKBACK_MS);
  const notifications: NotificationDto[] = [];

  const jobRows = await db
    .select({
      id: jobs.id,
      url: jobs.url,
      status: jobs.status,
      source: jobs.source,
      errorMessage: jobs.errorMessage,
      updatedAt: jobs.updatedAt,
    })
    .from(jobs)
    .where(gte(jobs.updatedAt, since))
    .orderBy(desc(jobs.updatedAt))
    .limit(80);

  for (const row of jobRows) {
    notifications.push(mapJobNotification(row));
  }

  const feedRows = await db
    .select({
      id: ingestLinks.id,
      url: ingestLinks.url,
      suggestedName: ingestLinks.suggestedName,
      updatedAt: ingestLinks.updatedAt,
      itemCount: count(ingestLinkItems.id),
    })
    .from(ingestLinks)
    .leftJoin(
      ingestLinkItems,
      eq(ingestLinkItems.ingestLinkId, ingestLinks.id),
    )
    .where(
      and(
        eq(ingestLinks.archived, false),
        gte(ingestLinks.updatedAt, since),
      ),
    )
    .groupBy(ingestLinks.id)
    .orderBy(desc(ingestLinks.updatedAt))
    .limit(20);

  for (const row of feedRows) {
    const itemCount = Number(row.itemCount ?? 0);
    if (itemCount <= 0) continue;
    notifications.push(
      mapFeedExtractNotification({
        id: row.id,
        url: row.url,
        suggestedName: row.suggestedName,
        itemCount,
        updatedAt: row.updatedAt,
      }),
    );
  }

  const uploadRows = await db
    .select({
      id: etlReportUploads.id,
      suggestedName: etlReportUploads.suggestedName,
      status: etlReportUploads.status,
      importedRows: etlReportUploads.importedRows,
      totalRows: etlReportUploads.totalRows,
      errorMessage: etlReportUploads.errorMessage,
      updatedAt: etlReportUploads.updatedAt,
    })
    .from(etlReportUploads)
    .where(
      and(
        eq(etlReportUploads.archived, false),
        gte(etlReportUploads.updatedAt, since),
        inArray(etlReportUploads.status, ["completed", "failed"]),
      ),
    )
    .orderBy(desc(etlReportUploads.updatedAt))
    .limit(20);

  for (const row of uploadRows) {
    notifications.push(mapReportUploadNotification(row));
  }

  notifications.push(...(await loadLatestCronEventNotifications(since)));

  return collapseCronNotifications(notifications)
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
    .slice(0, MAX_NOTIFICATIONS);
}
