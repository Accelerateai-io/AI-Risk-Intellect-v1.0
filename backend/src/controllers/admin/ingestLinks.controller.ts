import type { Request, Response } from "express";
import {
  archiveIngestLink,
  extractIngestLink,
  listIngestLinks,
  listIngestLinkItems,
  restoreIngestLink,
  updateIngestLink,
} from "../../services/admin/ingestLinks.service.js";
import { buildIngestLinkItemsExcel } from "../../services/admin/ingestLinkExport.service.js";
import type { UpdateIngestLinkInput } from "../../validators/admin.validators.js";

export async function listIngestLinksHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  const links = await listIngestLinks();
  res.json({ links });
}

export async function updateIngestLinkHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const id = Number(req.params.id);
  const { url, suggestedName } = req.body as UpdateIngestLinkInput;
  const link = await updateIngestLink(id, url, suggestedName);

  res.json({
    ok: true,
    message: "Ingest link updated.",
    link,
  });
}

export async function listIngestLinkItemsHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const id = Number(req.params.id);
  const items = await listIngestLinkItems(id);
  res.json({ items });
}

export async function exportIngestLinkItemsHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const id = Number(req.params.id);
  const { buffer, fileName } = await buildIngestLinkItemsExcel(id);
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  );
  res.send(buffer);
}

export async function extractIngestLinkHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const id = Number(req.params.id);
  const result = await extractIngestLink(id);

  const parts = [
    `Found ${result.discovered} link${result.discovered === 1 ? "" : "s"} in feed.`,
    `Added ${result.inserted} new.`,
  ];
  if (result.skipped > 0) {
    parts.push(`${result.skipped} duplicate${result.skipped === 1 ? "" : "s"} skipped.`);
  }

  res.status(201).json({
    ok: true,
    message: parts.join(" "),
    link: result.link,
    discovered: result.discovered,
    inserted: result.inserted,
    skipped: result.skipped,
    items: result.items,
  });
}

export async function archiveIngestLinkHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const id = Number(req.params.id);
  const link = await archiveIngestLink(id);

  res.json({
    ok: true,
    message: "Ingest link archived.",
    link,
  });
}

export async function restoreIngestLinkHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const id = Number(req.params.id);
  const link = await restoreIngestLink(id);

  res.json({
    ok: true,
    message: "Ingest link restored.",
    link,
  });
}
