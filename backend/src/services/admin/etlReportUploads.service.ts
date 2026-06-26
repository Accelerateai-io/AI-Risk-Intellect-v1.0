import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "../../db/index.js";
import { aiidReports } from "../../schema/aiid/reports.js";
import {
  etlReportUploadItems,
  type EtlReportUploadItemStatus,
} from "../../schema/aiid/reportUploadItems.js";
import { normalizeUrl } from "../../utils/fetchUtils.js";
import {
  etlReportUploads,
  type EtlReportUpload,
  type EtlReportUploadStatus,
} from "../../schema/aiid/reportUploads.js";
import { HttpError } from "../../utils/httpError.js";
import type { EtlImportSummary } from "../../etl/etlImport.types.js";
import {
  deriveEtlExtractionStatus,
  type EtlExtractionDisplayStatus,
} from "./etlExtractionStatus.js";
import {
  deleteReportUploadFile,
  getReportUploadDisplayName,
} from "./etlReportFileStorage.js";

export type EtlReportUploadItemDto = {
  id: number;
  /** aiid_reports.id when the URL was imported (null for skipped rows). */
  reportId: number | null;
  uploadId: number;
  rowOrder: number;
  objectId: string | null;
  url: string;
  title: string | null;
  extractionStatus: EtlReportUploadItemStatus;
  skipReason: string | null;
};

const REPORT_ITEM_STATUS_RANK: Record<EtlReportUploadItemStatus, number> = {
  imported: 0,
  failed: 1,
  skipped_existing: 2,
  skipped_duplicate_in_file: 3,
  skipped_invalid: 4,
};

function normalizeReportItemUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    return normalizeUrl(trimmed);
  } catch {
    return trimmed.toLowerCase();
  }
}

/** One row per URL for export/display (prefers imported over skipped duplicates). */
export function uniqueReportUploadItemsByUrl(
  items: EtlReportUploadItemDto[],
): EtlReportUploadItemDto[] {
  const byUrl = new Map<string, EtlReportUploadItemDto>();

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

export type EtlReportUploadDto = {
  id: number;
  suggestedName: string | null;
  reportFilePath: string;
  fileName: string;
  status: EtlReportUploadStatus;
  totalRows: number;
  importedRows: number;
  skippedRows: number;
  failedRows: number;
  errorMessage: string | null;
  extractionStatus: EtlExtractionDisplayStatus;
  createdAt: string;
  updatedAt: string;
};

function toDto(row: EtlReportUpload): EtlReportUploadDto {
  return {
    id: row.id,
    suggestedName: row.suggestedName ?? null,
    reportFilePath: row.reportFilePath,
    fileName: getReportUploadDisplayName(row.reportFilePath),
    status: row.status,
    totalRows: row.totalRows,
    importedRows: row.importedRows,
    skippedRows: row.skippedRows,
    failedRows: row.failedRows,
    errorMessage: row.errorMessage ?? null,
    extractionStatus: deriveEtlExtractionStatus(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type ReportItemRef = {
  id: number;
  uploadId: number;
  url: string;
  title: string | null;
};

export async function resolveActiveReportUploadsByIds(
  ids: number[],
): Promise<EtlReportUploadDto[]> {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) {
    throw HttpError.badRequest("Select at least one upload to run.");
  }

  const rows = await db
    .select()
    .from(etlReportUploads)
    .where(
      and(
        eq(etlReportUploads.archived, false),
        inArray(etlReportUploads.id, uniqueIds),
      ),
    );

  if (rows.length !== uniqueIds.length) {
    throw HttpError.badRequest("One or more selected uploads were not found.");
  }

  const byId = new Map(rows.map((row) => [row.id, row]));
  return uniqueIds.map((id) => toDto(byId.get(id)!));
}

export async function resolveReportRefsByIds(
  reportIds: number[],
): Promise<ReportItemRef[]> {
  const uniqueIds = [...new Set(reportIds)];
  if (uniqueIds.length === 0) {
    throw HttpError.badRequest("Select at least one report URL to run.");
  }

  const rows = await db
    .select({
      id: aiidReports.id,
      uploadId: aiidReports.uploadId,
      url: aiidReports.url,
      title: aiidReports.title,
    })
    .from(aiidReports)
    .innerJoin(
      etlReportUploads,
      eq(etlReportUploads.id, aiidReports.uploadId),
    )
    .where(
      and(
        eq(etlReportUploads.archived, false),
        inArray(aiidReports.id, uniqueIds),
      ),
    );

  if (rows.length !== uniqueIds.length) {
    throw HttpError.badRequest(
      "One or more selected report URLs were not found.",
    );
  }

  const normalizedById = new Map<number, ReportItemRef>();
  for (const row of rows) {
    if (!row.uploadId) continue;
    try {
      normalizedById.set(row.id, {
        id: row.id,
        uploadId: row.uploadId,
        url: normalizeUrl(row.url),
        title: row.title,
      });
    } catch {
      // skip invalid stored URLs
    }
  }

  const refs = uniqueIds
    .map((id) => normalizedById.get(id))
    .filter((row): row is ReportItemRef => Boolean(row));

  if (refs.length === 0) {
    throw HttpError.badRequest("Selected report URLs are invalid.");
  }

  return refs;
}

export async function getReportRefsByUploadIds(
  uploadIds: number[],
): Promise<ReportItemRef[]> {
  const uniqueIds = [...new Set(uploadIds)];
  if (uniqueIds.length === 0) return [];

  const rows = await db
    .select({
      id: aiidReports.id,
      uploadId: aiidReports.uploadId,
      url: aiidReports.url,
      title: aiidReports.title,
    })
    .from(aiidReports)
    .innerJoin(
      etlReportUploads,
      eq(etlReportUploads.id, aiidReports.uploadId),
    )
    .where(
      and(
        eq(etlReportUploads.archived, false),
        inArray(aiidReports.uploadId, uniqueIds),
      ),
    )
    .orderBy(asc(aiidReports.id));

  const refs: ReportItemRef[] = [];
  for (const row of rows) {
    if (!row.uploadId) continue;
    try {
      refs.push({
        id: row.id,
        uploadId: row.uploadId,
        url: normalizeUrl(row.url),
        title: row.title,
      });
    } catch {
      // skip invalid stored URLs
    }
  }

  return refs;
}

export async function listActiveReportUploads(): Promise<EtlReportUploadDto[]> {
  const rows = await db
    .select()
    .from(etlReportUploads)
    .where(eq(etlReportUploads.archived, false))
    .orderBy(desc(etlReportUploads.createdAt));

  return rows.map(toDto);
}

export async function getActiveReportUploadById(
  id: number,
): Promise<EtlReportUpload | null> {
  const [row] = await db
    .select()
    .from(etlReportUploads)
    .where(
      and(eq(etlReportUploads.id, id), eq(etlReportUploads.archived, false)),
    )
    .limit(1);

  return row ?? null;
}

export async function clearReportRecordsForUpload(uploadId: number): Promise<void> {
  await db.delete(aiidReports).where(eq(aiidReports.uploadId, uploadId));
}

export async function createReportUpload(input: {
  suggestedName?: string;
  reportFilePath: string;
  fileSha256?: string;
}): Promise<EtlReportUpload> {
  const [row] = await db
    .insert(etlReportUploads)
    .values({
      suggestedName: input.suggestedName?.trim() || null,
      reportFilePath: input.reportFilePath,
      fileSha256: input.fileSha256 ?? null,
      status: "pending",
    })
    .returning();

  if (!row) throw HttpError.internal("Could not create report upload record.");
  return row;
}

export async function updateReportUploadProgress(
  uploadId: number,
  patch: Partial<{
    status: EtlReportUploadStatus;
    suggestedName: string | null;
    reportFilePath: string;
    fileSha256: string | null;
    totalRows: number;
    importedRows: number;
    skippedRows: number;
    failedRows: number;
    errorMessage: string | null;
  }>,
): Promise<void> {
  await db
    .update(etlReportUploads)
    .set({
      ...patch,
      updatedAt: new Date(),
    })
    .where(eq(etlReportUploads.id, uploadId));
}

export async function completeReportUpload(
  uploadId: number,
  summary: EtlImportSummary,
): Promise<void> {
  await updateReportUploadProgress(uploadId, {
    status: "completed",
    totalRows: summary.totalRows,
    importedRows: summary.importedRows,
    skippedRows: summary.skippedRows,
    failedRows: summary.failedRows,
    errorMessage: null,
  });
}

export async function failReportUpload(
  uploadId: number,
  message: string,
  partial?: Partial<EtlImportSummary>,
): Promise<void> {
  await updateReportUploadProgress(uploadId, {
    status: "failed",
    errorMessage: message,
    totalRows: partial?.totalRows,
    importedRows: partial?.importedRows,
    skippedRows: partial?.skippedRows,
    failedRows: partial?.failedRows,
  });
}

export async function findPriorUploadWithSameFile(
  fileSha256: string,
  excludeUploadId?: number,
): Promise<EtlReportUpload | null> {
  const conditions = [
    eq(etlReportUploads.fileSha256, fileSha256),
    eq(etlReportUploads.archived, false),
  ];
  if (excludeUploadId != null) {
    conditions.push(ne(etlReportUploads.id, excludeUploadId));
  }

  const [row] = await db
    .select()
    .from(etlReportUploads)
    .where(and(...conditions))
    .orderBy(desc(etlReportUploads.createdAt))
    .limit(1);

  return row ?? null;
}

export async function listReportUploadItems(
  uploadId: number,
): Promise<EtlReportUploadItemDto[]> {
  const [upload] = await db
    .select()
    .from(etlReportUploads)
    .where(eq(etlReportUploads.id, uploadId));

  if (!upload || upload.archived) {
    throw HttpError.notFound("Report upload not found.");
  }

  // Only URLs actually stored for this upload (excludes skipped_existing / duplicates).
  const reportRows = await db
    .select({
      id: aiidReports.id,
      objectId: aiidReports.objectId,
      url: aiidReports.url,
      title: aiidReports.title,
    })
    .from(aiidReports)
    .where(eq(aiidReports.uploadId, uploadId))
    .orderBy(asc(aiidReports.id));

  return reportRows.map((row, index) => ({
    id: row.id,
    reportId: row.id,
    uploadId,
    rowOrder: index + 1,
    objectId: row.objectId,
    url: row.url,
    title: row.title,
    extractionStatus: "imported" as const,
    skipReason: null,
  }));
}

export async function archiveReportUpload(id: number): Promise<EtlReportUploadDto> {
  const [existing] = await db
    .select()
    .from(etlReportUploads)
    .where(eq(etlReportUploads.id, id));

  if (!existing || existing.archived) {
    throw HttpError.notFound("Report upload not found.");
  }

  await deleteReportUploadFile(existing.reportFilePath);

  const [row] = await db
    .update(etlReportUploads)
    .set({ archived: true, updatedAt: new Date() })
    .where(eq(etlReportUploads.id, id))
    .returning();

  if (!row) {
    throw HttpError.notFound("Report upload not found.");
  }

  return toDto(row);
}
