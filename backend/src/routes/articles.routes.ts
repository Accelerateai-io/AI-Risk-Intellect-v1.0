import { Router } from "express";
import { requireAuthOrApiKey } from "../middleware/requireAuthOrApiKey.middleware.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { listArticlesHandler } from "../controllers/articles/articles.controller.js";
import { listArticlesQuerySchema } from "../validators/articles.validators.js";

export const articlesRouter: Router = Router();

articlesRouter.get(
  "/",
  requireAuthOrApiKey,
  validate(listArticlesQuerySchema, "query"),
  asyncHandler(listArticlesHandler),
);
