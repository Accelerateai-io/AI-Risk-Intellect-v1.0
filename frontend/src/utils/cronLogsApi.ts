import { authFetch } from "./authFetch";
import type { DiscoveryLogRow } from "./discoveryLogsApi";

export type CronFeedLogSummary = {
  ingestLinkId: number;
  feedName: string | null;
  feedUrl: string;
  extractedCount: number;
  pendingCount: number;
  runningCount: number;
  executedCount: number;
  failedCount: number;
  skippedCount: number;
  notProcessedCount: number;
  lastActivityAt: string | null;
};

type ApiErrorBody = {
  error?: { message?: string };
  message?: string;
};

function errorMessage(data: ApiErrorBody, fallback: string): string {
  return data.error?.message ?? data.message ?? fallback;
}

export async function fetchCronJobLogs(): Promise<
  | {
      ok: true;
      scheduledFeedIds: number[];
      feeds: CronFeedLogSummary[];
      logs: DiscoveryLogRow[];
    }
  | { ok: false; message: string }
> {
  try {
    const res = await authFetch("/admin/cron-jobs/logs");
    const data = (await res.json().catch(() => ({}))) as ApiErrorBody & {
      scheduledFeedIds?: number[];
      feeds?: CronFeedLogSummary[];
      logs?: DiscoveryLogRow[];
    };
    if (!res.ok) {
      return {
        ok: false,
        message: errorMessage(data, "Could not load CRON job logs."),
      };
    }
    return {
      ok: true,
      scheduledFeedIds: data.scheduledFeedIds ?? [],
      feeds: data.feeds ?? [],
      logs: data.logs ?? [],
    };
  } catch {
    return {
      ok: false,
      message: "Network error while loading CRON job logs.",
    };
  }
}
