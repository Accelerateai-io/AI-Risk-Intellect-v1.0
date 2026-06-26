import type { Request, Response } from "express";
import { createIngestLink } from "../../services/admin/ingestLinks.service.js";
import type { EnqueueUrlInput } from "../../validators/admin.validators.js";

export async function enqueueUrlHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const { url, suggestedName } = req.body as EnqueueUrlInput;
  const result = await createIngestLink(url, suggestedName);

  res.status(201).json({
    ok: true,
    message: "Feed URL saved. Use Extract to parse item links from the XML feed.",
    link: result.link,
    created: true,
  });
}
