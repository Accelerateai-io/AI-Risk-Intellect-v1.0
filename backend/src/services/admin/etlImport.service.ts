import path from "node:path";
import { db } from "../../db/index.js";
import { aiidReports } from "../../schema/aiid/reports.js";
import { pythonEtlImportFromPath } from "../../etl/pythonBridge.js";
import {
  ETL_INSERT_BATCH_SIZE,
  ETL_ALLOWED_EXTENSIONS,
  ETL_MAX_FILE_BYTES,
  type EtlImportSummary,
  type ParsedEtlRecord,
} from "../../etl/etlImport.types.js";
import { HttpError } from "../../utils/httpError.js";
import {
  formatDbError,
  mapRecordToRow,
} from "./etlRowSanitize.js";
import {
  clearReportRecordsForUpload,
  completeReportUpload,
  createReportUpload,
  failReportUpload,
  findPriorUploadWithSameFile,
  getActiveReportUploadById,
  updateReportUploadProgress,
} from "./etlReportUploads.service.js";
import { URLS_ALREADY_PRESENT_MESSAGE } from "./etlExtractionStatus.js";
import {
  clearReportUploadItems,
  replaceReportUploadItems,
  type ReportUploadItemOutcome,
} from "./etlReportUploadItems.service.js";
import {
  deleteReportUploadFile,
  getReportUploadDisplayName,
  hashReportUploadBuffer,
  persistReportUploadFile,
  resolveReportUploadAbsolutePath,
} from "./etlReportFileStorage.js";

export { mapRecordToRow } from "./etlRowSanitize.js";

export function validateEtlUploadFile(
  file: Express.Multer.File | undefined,
): Express.Multer.File {
  if (!file) {
    throw HttpError.badRequest("No file uploaded. Expected form field 'file'.");
  }

  if (!file.buffer?.length) {
    throw HttpError.badRequest("Uploaded file is empty.");
  }

  if (file.size > ETL_MAX_FILE_BYTES) {
    throw HttpError.badRequest(
      `File exceeds maximum size of ${ETL_MAX_FILE_BYTES} bytes.`,
    );
  }

  const ext = path.extname(file.originalname).toLowerCase();
  if (!ETL_ALLOWED_EXTENSIONS.includes(ext as (typeof ETL_ALLOWED_EXTENSIONS)[number])) {
    throw HttpError.badRequest(
      `Unsupported file type ${ext || "(none)"}. Allowed: ${ETL_ALLOWED_EXTENSIONS.join(", ")}`,
    );
  }

  return file;
}

function safeMapRecordToRow(record: ParsedEtlRecord) {
  try {
    return mapRecordToRow(record);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid row ${record.id}: ${message}`);
  }
}

export function findDuplicateUrlsInFile(urls: string[]): string[] {
  const counts = new Map<string, number>();
  const duplicates: string[] = [];

  for (const url of urls) {
    const nextCount = (counts.get(url) ?? 0) + 1;
    counts.set(url, nextCount);
    if (nextCount === 2) duplicates.push(url);
  }

  return duplicates;
}

export function dedupeRecordsByUrlInFile(records: ParsedEtlRecord[]): {
  records: ParsedEtlRecord[];
  skippedRows: number;
} {
  const seenUrls = new Set<string>();
  const kept: ParsedEtlRecord[] = [];
  let skippedRows = 0;

  for (const record of records) {
    const url = safeMapRecordToRow(record).url;
    if (seenUrls.has(url)) {
      skippedRows += 1;
      console.info("[etl-import] skipped duplicate url in file", {
        table: "aiid_reports",
        objectId: record.id,
        url,
      });
      continue;
    }

    seenUrls.add(url);
    kept.push(record);
  }

  return { records: kept, skippedRows };
}

const DUPLICATE_FILE_MESSAGE = "This file was already uploaded.";

function isBlockingDuplicateUpload(
  prior: Awaited<ReturnType<typeof findPriorUploadWithSameFile>>,
): boolean {
  return prior != null && prior.status !== "failed";
}

function buildInvalidRowOutcomes(
  parsed: Awaited<ReturnType<typeof pythonEtlImportFromPath>>,
): ReportUploadItemOutcome[] {
  const outcomes: ReportUploadItemOutcome[] = [];

  for (const detail of parsed.skippedDetails ?? []) {
    outcomes.push({
      rowOrder: detail.row,
      objectId: null,
      url: "",
      title: null,
      extractionStatus: "skipped_invalid",
      skipReason: detail.reason,
    });
  }

  for (const detail of parsed.failedDetails ?? []) {
    outcomes.push({
      rowOrder: detail.row,
      objectId: null,
      url: "",
      title: null,
      extractionStatus: "failed",
      skipReason: detail.reason,
    });
  }

  return outcomes;
}

type ParsedRecordWithRowOrder = {
  record: ParsedEtlRecord;
  rowOrder: number;
};

function splitRecordsForExtraction(records: ParsedEtlRecord[]): {
  recordsToInsert: ParsedRecordWithRowOrder[];
  duplicateOutcomes: ReportUploadItemOutcome[];
  duplicateInFileSkipped: number;
} {
  const seenUrls = new Set<string>();
  const recordsToInsert: ParsedRecordWithRowOrder[] = [];
  const duplicateOutcomes: ReportUploadItemOutcome[] = [];
  let duplicateInFileSkipped = 0;

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    const rowOrder = index + 1;
    const mapped = safeMapRecordToRow(record);

    if (seenUrls.has(mapped.url)) {
      duplicateInFileSkipped += 1;
      duplicateOutcomes.push({
        rowOrder,
        objectId: mapped.objectId,
        url: mapped.url,
        title: mapped.title,
        extractionStatus: "skipped_duplicate_in_file",
        skipReason: "Duplicate URL in file",
      });
      continue;
    }

    seenUrls.add(mapped.url);
    recordsToInsert.push({ record, rowOrder });
  }

  return { recordsToInsert, duplicateOutcomes, duplicateInFileSkipped };
}

async function parseAndImportReportUpload(
  uploadId: number,
  reportFilePath: string,
): Promise<EtlImportSummary> {
  const absolutePath = resolveReportUploadAbsolutePath(reportFilePath);
  const parsed = await pythonEtlImportFromPath(absolutePath, {
    filename: getReportUploadDisplayName(reportFilePath),
  });

  await updateReportUploadProgress(uploadId, {
    totalRows: parsed.totalRows,
  });

  if (parsed.skippedDetails?.length) {
    for (const detail of parsed.skippedDetails) {
      console.info("[etl-import] skipped row", { table: "aiid_reports", ...detail });
    }
  }

  if (parsed.failedDetails?.length) {
    for (const detail of parsed.failedDetails) {
      console.warn("[etl-import] failed row", { table: "aiid_reports", ...detail });
    }
  }

  const invalidOutcomes = buildInvalidRowOutcomes(parsed);
  const { recordsToInsert, duplicateOutcomes, duplicateInFileSkipped } =
    splitRecordsForExtraction(parsed.records);

  const insertResult = await bulkInsertReportRecords(recordsToInsert, uploadId);

  const itemOutcomes = [
    ...invalidOutcomes,
    ...duplicateOutcomes,
    ...insertResult.itemOutcomes,
  ];
  await replaceReportUploadItems(uploadId, itemOutcomes);

  return {
    totalRows: parsed.totalRows,
    importedRows: insertResult.importedRows,
    skippedRows:
      parsed.skippedRows +
      duplicateInFileSkipped +
      insertResult.skippedRows,
    failedRows: parsed.failedRows + insertResult.failedRows,
  };
}

export async function bulkInsertReportRecords(
  records: ParsedRecordWithRowOrder[],
  uploadId: number,
  batchSize = ETL_INSERT_BATCH_SIZE,
): Promise<{
  importedRows: number;
  skippedRows: number;
  failedRows: number;
  itemOutcomes: ReportUploadItemOutcome[];
}> {
  let importedRows = 0;
  let skippedRows = 0;
  let failedRows = 0;
  const itemOutcomes: ReportUploadItemOutcome[] = [];

  for (let index = 0; index < records.length; index += batchSize) {
    const recordBatch = records.slice(index, index + batchSize);
    const batch = recordBatch.map((entry) => ({
      record: entry.record,
      rowOrder: entry.rowOrder,
      row: { ...safeMapRecordToRow(entry.record), uploadId },
    }));

    try {
      const inserted = await db
        .insert(aiidReports)
        .values(batch.map((entry) => entry.row))
        .onConflictDoNothing({ target: aiidReports.url })
        .returning({ id: aiidReports.id, url: aiidReports.url });

      const insertedUrls = new Set(inserted.map((row) => row.url));
      for (let batchIndex = 0; batchIndex < batch.length; batchIndex += 1) {
        const entry = batch[batchIndex]!;
        if (insertedUrls.has(entry.row.url)) {
          importedRows += 1;
          itemOutcomes.push({
            rowOrder: entry.rowOrder,
            objectId: entry.row.objectId,
            url: entry.row.url,
            title: entry.row.title,
            extractionStatus: "imported",
            skipReason: null,
          });
        } else {
          skippedRows += 1;
          itemOutcomes.push({
            rowOrder: entry.rowOrder,
            objectId: entry.row.objectId,
            url: entry.row.url,
            title: entry.row.title,
            extractionStatus: "skipped_existing",
            skipReason: URLS_ALREADY_PRESENT_MESSAGE,
          });
        }
      }
    } catch (err) {
      console.error(
        "[etl-import] batch insert failed, falling back to row-by-row:",
        formatDbError(err),
      );

      for (let batchIndex = 0; batchIndex < batch.length; batchIndex += 1) {
        const entry = batch[batchIndex]!;
        try {
          const [inserted] = await db
            .insert(aiidReports)
            .values(entry.row)
            .onConflictDoNothing({ target: aiidReports.url })
            .returning({ id: aiidReports.id });

          if (inserted) {
            importedRows += 1;
            itemOutcomes.push({
              rowOrder: entry.rowOrder,
              objectId: entry.row.objectId,
              url: entry.row.url,
              title: entry.row.title,
              extractionStatus: "imported",
              skipReason: null,
            });
          } else {
            skippedRows += 1;
            itemOutcomes.push({
              rowOrder: entry.rowOrder,
              objectId: entry.row.objectId,
              url: entry.row.url,
              title: entry.row.title,
              extractionStatus: "skipped_existing",
              skipReason: URLS_ALREADY_PRESENT_MESSAGE,
            });
          }
        } catch (rowErr) {
          failedRows += 1;
          itemOutcomes.push({
            rowOrder: entry.rowOrder,
            objectId: entry.row.objectId,
            url: entry.row.url,
            title: entry.row.title,
            extractionStatus: "failed",
            skipReason:
              rowErr instanceof Error ? rowErr.message : "Row insert failed.",
          });
          console.error("[etl-import] row insert failed", {
            objectId: entry.row.objectId,
            error: formatDbError(rowErr),
          });
        }
      }
    }

    await updateReportUploadProgress(uploadId, {
      importedRows,
      skippedRows,
      failedRows,
    });
  }

  return { importedRows, skippedRows, failedRows, itemOutcomes };
}

/** Save uploaded CSV/Excel file only — use Extract to parse report URLs. */
export async function saveReportsFile(
  file: Express.Multer.File,
  options?: { suggestedName?: string },
): Promise<{ uploadId: number }> {
  const validated = validateEtlUploadFile(file);
  const fileSha256 = hashReportUploadBuffer(validated.buffer);

  const priorUpload = await findPriorUploadWithSameFile(fileSha256);
  if (isBlockingDuplicateUpload(priorUpload)) {
    throw HttpError.conflict(DUPLICATE_FILE_MESSAGE);
  }

  const reportFilePath = await persistReportUploadFile(
    validated.buffer,
    validated.originalname,
  );
  const upload = await createReportUpload({
    suggestedName: options?.suggestedName,
    reportFilePath,
    fileSha256,
  });

  return { uploadId: upload.id };
}

/** Parse a saved upload and import report URLs into aiid_reports. */
export async function extractReportUpload(
  uploadId: number,
): Promise<EtlImportSummary & { uploadId: number }> {
  const upload = await getActiveReportUploadById(uploadId);
  if (!upload) {
    throw HttpError.notFound("Report upload not found.");
  }

  if (upload.status === "processing") {
    throw HttpError.conflict(
      "Extraction is already in progress for this upload.",
    );
  }

  await updateReportUploadProgress(uploadId, {
    status: "processing",
    errorMessage: null,
    totalRows: 0,
    importedRows: 0,
    skippedRows: 0,
    failedRows: 0,
  });
  await clearReportUploadItems(uploadId);

  try {
    const summary = await parseAndImportReportUpload(
      uploadId,
      upload.reportFilePath,
    );

    await completeReportUpload(uploadId, summary);

    return { ...summary, uploadId };
  } catch (err) {
    const message =
      err instanceof HttpError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Report import failed.";

    await failReportUpload(uploadId, message);
    if (!(err instanceof HttpError)) {
      throw HttpError.badRequest(message);
    }
    throw err;
  }
}

/** Replace the stored file for an existing upload and reset extraction state. */
export async function reuploadReportsFile(
  uploadId: number,
  file: Express.Multer.File,
  options?: { suggestedName?: string },
): Promise<{ uploadId: number }> {
  const upload = await getActiveReportUploadById(uploadId);
  if (!upload) {
    throw HttpError.notFound("Report upload not found.");
  }

  if (upload.status === "processing") {
    throw HttpError.conflict(
      "Cannot reupload while extraction is in progress.",
    );
  }

  const validated = validateEtlUploadFile(file);
  const fileSha256 = hashReportUploadBuffer(validated.buffer);

  const priorUpload = await findPriorUploadWithSameFile(fileSha256, uploadId);
  if (isBlockingDuplicateUpload(priorUpload)) {
    throw HttpError.conflict(DUPLICATE_FILE_MESSAGE);
  }

  await deleteReportUploadFile(upload.reportFilePath);
  const reportFilePath = await persistReportUploadFile(
    validated.buffer,
    validated.originalname,
  );

  await clearReportRecordsForUpload(uploadId);
  await clearReportUploadItems(uploadId);

  const trimmedName = options?.suggestedName?.trim();
  await updateReportUploadProgress(uploadId, {
    status: "pending",
    suggestedName:
      trimmedName !== undefined ? trimmedName || null : upload.suggestedName,
    reportFilePath,
    fileSha256,
    totalRows: 0,
    importedRows: 0,
    skippedRows: 0,
    failedRows: 0,
    errorMessage: null,
  });

  return { uploadId };
}

/** @deprecated Use saveReportsFile and extractReportUpload instead. */
export async function importReportsFile(
  file: Express.Multer.File,
  options?: { suggestedName?: string },
): Promise<EtlImportSummary & { uploadId: number }> {
  const { uploadId } = await saveReportsFile(file, options);
  return extractReportUpload(uploadId);
}
