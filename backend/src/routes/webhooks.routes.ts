import rateLimit from "express-rate-limit";
import { Router } from "express";
import { verifyWebhookSignature } from "../middleware/verifyWebhookSignature.middleware.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { env } from "../env.js";
import { apiKeyWebhookHandler } from "../controllers/webhooks/apiKeyWebhook.controller.js";
import { apiKeyWebhookBodySchema } from "../validators/webhooks.validators.js";

const webhookLimiter = rateLimit({
  windowMs: env.WEBHOOK_RATE_LIMIT_WINDOW_MS,
  max: env.WEBHOOK_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
  message: {
    success: false,
    message: "Too many webhook requests",
  },
});

export const webhooksRouter: Router = Router();

webhooksRouter.post(
  "/api-keys",
  webhookLimiter,
  verifyWebhookSignature,
  validate(apiKeyWebhookBodySchema),
  asyncHandler(apiKeyWebhookHandler),
);
