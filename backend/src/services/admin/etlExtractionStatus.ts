import type { EtlReportUploadStatus } from "../../schema/aiid/reportUploads.js";

export const etlExtractionDisplayStatuses = [
  "pending",
  "processing",
  "completed",
  "partially_completed",
  "skipped",
  "failed",
] as const;

export type EtlExtractionDisplayStatus =
  (typeof etlExtractionDisplayStatuses)[number];

export function deriveEtlExtractionStatus(upload: {
  status: EtlReportUploadStatus;
  importedRows: number;
  skippedRows: number;
  failedRows: number;
}): EtlExtractionDisplayStatus {
  if (upload.status === "pending") return "pending";
  if (upload.status === "processing") return "processing";
  if (upload.status === "failed") return "failed";

  if (upload.importedRows === 0) {
    if (upload.skippedRows > 0) return "skipped";
    if (upload.failedRows > 0) return "failed";
    return "completed";
  }

  if (upload.skippedRows > 0 || upload.failedRows > 0) {
    return "partially_completed";
  }

  return "completed";
}

export const URLS_ALREADY_PRESENT_MESSAGE = "URLs are already present";
