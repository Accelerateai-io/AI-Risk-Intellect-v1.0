import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { listArticlesHandler } from "../controllers/articles/articles.controller.js";

export const articlesRouter: Router = Router();

articlesRouter.get("/", requireAuth, asyncHandler(listArticlesHandler));
