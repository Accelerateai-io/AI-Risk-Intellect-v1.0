export type NotificationKind =
  | "job_done"
  | "job_skipped"
  | "job_failed"
  | "job_running"
  | "job_pending"
  | "feed_extracted"
  | "report_upload_completed"
  | "report_upload_failed"
  | "cron_job_started"
  | "cron_job_stopped"
  | "cron_job_scheduled"
  | "cron_job_completed";

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  title: string;
  message: string;
  createdAt: string;
  href: string | null;
}
