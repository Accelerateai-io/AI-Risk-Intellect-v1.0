import { authFetch } from "./authFetch";

export type RepeatUnit = "day" | "week" | "month" | "year";

export type CronSchedule = {
  id: string;
  startDate: string;
  startTime: string;
  timezone: string;
  repeat: boolean;
  repeatInterval: number;
  repeatUnit: RepeatUnit;
  repeatDays: number[];
  ingestLinkIds: number[];
  endsOn: string | null;
  active: boolean;
};

export type CronJobRow = {
  id: string;
  name: string;
  description: string;
  schedule: CronSchedule;
  enabled: boolean;
  running: boolean;
  /** Ms until next discovery attempt; 0 = due now; null when already running. */
  nextRunWaitMs?: number | null;
  serviceKey: "discovery" | null;
};

export type SaveCronScheduleInput = {
  startDate: string;
  startTime: string;
  timezone: string;
  repeat: boolean;
  repeatInterval: number;
  repeatUnit: RepeatUnit;
  repeatDays: number[];
  ingestLinkIds: number[];
};

type ApiErrorBody = {
  error?: { message?: string };
  message?: string;
};

function errorMessage(data: ApiErrorBody, fallback: string): string {
  return data.error?.message ?? data.message ?? fallback;
}

export async function fetchCronJobs(): Promise<
  | { ok: true; jobs: CronJobRow[] }
  | { ok: false; message: string }
> {
  try {
    const res = await authFetch("/admin/cron-jobs");
    const data = (await res.json().catch(() => ({}))) as ApiErrorBody & {
      jobs?: CronJobRow[];
    };
    if (!res.ok) {
      return {
        ok: false,
        message: errorMessage(data, "Could not load CRON jobs."),
      };
    }
    return { ok: true, jobs: data.jobs ?? [] };
  } catch {
    return { ok: false, message: "Network error while loading CRON jobs." };
  }
}

export async function saveCronJobSchedule(
  jobId: string,
  input: SaveCronScheduleInput,
): Promise<
  | { ok: true; message: string; job: CronJobRow }
  | { ok: false; message: string }
> {
  try {
    const res = await authFetch(`/admin/cron-jobs/${jobId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = (await res.json().catch(() => ({}))) as ApiErrorBody & {
      job?: CronJobRow;
    };
    if (!res.ok) {
      return {
        ok: false,
        message: errorMessage(data, "Could not save CRON job."),
      };
    }
    if (!data.job) {
      return { ok: false, message: "CRON job response was incomplete." };
    }
    return {
      ok: true,
      message: data.message ?? "CRON job saved and started.",
      job: data.job,
    };
  } catch {
    return { ok: false, message: "Network error while saving CRON job." };
  }
}

export async function stopCronJobSchedule(
  jobId: string,
): Promise<
  | { ok: true; message: string; job: CronJobRow }
  | { ok: false; message: string }
> {
  try {
    const res = await authFetch(`/admin/cron-jobs/${jobId}/stop`, {
      method: "POST",
    });
    const data = (await res.json().catch(() => ({}))) as ApiErrorBody & {
      job?: CronJobRow;
    };
    if (!res.ok) {
      return {
        ok: false,
        message: errorMessage(data, "Could not stop CRON job."),
      };
    }
    if (!data.job) {
      return { ok: false, message: "CRON job response was incomplete." };
    }
    return {
      ok: true,
      message: data.message ?? "CRON job stopped.",
      job: data.job,
    };
  } catch {
    return { ok: false, message: "Network error while stopping CRON job." };
  }
}
