import type { NotificationKind } from "./types";

export function notificationKindClass(kind: NotificationKind): string {
  switch (kind) {
    case "job_done":
    case "report_upload_completed":
      return "notifications__itemKind--success";
    case "job_skipped":
      return "notifications__itemKind--skipped";
    case "job_failed":
    case "report_upload_failed":
      return "notifications__itemKind--error";
    case "job_running":
      return "notifications__itemKind--running";
    case "job_pending":
      return "notifications__itemKind--pending";
    case "feed_extracted":
      return "notifications__itemKind--extracted";
    case "cron_job_started":
      return "notifications__itemKind--running";
    case "cron_job_scheduled":
      return "notifications__itemKind--pending";
    case "cron_job_completed":
      return "notifications__itemKind--success";
    case "cron_job_stopped":
      return "notifications__itemKind--pending";
    default:
      return "";
  }
}

export function formatNotificationTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}
