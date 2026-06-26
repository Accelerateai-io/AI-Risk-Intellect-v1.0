import { authFetch } from "./authFetch";

export type ReportsLogRow = {
  uploadId: number;
  reportId: number;
  reportUrl: string;
  importedAt: string | null;
  jobId: number | null;
  status: string;
  reason: string | null;
  executedAt: string | null;
  executionMs: number | null;
};

type ApiErrorBody = {
  error?: { message?: string };
  message?: string;
};

function errorMessage(data: ApiErrorBody, fallback: string): string {
  return data.error?.message ?? data.message ?? fallback;
}

export async function fetchReportsLogs(): Promise<
  | { ok: true; logs: ReportsLogRow[] }
  | { ok: false; message: string }
> {
  try {
    const res = await authFetch("/admin/etl/reports/logs");
    const data = (await res.json().catch(() => ({}))) as ApiErrorBody & {
      logs?: ReportsLogRow[];
    };
    if (!res.ok) {
      return {
        ok: false,
        message: errorMessage(data, "Could not load reports logs."),
      };
    }
    return { ok: true, logs: data.logs ?? [] };
  } catch {
    return { ok: false, message: "Network error while loading reports logs." };
  }
}
