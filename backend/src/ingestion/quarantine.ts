import { eq } from "drizzle-orm";
import { db } from "../database/db.js";
import { createLogger } from "../logger/logger.js";
import { urlQuarantine } from "../schema/jobs/urlQuarantine.js";

const log = createLogger("quarantine");

export type QuarantineInput = {
  url: string;
  title?: string;
  extractedText?: string;
  qualityScore?: number | null;
  validation?: unknown;
  reason: string;
  httpStatus?: number | null;
  responseMeta?: unknown;
  sourceType?: "html" | "pdf" | null;
  status: "fetch_quarantine" | "extraction_quarantine";
};

/** Upsert a quarantine row. A later successful ingest marks the same URL released. */
export async function recordQuarantine(input: QuarantineInput): Promise<void> {
  const now = new Date();
  try {
    await db
      .insert(urlQuarantine)
      .values({
        url: input.url,
        title: input.title ?? null,
        extractedText: input.extractedText ?? null,
        qualityScore: input.qualityScore ?? null,
        validation: input.validation ?? null,
        reason: input.reason,
        httpStatus: input.httpStatus ?? null,
        responseMeta: input.responseMeta ?? null,
        sourceType: input.sourceType ?? null,
        status: input.status,
        quarantinedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: urlQuarantine.url,
        set: {
          title: input.title ?? null,
          extractedText: input.extractedText ?? null,
          qualityScore: input.qualityScore ?? null,
          validation: input.validation ?? null,
          reason: input.reason,
          httpStatus: input.httpStatus ?? null,
          responseMeta: input.responseMeta ?? null,
          sourceType: input.sourceType ?? null,
          status: input.status,
          quarantinedAt: now,
          updatedAt: now,
        },
      });
  } catch (err) {
    log.warn("could not store quarantine row", {
      url: input.url,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function releaseQuarantine(url: string): Promise<void> {
  try {
    await db
      .update(urlQuarantine)
      .set({ status: "released", updatedAt: new Date() })
      .where(eq(urlQuarantine.url, url));
  } catch (err) {
    log.warn("could not release quarantine row", {
      url,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
