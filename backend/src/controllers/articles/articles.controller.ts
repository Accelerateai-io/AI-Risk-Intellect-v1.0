import type { Request, Response } from "express";
import { listArticles } from "../../services/articles/articles.service.js";
import { listArticlesQuerySchema } from "../../validators/articles.validators.js";

export async function listArticlesHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const query = listArticlesQuerySchema.parse(req.query);
  const result = await listArticles(query);
  res.status(200).json(result);
}
