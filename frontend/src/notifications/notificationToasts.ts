import { toast } from "react-toastify";
import { formatCronNotificationText } from "./formatCronNotificationText";
import type { NotificationItem } from "./types";

const RECENT_CRON_TOAST_MS = 30_000;
let lastCronStartToastAt = 0;
let lastCronStopToastAt = 0;
let lastCronScheduledToastAt = 0;
let lastCronCompletedToastAt = 0;

function shouldShowCronToast(lastAt: number): boolean {
  const now = Date.now();
  if (now - lastAt < RECENT_CRON_TOAST_MS) return false;
  return true;
}

export function toastCronJobStarted(message?: string): void {
  if (!shouldShowCronToast(lastCronStartToastAt)) return;
  lastCronStartToastAt = Date.now();
  toast.info(
    formatCronNotificationText(message?.trim() || "CRON job has been started."),
    {
      autoClose: 4000,
    },
  );
}

export function toastCronJobStopped(message?: string): void {
  if (!shouldShowCronToast(lastCronStopToastAt)) return;
  lastCronStopToastAt = Date.now();
  toast.info(
    formatCronNotificationText(
      message?.trim() || "RSS feed discovery CRON job stopped.",
    ),
    { autoClose: 4000 },
  );
}

export function toastCronJobScheduled(message?: string): void {
  if (!shouldShowCronToast(lastCronScheduledToastAt)) return;
  lastCronScheduledToastAt = Date.now();
  toast.success(
    formatCronNotificationText(
      message?.trim() || "RSS feed discovery CRON job was scheduled.",
    ),
    { autoClose: 4500 },
  );
}

export function toastCronJobCompleted(message?: string): void {
  if (!shouldShowCronToast(lastCronCompletedToastAt)) return;
  lastCronCompletedToastAt = Date.now();
  toast.success(
    formatCronNotificationText(message?.trim() || "CRON job is completed."),
    {
      autoClose: 4500,
    },
  );
}

export function maybeToastNotification(item: NotificationItem): void {
  if (item.kind === "cron_job_started") {
    toastCronJobStarted(item.message);
  }
  if (item.kind === "cron_job_stopped") {
    toastCronJobStopped(item.message);
  }
  if (item.kind === "cron_job_scheduled") {
    toastCronJobScheduled(item.message);
  }
  if (item.kind === "cron_job_completed") {
    toastCronJobCompleted(item.message);
  }
}
