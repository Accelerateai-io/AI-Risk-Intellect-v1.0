import type { NextFunction, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { refreshTokens } from "../schema/refreshTokens.js";
import {
  hashToken,
  verifyAccessToken,
  type AccessTokenPayload,
} from "../utils/jwt.js";
import { HttpError } from "../utils/httpError.js";
import { asyncHandler } from "../utils/asyncHandler.js";

declare module "express-serve-static-core" {
  interface Request {
    user?: AccessTokenPayload;
  }
}

async function requireAuthImpl(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    next(HttpError.unauthorized("Missing access token"));
    return;
  }
  const token = header.slice("Bearer ".length).trim();
  let payload: AccessTokenPayload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    next(HttpError.unauthorized("Invalid or expired access token"));
    return;
  }

  const accessHash = hashToken(token);
  const [session] = await db
    .select({ id: refreshTokens.id })
    .from(refreshTokens)
    .where(
      and(
        eq(refreshTokens.accessTokenHash, accessHash),
        eq(refreshTokens.revoked, false),
        eq(refreshTokens.userId, payload.sub),
      ),
    )
    .limit(1);

  if (!session) {
    next(
      HttpError.unauthorized(
        "Access token not recognized or session has ended",
      ),
    );
    return;
  }

  req.user = {
    sub: payload.sub,
    email: payload.email,
    username: payload.username,
  };
  next();
}

/** Validates Bearer JWT and that the access token is still active in the database. */
export const requireAuth = asyncHandler(requireAuthImpl);
