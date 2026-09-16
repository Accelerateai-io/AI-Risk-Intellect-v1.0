import { Router } from "express";
import { requireAuthOrApiKey } from "../middleware/requireAuthOrApiKey.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { listNotificationsHandler } from "./notifications.controller.js";

export const notificationsRouter: Router = Router();

notificationsRouter.get(
  "/",
  requireAuthOrApiKey,
  asyncHandler(listNotificationsHandler),
);
