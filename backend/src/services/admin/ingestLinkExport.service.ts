import * as XLSX from "xlsx";
import { asc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { ingestLinkItems } from "../../schema/ingestLinks/ingestLinkItems.js";
import { ingestLinks } from "../../schema/ingestLinks/ingestLinks.js";
import { HttpError } from "../../utils/httpError.js";

function safeFilenamePart(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned.slice(0, 80) || "feed";
}

export async function buildIngestLinkItemsExcel(ingestLinkId: number): Promise<{
  buffer: Buffer;
  fileName: string;
}> {
  const [link] = await db
    .select()
    .from(ingestLinks)
    .where(eq(ingestLinks.id, ingestLinkId));

  if (!link) {
    throw HttpError.notFound("Ingest link not found.");
  }

  const rows = await db
    .select({ url: ingestLinkItems.url })
    .from(ingestLinkItems)
    .where(eq(ingestLinkItems.ingestLinkId, ingestLinkId))
    .orderBy(asc(ingestLinkItems.id));

  const urls = rows
    .map((row) => row.url.trim())
    .filter((url) => url.length > 0);

  if (urls.length === 0) {
    throw HttpError.badRequest(
      "No article URLs stored for this feed. Run Extract first.",
    );
  }

  const sheetRows: Array<[number, string]> = urls.map((url, index) => [
    index + 1,
    url,
  ]);

  const worksheet = XLSX.utils.aoa_to_sheet([
    ["#", "Article URL"],
    ...sheetRows,
  ]);
  worksheet["!cols"] = [{ wch: 6 }, { wch: 96 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Article URLs");
  const buffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
  }) as Buffer;

  const label = link.suggestedName?.trim() || link.url;
  const fileName = `feed-urls-${ingestLinkId}-${safeFilenamePart(label)}.xlsx`;

  return { buffer, fileName };
}
