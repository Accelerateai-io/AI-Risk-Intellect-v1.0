import type { NextFunction, Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "./auth.middleware.js";
import {
  authenticateApiKey,
  requestHasApiKey,
} from "./requireApiKey.middleware.js";

/**
 * Accepts either:
 * - `X-Api-Key: ari_...` / `Authorization: Bearer ari_...` (API key), or
 * - `Authorization: Bearer <JWT>` (normal UI session).
 *
 * Prefers API key when an `ari_` credential is present so external AI-Q
 * integrations do not collide with JWT validation.
 */
async function requireAuthOrApiKeyImpl(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (requestHasApiKey(req)) {
    await authenticateApiKey(req);
    next();
    return;
  }

  // Reuse JWT middleware (sets req.user + session checks).
  await new Promise<void>((resolve, reject) => {
    requireAuth(req, res, (err?: unknown) => {
      if (err) reject(err);
      else resolve();
    });
  });

  req.authMethod = "jwt";
  next();
}

export const requireAuthOrApiKey = asyncHandler(requireAuthOrApiKeyImpl);
