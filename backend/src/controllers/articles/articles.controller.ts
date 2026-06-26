import type { Request, Response } from "express";
import { listArticles } from "../../services/articles/articles.service.js";

export async function listArticlesHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  const result = await listArticles();
  res.status(200).json(result);
}
