import { authFetch } from "./authFetch";

export type BatchRunItemProcessingStatus =
  | "pending"
  | "running"
  | "done"
  | "failed";

export type BatchRunCounts = {
  total: number;
  pending: number;
  running: number;
  done: number;
  failed: number;
};

export type BatchRunItem = {
  id: number;
  serial?: number;
  sourceType: "rss" | "etl";
  ingestLinkId: number | null;
  ingestLinkItemId: number | null;
  feedName: string | null;
  uploadId: number | null;
  reportId: number | null;
  url: string;
  title: string | null;
  status: string;
  processingStatus?: BatchRunItemProcessingStatus;
  errorMessage: string | null;
  createdAt: string;
};

export type BatchRun = {
  id: number;
  modelName: string;
  modelLabel: string | null;
  status: string;
  rssItemCount: number;
  etlItemCount: number;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  disabled?: boolean;
  counts?: BatchRunCounts;
  items?: BatchRunItem[];
};

type ApiErrorBody = {
  error?: { message?: string };
  message?: string;
};

function errorMessage(data: ApiErrorBody, fallback: string): string {
  return data.error?.message ?? data.message ?? fallback;
}

export async function startBatchRun(selection: {
  modelId?: string;
  ingestLinkIds?: number[];
  ingestLinkItemIds?: number[];
  uploadIds?: number[];
  reportIds?: number[];
  excludeReportIds?: number[];
}): Promise<
  | { ok: true; message: string; batch: BatchRun }
  | { ok: false; message: string }
> {
  try {
    const res = await authFetch("/admin/batch-runs/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(selection.modelId ? { modelId: selection.modelId } : {}),
        ...(selection.ingestLinkIds && selection.ingestLinkIds.length > 0
          ? { ingestLinkIds: selection.ingestLinkIds }
          : {}),
        ...(selection.ingestLinkItemIds && selection.ingestLinkItemIds.length > 0
          ? { ingestLinkItemIds: selection.ingestLinkItemIds }
          : {}),
        ...(selection.uploadIds && selection.uploadIds.length > 0
          ? { uploadIds: selection.uploadIds }
          : {}),
        ...(selection.reportIds && selection.reportIds.length > 0
          ? { reportIds: selection.reportIds }
          : {}),
        ...(selection.excludeReportIds && selection.excludeReportIds.length > 0
          ? { excludeReportIds: selection.excludeReportIds }
          : {}),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as ApiErrorBody & {
      message?: string;
      batch?: BatchRun;
    };
    if (!res.ok || !data.batch) {
      return {
        ok: false,
        message: errorMessage(data, "Could not start batch run."),
      };
    }
    return {
      ok: true,
      message: data.message ?? "Batch started.",
      batch: data.batch,
    };
  } catch {
    return { ok: false, message: "Network error while starting batch run." };
  }
}

export async function fetchBatchRuns(
  limit = 25,
): Promise<
  | { ok: true; batches: BatchRun[] }
  | { ok: false; message: string }
> {
  try {
    const res = await authFetch(
      `/admin/batch-runs?limit=${encodeURIComponent(String(limit))}`,
    );
    const data = (await res.json().catch(() => ({}))) as ApiErrorBody & {
      batches?: BatchRun[];
    };
    if (!res.ok) {
      return {
        ok: false,
        message: errorMessage(data, "Could not load batch runs."),
      };
    }
    return { ok: true, batches: data.batches ?? [] };
  } catch {
    return { ok: false, message: "Network error while loading batch runs." };
  }
}

export async function fetchBatchRun(
  id: number,
): Promise<
  | { ok: true; batch: BatchRun }
  | { ok: false; message: string }
> {
  try {
    const res = await authFetch(`/admin/batch-runs/${id}`);
    const data = (await res.json().catch(() => ({}))) as ApiErrorBody & {
      batch?: BatchRun;
    };
    if (!res.ok || !data.batch) {
      return {
        ok: false,
        message: errorMessage(data, "Could not load batch run."),
      };
    }
    return { ok: true, batch: data.batch };
  } catch {
    return { ok: false, message: "Network error while loading batch run." };
  }
}

export async function disableBatchRun(
  id: number,
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  try {
    const res = await authFetch(`/admin/batch-runs/${id}/disable`, {
      method: "POST",
    });
    const data = (await res.json().catch(() => ({}))) as ApiErrorBody & {
      message?: string;
    };
    if (!res.ok) {
      return {
        ok: false,
        message: errorMessage(data, "Could not disable batch run."),
      };
    }
    return {
      ok: true,
      message: data.message ?? "Batch disabled.",
    };
  } catch {
    return { ok: false, message: "Network error while disabling batch run." };
  }
}

export async function enableBatchRun(
  id: number,
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  try {
    const res = await authFetch(`/admin/batch-runs/${id}/enable`, {
      method: "POST",
    });
    const data = (await res.json().catch(() => ({}))) as ApiErrorBody & {
      message?: string;
    };
    if (!res.ok) {
      return {
        ok: false,
        message: errorMessage(data, "Could not enable batch run."),
      };
    }
    return {
      ok: true,
      message: data.message ?? "Batch enabled.",
    };
  } catch {
    return { ok: false, message: "Network error while enabling batch run." };
  }
}
