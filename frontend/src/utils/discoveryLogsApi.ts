import { authFetch } from "./authFetch";

export type DiscoveryLogRow = {
  ingestLinkId: number;
  ingestLinkItemId: number;
  extractedUrl: string;
  extractedAt: string | null;
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

export async function fetchDiscoveryLogs(): Promise<
  | { ok: true; logs: DiscoveryLogRow[] }
  | { ok: false; message: string }
> {
  try {
    const res = await authFetch("/admin/discovery-logs");
    const data = (await res.json().catch(() => ({}))) as ApiErrorBody & {
      logs?: DiscoveryLogRow[];
    };
    if (!res.ok) {
      return {
        ok: false,
        message: errorMessage(data, "Could not load discovery logs."),
      };
    }
    return { ok: true, logs: data.logs ?? [] };
  } catch {
    return { ok: false, message: "Network error while loading discovery logs." };
  }
}
