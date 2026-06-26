import type { NotificationItem, NotificationKind } from "./types";

const CRON_LIFECYCLE_KINDS: NotificationKind[] = [
  "cron_job_started",
  "cron_job_stopped",
  "cron_job_scheduled",
  "cron_job_completed",
];

function parseCronNotificationEventId(item: NotificationItem): {
  jobId: string;
  eventType: string;
  eventRowId: string;
} | null {
  const match = /^cron_job:([^:]+):([^:]+):(\d+)$/.exec(item.id);
  if (!match) return null;
  return {
    jobId: match[1]!,
    eventType: match[2]!,
    eventRowId: match[3]!,
  };
}

function storageKey(jobId: string, eventType: string): string {
  return `cronToast:${jobId}:${eventType}`;
}

/** True when this exact cron lifecycle DB row was already toasted this session. */
export function hasToastedCronLifecycleEvent(item: NotificationItem): boolean {
  if (!CRON_LIFECYCLE_KINDS.includes(item.kind)) return false;
  const parsed = parseCronNotificationEventId(item);
  if (!parsed) return false;
  try {
    return (
      sessionStorage.getItem(storageKey(parsed.jobId, parsed.eventType)) ===
      parsed.eventRowId
    );
  } catch {
    return false;
  }
}

export function markCronLifecycleEventToasted(item: NotificationItem): void {
  if (!CRON_LIFECYCLE_KINDS.includes(item.kind)) return;
  const parsed = parseCronNotificationEventId(item);
  if (!parsed) return;
  try {
    sessionStorage.setItem(
      storageKey(parsed.jobId, parsed.eventType),
      parsed.eventRowId,
    );
  } catch {
    // ignore quota / private mode
  }
}
