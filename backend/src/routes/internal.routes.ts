import { Router } from "express";
import { requireLocalCaller } from "../middleware/requireLocalCaller.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ensureWorkerHandler } from "../controllers/internal/services.controller.js";

export const internalRouter: Router = Router();

internalRouter.use(requireLocalCaller);

internalRouter.post(
  "/services/worker/ensure",
  asyncHandler(ensureWorkerHandler),
);
