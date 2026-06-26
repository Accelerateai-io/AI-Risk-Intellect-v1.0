import {
  authFetchUpload,
  type UploadProgressHandler,
} from "../../../../utils/authFetch";

const REPORTS_UPLOAD_PATH = "/admin/etl/reports/upload";

const ALLOWED_EXTENSIONS = [".csv", ".xlsx", ".xls"];

function isAllowedEtlFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function formatSaveSummary(data: { message?: string }): string {
  return data.message ?? "Report file saved. Use Extract to import report URLs.";
}

export async function uploadEtlReports(
  file: File,
  suggestedName = "",
  onProgress?: UploadProgressHandler,
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  if (!isAllowedEtlFile(file.name)) {
    return {
      ok: false,
      message: "Please select a CSV or Excel file (.csv, .xlsx, .xls).",
    };
  }

  const formData = new FormData();
  formData.append("file", file);
  const trimmedName = suggestedName.trim();
  if (trimmedName) formData.append("suggestedName", trimmedName);

  try {
    const res = await authFetchUpload(REPORTS_UPLOAD_PATH, formData, {
      onProgress,
    });
    const data = (await res.json().catch(() => ({}))) as {
      message?: string;
      error?: { message?: string };
    };

    if (!res.ok) {
      return {
        ok: false,
        message:
          data.error?.message ??
          (res.status === 404
            ? "Upload API is not connected yet."
            : "Could not upload file."),
      };
    }

    return {
      ok: true,
      message: formatSaveSummary(data),
    };
  } catch {
    return {
      ok: false,
      message: "Network error while uploading file.",
    };
  }
}
