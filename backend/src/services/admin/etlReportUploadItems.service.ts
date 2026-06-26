import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  etlReportUploadItems,
  type EtlReportUploadItemStatus,
} from "../../schema/aiid/reportUploadItems.js";
import { ETL_INSERT_BATCH_SIZE } from "../../etl/etlImport.types.js";

export type ReportUploadItemOutcome = {
  rowOrder: number;
  objectId: string | null;
  url: string;
  title: string | null;
  extractionStatus: EtlReportUploadItemStatus;
  skipReason: string | null;
};

export async function clearReportUploadItems(uploadId: number): Promise<void> {
  await db
    .delete(etlReportUploadItems)
    .where(eq(etlReportUploadItems.uploadId, uploadId));
}

export async function replaceReportUploadItems(
  uploadId: number,
  outcomes: ReportUploadItemOutcome[],
): Promise<void> {
  await clearReportUploadItems(uploadId);
  if (outcomes.length === 0) return;

  const sorted = [...outcomes].sort((a, b) => a.rowOrder - b.rowOrder);
  for (let offset = 0; offset < sorted.length; offset += ETL_INSERT_BATCH_SIZE) {
    const batch = sorted.slice(offset, offset + ETL_INSERT_BATCH_SIZE);
    await db.insert(etlReportUploadItems).values(
      batch.map((item) => ({
        uploadId,
        rowOrder: item.rowOrder,
        objectId: item.objectId,
        url: item.url,
        title: item.title,
        extractionStatus: item.extractionStatus,
        skipReason: item.skipReason,
      })),
    );
  }
}
