import jwt, { type JwtPayload, type SignOptions } from "jsonwebtoken";
import crypto from "node:crypto";
import { env } from "../env.js";

export type AccessTokenPayload = {
  sub: string;
  email: string;
  username: string;
};

export type RefreshTokenPayload = {
  sub: string;
  jti: string;
};

export function signAccessToken(payload: AccessTokenPayload): string {
  const opts: SignOptions = {
    expiresIn: env.ACCESS_TOKEN_TTL as SignOptions["expiresIn"],
  };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, opts);
}

export function verifyAccessToken(token: string): AccessTokenPayload &
  JwtPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload &
    JwtPayload;
}

export function signRefreshToken(payload: RefreshTokenPayload): string {
  const opts: SignOptions = {
    expiresIn: env.REFRESH_TOKEN_TTL as SignOptions["expiresIn"],
  };
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, opts);
}

export function verifyRefreshToken(token: string): RefreshTokenPayload &
  JwtPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshTokenPayload &
    JwtPayload;
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export const INVITE_SET_PASSWORD_PURPOSE = "invite_set_password" as const;

export type InviteSetPasswordJwtPayload = {
  purpose: typeof INVITE_SET_PASSWORD_PURPOSE;
  sub: string;
  email: string;
};

export function signInviteSetPasswordToken(args: {
  sub: string;
  email: string;
}): string {
  const payload: InviteSetPasswordJwtPayload = {
    purpose: INVITE_SET_PASSWORD_PURPOSE,
    sub: args.sub,
    email: args.email,
  };
  const opts: SignOptions = {
    expiresIn: "7d",
  };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, opts);
}

export function verifyInviteSetPasswordToken(
  token: string,
): InviteSetPasswordJwtPayload {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload &
    Partial<InviteSetPasswordJwtPayload>;
  if (
    decoded.purpose !== INVITE_SET_PASSWORD_PURPOSE ||
    typeof decoded.sub !== "string" ||
    typeof decoded.email !== "string"
  ) {
    throw new jwt.JsonWebTokenError("Invalid invite token");
  }
  return {
    purpose: INVITE_SET_PASSWORD_PURPOSE,
    sub: decoded.sub,
    email: decoded.email,
  };
}

/** Decode-only (no signature check). Use after verify failed with `TokenExpiredError`. */
export function decodeInviteSetPasswordTokenUnsafe(
  token: string,
): InviteSetPasswordJwtPayload | null {
  const decoded = jwt.decode(token) as JwtPayload &
    Partial<InviteSetPasswordJwtPayload> | null;
  if (
    !decoded ||
    decoded.purpose !== INVITE_SET_PASSWORD_PURPOSE ||
    typeof decoded.sub !== "string" ||
    typeof decoded.email !== "string"
  ) {
    return null;
  }
  return {
    purpose: INVITE_SET_PASSWORD_PURPOSE,
    sub: decoded.sub,
    email: decoded.email,
  };
}
