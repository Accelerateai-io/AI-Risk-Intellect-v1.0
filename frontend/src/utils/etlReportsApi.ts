import { authFetch, authFetchUpload, type UploadProgressHandler } from "./authFetch";

export type EtlReportUploadItemExtractionStatus =
  | "imported"
  | "skipped_existing"
  | "skipped_duplicate_in_file"
  | "skipped_invalid"
  | "failed";

export type EtlExtractionDisplayStatus =
  | "pending"
  | "processing"
  | "completed"
  | "partially_completed"
  | "skipped"
  | "failed";

export type EtlReportUploadItemRow = {
  id: number;
  reportId: number | null;
  uploadId: number;
  rowOrder: number;
  objectId: string | null;
  url: string;
  title: string | null;
  extractionStatus: EtlReportUploadItemExtractionStatus;
  skipReason: string | null;
};

/** Rows shown in the Items column after extraction (imported + skipped + failed). */
export function extractedItemCount(row: EtlReportUploadRow): number {
  if (row.status === "pending") return 0;
  const processed = row.importedRows + row.skippedRows + row.failedRows;
  if (processed > 0) return processed;
  return row.totalRows > 0 ? row.totalRows : row.importedRows;
}

/** aiid_reports id used when queueing a URL for ingestion. */
export function etlUploadItemReportId(
  item: Pick<EtlReportUploadItemRow, "id" | "reportId" | "extractionStatus">,
): number | null {
  if (item.reportId != null) return item.reportId;
  return item.extractionStatus === "imported" ? item.id : null;
}

function normalizeReportItemUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  try {
    let candidate = trimmed;
    if (!/^https?:\/\//i.test(candidate)) {
      candidate = `https://${candidate}`;
    }
    const parsed = new URL(candidate);
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase();
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
  } catch {
    return trimmed.toLowerCase();
  }
}

const REPORT_ITEM_STATUS_RANK: Record<EtlReportUploadItemExtractionStatus, number> =
  {
    imported: 0,
    failed: 1,
    skipped_existing: 2,
    skipped_duplicate_in_file: 3,
    skipped_invalid: 4,
  };

/** One row per URL for display/selection (prefers imported over skipped duplicates). */
export function uniqueReportUploadItemsByUrl(
  items: EtlReportUploadItemRow[],
): EtlReportUploadItemRow[] {
  const byUrl = new Map<string, EtlReportUploadItemRow>();

  for (const item of items) {
    const key = normalizeReportItemUrl(item.url);
    if (!key) continue;

    const existing = byUrl.get(key);
    if (!existing) {
      byUrl.set(key, item);
      continue;
    }

    const rank = REPORT_ITEM_STATUS_RANK[item.extractionStatus] ?? 99;
    const existingRank =
      REPORT_ITEM_STATUS_RANK[existing.extractionStatus] ?? 99;
    if (
      rank < existingRank ||
      (rank === existingRank && item.rowOrder < existing.rowOrder)
    ) {
      byUrl.set(key, item);
    }
  }

  return [...byUrl.values()].sort((a, b) => a.rowOrder - b.rowOrder);
}

export function reportUploadItemDisplayCount(
  row: EtlReportUploadRow,
  items?: EtlReportUploadItemRow[],
): number {
  if (items) {
    return items.length;
  }
  if (row.status === "pending" || row.status === "processing") return 0;
  return row.importedRows;
}

export type EtlReportUploadRow = {
  id: number;
  suggestedName: string | null;
  reportFilePath: string;
  fileName: string;
  status: "pending" | "processing" | "completed" | "failed";
  extractionStatus: EtlExtractionDisplayStatus;
  totalRows: number;
  importedRows: number;
  skippedRows: number;
  failedRows: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

type ApiErrorBody = {
  error?: { message?: string };
  message?: string;
};

function errorMessage(data: ApiErrorBody, fallback: string): string {
  return data.error?.message ?? data.message ?? fallback;
}

function parseContentDispositionFilename(
  header: string | null,
): string | null {
  if (!header) return null;
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim());
    } catch {
      return utf8Match[1].trim();
    }
  }
  const quoted = /filename="([^"]+)"/i.exec(header);
  if (quoted?.[1]) return quoted[1].trim();
  const plain = /filename=([^;]+)/i.exec(header);
  return plain?.[1]?.trim().replace(/^"|"$/g, "") ?? null;
}

export function canExportReportUpload(
  row: EtlReportUploadRow,
  _items?: EtlReportUploadItemRow[],
): boolean {
  return row.status !== "processing";
}

export async function fetchEtlReportUploads(): Promise<
  | { ok: true; uploads: EtlReportUploadRow[] }
  | { ok: false; message: string }
> {
  try {
    const res = await authFetch("/admin/etl/reports/uploads");
    const data = (await res.json().catch(() => ({}))) as ApiErrorBody & {
      uploads?: EtlReportUploadRow[];
    };

    if (!res.ok) {
      return {
        ok: false,
        message: errorMessage(data, "Could not load report uploads."),
      };
    }

    return { ok: true, uploads: data.uploads ?? [] };
  } catch {
    return {
      ok: false,
      message: "Network error while loading report uploads.",
    };
  }
}

export async function fetchEtlReportUploadItems(
  uploadId: number,
): Promise<
  | { ok: true; items: EtlReportUploadItemRow[] }
  | { ok: false; message: string }
> {
  try {
    const res = await authFetch(`/admin/etl/reports/uploads/${uploadId}/items`);
    const data = (await res.json().catch(() => ({}))) as ApiErrorBody & {
      items?: EtlReportUploadItemRow[];
    };

    if (!res.ok) {
      return {
        ok: false,
        message: errorMessage(data, "Could not load report URLs."),
      };
    }

    return { ok: true, items: data.items ?? [] };
  } catch {
    return {
      ok: false,
      message: "Network error while loading report URLs.",
    };
  }
}

export async function startEtlReportsRun(
  selection: { uploadIds: number[]; reportIds: number[] },
): Promise<
  | {
      ok: true;
      message: string;
      enqueued?: number;
      selectedReportCount?: number;
    }
  | { ok: false; message: string }
> {
  try {
    const res = await authFetch("/admin/etl/reports/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(selection),
    });
    const data = (await res.json().catch(() => ({}))) as ApiErrorBody & {
      message?: string;
      enqueued?: number;
      selectedReportCount?: number;
    };

    if (!res.ok) {
      return {
        ok: false,
        message: errorMessage(data, "Could not start reports worker."),
      };
    }

    return {
      ok: true,
      message: data.message ?? "Reports worker started.",
      enqueued: data.enqueued,
      selectedReportCount: data.selectedReportCount,
    };
  } catch {
    return {
      ok: false,
      message: "Network error while starting reports worker.",
    };
  }
}

export async function extractEtlReportUpload(
  id: number,
): Promise<
  | {
      ok: true;
      message: string;
      totalRows?: number;
      importedRows?: number;
      skippedRows?: number;
      failedRows?: number;
    }
  | { ok: false; message: string }
> {
  try {
    const res = await authFetch(`/admin/etl/reports/uploads/${id}/extract`, {
      method: "POST",
    });
    const data = (await res.json().catch(() => ({}))) as ApiErrorBody & {
      message?: string;
      totalRows?: number;
      importedRows?: number;
      skippedRows?: number;
      failedRows?: number;
    };

    if (!res.ok) {
      return {
        ok: false,
        message: errorMessage(data, "Could not extract report URLs."),
      };
    }

    return {
      ok: true,
      message: data.message ?? "Report URLs extracted.",
      totalRows: data.totalRows,
      importedRows: data.importedRows,
      skippedRows: data.skippedRows,
      failedRows: data.failedRows,
    };
  } catch {
    return {
      ok: false,
      message: "Network error while extracting report URLs.",
    };
  }
}

export async function reuploadEtlReportUpload(
  id: number,
  file: File,
  suggestedName = "",
  onProgress?: UploadProgressHandler,
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const formData = new FormData();
  formData.append("file", file);
  const trimmedName = suggestedName.trim();
  if (trimmedName) formData.append("suggestedName", trimmedName);

  try {
    const res = await authFetchUpload(
      `/admin/etl/reports/uploads/${id}/reupload`,
      formData,
      { onProgress },
    );
    const data = (await res.json().catch(() => ({}))) as ApiErrorBody & {
      message?: string;
    };

    if (!res.ok) {
      return {
        ok: false,
        message: errorMessage(data, "Could not reupload report file."),
      };
    }

    return {
      ok: true,
      message: data.message ?? "Report file replaced.",
    };
  } catch {
    return {
      ok: false,
      message: "Network error while reuploading report file.",
    };
  }
}

export async function archiveEtlReportUpload(
  id: number,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await authFetch(`/admin/etl/reports/uploads/${id}/archive`, {
      method: "POST",
    });
    const data = (await res.json().catch(() => ({}))) as ApiErrorBody;

    if (!res.ok) {
      return {
        ok: false,
        message: errorMessage(data, "Could not archive report upload."),
      };
    }

    return { ok: true };
  } catch {
    return {
      ok: false,
      message: "Network error while archiving report upload.",
    };
  }
}

export async function exportEtlReportUploadItems(
  uploadId: number,
): Promise<{ ok: true; fileName: string } | { ok: false; message: string }> {
  try {
    const res = await authFetch(
      `/admin/etl/reports/uploads/${uploadId}/export`,
    );

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as ApiErrorBody;
      return {
        ok: false,
        message: errorMessage(data, "Could not export report URLs."),
      };
    }

    const blob = await res.blob();
    const fileName =
      parseContentDispositionFilename(
        res.headers.get("Content-Disposition"),
      ) ?? `report-urls-${uploadId}.xlsx`;

    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);

    return { ok: true, fileName };
  } catch {
    return {
      ok: false,
      message: "Network error while exporting report URLs.",
    };
  }
}
