import type { NextFunction, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users } from "../schema/users/users.js";
import {
  findActiveApiKeyByPlaintext,
  findApiKeyByPlaintextAnyStatus,
  touchApiKeyLastUsed,
} from "../services/apiKeys/apiKeys.service.js";
import {
  API_KEY_PREFIX,
  isPlausibleApiKeyFormat,
  normalizeApiKey,
} from "../utils/apiKeyCrypto.js";
import { HttpError } from "../utils/httpError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import type { AccessTokenPayload } from "../utils/jwt.js";

declare module "express-serve-static-core" {
  interface Request {
    apiKey?: {
      id: string;
      userId: string;
      keyPrefix: string;
    };
    /** Set when the request was authenticated via API key. */
    authMethod?: "jwt" | "api_key";
  }
}

export function extractApiKey(req: Request): string | null {
  // Prefer X-Api-Key so a leftover Authorization: Bearer <old ari_…> in Postman
  // cannot override the intended key.
  const headerKey = req.header("x-api-key");
  if (headerKey?.trim()) return normalizeApiKey(headerKey);

  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    const token = normalizeApiKey(auth.slice("Bearer ".length));
    if (token.startsWith(API_KEY_PREFIX)) return token;
  }
  return null;
}

/** Returns true when the request is presenting an API key (not a JWT). */
export function requestHasApiKey(req: Request): boolean {
  return extractApiKey(req) != null;
}

export async function authenticateApiKey(req: Request): Promise<void> {
  const plaintext = extractApiKey(req);
  if (!plaintext)
    throw HttpError.unauthorized(
      "Missing API key. Send header X-Api-Key: ari_... (not in the URL).",
    );

  if (!isPlausibleApiKeyFormat(plaintext))
    throw HttpError.unauthorized(
      "Invalid API key format. Use the full key (ari_ + 64 hex chars), not the short prefix from the table.",
    );

  const keyRow = await findActiveApiKeyByPlaintext(plaintext);
  if (!keyRow) {
    const prefix = `${plaintext.slice(0, 12)}…`;
    const anyStatus = await findApiKeyByPlaintextAnyStatus(plaintext);
    if (anyStatus?.revokedAt)
      throw HttpError.unauthorized(
        `This API key (${prefix}) was revoked. In Postman: Authorization → No Auth, and set only Headers → X-Api-Key to a new full key. Then generate a fresh key in the app.`,
      );
    throw HttpError.unauthorized(
      `API key (${prefix}) not recognized. Paste the full key from generation into Headers → X-Api-Key. Clear Authorization (No Auth). If lost, generate a new key.`,
    );
  }

  const [owner] = await db
    .select({
      id: users.id,
      email: users.email,
      username: users.username,
      role: users.role,
      isActive: users.isActive,
    })
    .from(users)
    .where(and(eq(users.id, keyRow.userId), eq(users.isActive, true)))
    .limit(1);

  if (!owner) throw HttpError.unauthorized("API key owner is inactive");

  req.apiKey = {
    id: keyRow.id,
    userId: keyRow.userId,
    keyPrefix: keyRow.keyPrefix,
  };
  req.user = {
    sub: owner.id,
    email: owner.email,
    username: owner.username,
    role: owner.role,
  } satisfies AccessTokenPayload;
  req.authMethod = "api_key";

  void touchApiKeyLastUsed(keyRow.id);
}

async function requireApiKeyImpl(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  await authenticateApiKey(req);
  next();
}

/** Authenticates via `X-Api-Key` or `Authorization: Bearer ari_...` only. */
export const requireApiKey = asyncHandler(requireApiKeyImpl);
