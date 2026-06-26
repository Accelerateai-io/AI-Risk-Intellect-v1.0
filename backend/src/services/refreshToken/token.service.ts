import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { env } from "../../env.js";
import { db } from "../../db/index.js";
import { refreshTokens } from "../../schema/refreshTokens.js";
import {
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  type AccessTokenPayload,
} from "../../utils/jwt.js";
import { HttpError } from "../../utils/httpError.js";

export type IssueTokensArgs = {
  user: { id: string; email: string; username: string };
  userAgent?: string | null;
  ipAddress?: string | null;
};

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
};

function buildAccessPayload(user: IssueTokensArgs["user"]): AccessTokenPayload {
  return { sub: user.id, email: user.email, username: user.username };
}

export async function issueTokenPair(
  args: IssueTokensArgs,
): Promise<TokenPair> {
  const jti = crypto.randomUUID();
  const accessToken = signAccessToken(buildAccessPayload(args.user));
  const refreshToken = signRefreshToken({ sub: args.user.id, jti });
  const expiresAt = new Date(
    Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  );

  await db.insert(refreshTokens).values({
    id: jti,
    userId: args.user.id,
    tokenHash: hashToken(refreshToken),
    accessTokenHash: hashToken(accessToken),
    userAgent: args.userAgent ?? null,
    ipAddress: args.ipAddress ?? null,
    expiresAt,
  });

  return { accessToken, refreshToken, refreshTokenExpiresAt: expiresAt };
}

export async function rotateRefreshToken(args: {
  presentedToken: string;
  user: IssueTokensArgs["user"];
  userAgent?: string | null;
  ipAddress?: string | null;
}): Promise<TokenPair> {
  let payload;
  try {
    payload = verifyRefreshToken(args.presentedToken);
  } catch {
    throw HttpError.unauthorized("Invalid or expired refresh token");
  }

  const presentedHash = hashToken(args.presentedToken);
  const [existing] = await db
    .select()
    .from(refreshTokens)
    .where(
      and(eq(refreshTokens.id, payload.jti), eq(refreshTokens.userId, payload.sub)),
    )
    .limit(1);

  if (!existing) {
    throw HttpError.unauthorized("Refresh token not recognized");
  }

  if (existing.revoked || existing.tokenHash !== presentedHash) {
    await db
      .update(refreshTokens)
      .set({ revoked: true })
      .where(eq(refreshTokens.userId, payload.sub));
    throw HttpError.unauthorized("Refresh token reuse detected");
  }

  if (existing.expiresAt.getTime() < Date.now()) {
    throw HttpError.unauthorized("Refresh token expired");
  }

  const next = await issueTokenPair({
    user: args.user,
    userAgent: args.userAgent,
    ipAddress: args.ipAddress,
  });

  await db
    .update(refreshTokens)
    .set({ revoked: true, replacedById: extractJti(next.refreshToken) })
    .where(eq(refreshTokens.id, existing.id));

  return next;
}

export async function revokeRefreshToken(token: string): Promise<void> {
  let payload;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    return;
  }
  await db
    .update(refreshTokens)
    .set({ revoked: true })
    .where(eq(refreshTokens.id, payload.jti));
}

export async function revokeSessionByAccessToken(
  accessToken: string,
): Promise<void> {
  try {
    verifyAccessToken(accessToken);
  } catch {
    return;
  }
  const h = hashToken(accessToken);
  await db
    .update(refreshTokens)
    .set({ revoked: true })
    .where(eq(refreshTokens.accessTokenHash, h));
}

export async function revokeAllForUser(userId: string): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revoked: true })
    .where(eq(refreshTokens.userId, userId));
}

function extractJti(refreshToken: string): string {
  const payload = verifyRefreshToken(refreshToken);
  return payload.jti;
}
