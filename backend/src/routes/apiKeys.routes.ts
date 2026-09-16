import rateLimit from "express-rate-limit";
import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireApiKey } from "../middleware/requireApiKey.middleware.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { env } from "../env.js";
import {
  createApiKeyHandler,
  listApiKeysHandler,
  revokeApiKeyHandler,
  verifyApiKeyHandler,
} from "../controllers/apiKeys/apiKeys.controller.js";
import {
  apiKeyIdParamSchema,
  createApiKeySchema,
} from "../validators/apiKeys.validators.js";

const createApiKeyLimiter = rateLimit({
  windowMs: env.API_KEY_CREATE_RATE_LIMIT_WINDOW_MS,
  max: env.API_KEY_CREATE_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
  message: {
    success: false,
    message: "Too many API key creation requests",
  },
});

export const apiKeysRouter: Router = Router();

apiKeysRouter.get("/", requireAuth, asyncHandler(listApiKeysHandler));

apiKeysRouter.post(
  "/",
  requireAuth,
  createApiKeyLimiter,
  validate(createApiKeySchema),
  asyncHandler(createApiKeyHandler),
);

/** Check whether an API key is valid (no JWT required). */
apiKeysRouter.get(
  "/verify",
  requireApiKey,
  asyncHandler(verifyApiKeyHandler),
);

apiKeysRouter.post(
  "/:id/revoke",
  requireAuth,
  validate(apiKeyIdParamSchema, "params"),
  asyncHandler(revokeApiKeyHandler),
);
