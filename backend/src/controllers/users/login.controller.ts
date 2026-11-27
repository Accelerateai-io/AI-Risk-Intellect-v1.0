import type { CookieOptions, Request, Response } from "express";
import { env } from "../../env.js";
import { HttpError } from "../../utils/httpError.js";
import {
  authenticateUser,
  changeMyPassword,
  completeInviteSetPassword,
  getInviteSetPasswordPreview,
  getUserById,
  registerUser,
  updateMyProfile,
} from "../../services/auth/auth.service.js";
import {
  completePasswordReset,
  requestPasswordReset,
} from "../../services/resetPassword/passwordReset.service.js";
import {
  issueTokenPair,
  revokeRefreshToken,
  revokeSessionByAccessToken,
  revokeAllForUser,
  rotateRefreshToken,
} from "../../services/refreshToken/token.service.js";
import type {
  ChangeMyPasswordInput,
  ForgotPasswordInput,
  InviteSetPasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
  UpdateMyProfileInput,
} from "../../validators/auth.validators.js";
import { getClientIp } from "../../utils/requestClient.js";

const REFRESH_COOKIE_NAME = "refresh_token";

function refreshCookieOptions(req: Request, expiresAt?: Date): CookieOptions {
  const secure = env.COOKIE_SECURE || req.secure;
  const domain = env.COOKIE_DOMAIN?.trim();
  // Same host as the dashboard (devairi.accelerateai.io). Lax is sent on
  // same-site XHR. None is for a cross-site API and is dropped by browsers
  // when Secure or the site partition does not match, which shows up as a
  // 401 on POST /auth/refresh and then "Session expired".
  // Path "/" so the cookie is sent wherever the deployed API is mounted.
  return {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    ...(domain ? { domain } : {}),
    expires: expiresAt,
  };
}

function setRefreshCookie(
  req: Request,
  res: Response,
  token: string,
  expiresAt?: Date,
): void {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: "/api/v1" });
  res.cookie(REFRESH_COOKIE_NAME, token, refreshCookieOptions(req, expiresAt));
}

function clientMeta(req: Request) {
  const userAgent = req.headers["user-agent"];
  return {
    userAgent: Array.isArray(userAgent) ? userAgent[0] ?? null : userAgent ?? null,
    ipAddress: getClientIp(req),
  };
}

function queryToken(req: Request): string {
  const raw = req.query.token;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0];
  return "";
}

export async function inviteSetPasswordPreview(
  req: Request,
  res: Response,
): Promise<void> {
  const token = queryToken(req);
  const { email } = await getInviteSetPasswordPreview(token);
  res.status(200).json({ email });
}

export async function inviteSetPasswordSubmit(
  req: Request,
  res: Response,
): Promise<void> {
  const { token, password } = req.body as InviteSetPasswordInput;
  const user = await completeInviteSetPassword(token, password);
  const meta = clientMeta(req);
  const tokens = await issueTokenPair({ user, ...meta });

  setRefreshCookie(req, res, tokens.refreshToken, tokens.refreshTokenExpiresAt);

  res.status(200).json({
    user,
    accessToken: tokens.accessToken,
    expiresIn: env.ACCESS_TOKEN_TTL,
  });
}

export async function register(req: Request, res: Response): Promise<void> {
  const input = req.body as RegisterInput;
  const user = await registerUser(input);
  const meta = clientMeta(req);
  const tokens = await issueTokenPair({ user, ...meta });

  setRefreshCookie(req, res, tokens.refreshToken, tokens.refreshTokenExpiresAt);

  res.status(201).json({
    user,
    accessToken: tokens.accessToken,
    expiresIn: env.ACCESS_TOKEN_TTL,
  });
}

export async function login(req: Request, res: Response): Promise<void> {
  const input = req.body as LoginInput;
  const user = await authenticateUser(input);
  const meta = clientMeta(req);
  const tokens = await issueTokenPair({ user, ...meta });

  setRefreshCookie(req, res, tokens.refreshToken, tokens.refreshTokenExpiresAt);

  res.status(200).json({
    user,
    accessToken: tokens.accessToken,
    expiresIn: env.ACCESS_TOKEN_TTL,
  });
}

export async function forgotPassword(
  req: Request,
  res: Response,
): Promise<void> {
  const { email } = req.body as ForgotPasswordInput;
  await requestPasswordReset(email);
  res.status(200).json({
    message: "Password reset instructions were sent to your email.",
  });
}

export async function resetPassword(
  req: Request,
  res: Response,
): Promise<void> {
  const { token, password } = req.body as ResetPasswordInput;
  const user = await completePasswordReset(token, password);
  const meta = clientMeta(req);
  const tokens = await issueTokenPair({ user, ...meta });

  setRefreshCookie(req, res, tokens.refreshToken, tokens.refreshTokenExpiresAt);

  res.status(200).json({
    user,
    accessToken: tokens.accessToken,
    expiresIn: env.ACCESS_TOKEN_TTL,
  });
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const presented = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
  if (!presented) {
    throw HttpError.unauthorized("Missing refresh token");
  }

  const meta = clientMeta(req);
  const decodedSub = decodeSub(presented);
  const user = await getUserById(decodedSub);
  if (!user) {
    throw HttpError.unauthorized("User no longer exists");
  }

  const tokens = await rotateRefreshToken({
    presentedToken: presented,
    user,
    ...meta,
  });

  setRefreshCookie(req, res, tokens.refreshToken, tokens.refreshTokenExpiresAt);

  res.status(200).json({
    user,
    accessToken: tokens.accessToken,
    expiresIn: env.ACCESS_TOKEN_TTL,
  });
}

export async function logout(req: Request, res: Response): Promise<void> {
  const bearer = req.headers.authorization;
  if (bearer?.startsWith("Bearer ")) {
    await revokeSessionByAccessToken(bearer.slice("Bearer ".length).trim());
  }
  const presented = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
  if (presented) {
    await revokeRefreshToken(presented);
  }
  res.clearCookie(REFRESH_COOKIE_NAME, { path: "/api/v1" });
  res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions(req));
  res.status(204).end();
}

export async function me(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw HttpError.unauthorized();
  }
  const user = await getUserById(req.user.sub);
  if (!user) {
    throw HttpError.unauthorized("User no longer exists");
  }
  res.status(200).json({ user });
}

function bearerAccessToken(req: Request): string {
  const bearer = req.headers.authorization;
  if (!bearer?.startsWith("Bearer ")) {
    throw HttpError.unauthorized("Missing access token");
  }
  return bearer.slice("Bearer ".length).trim();
}

export async function patchMe(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw HttpError.unauthorized();
  }
  const { username, fullName, reason } = req.body as UpdateMyProfileInput;
  const accessToken = bearerAccessToken(req);
  const user = await updateMyProfile(req.user.sub, { username, fullName, reason });
  await revokeSessionByAccessToken(accessToken);
  const meta = clientMeta(req);
  const tokens = await issueTokenPair({ user, ...meta });

  setRefreshCookie(req, res, tokens.refreshToken, tokens.refreshTokenExpiresAt);

  res.status(200).json({
    user,
    accessToken: tokens.accessToken,
    expiresIn: env.ACCESS_TOKEN_TTL,
  });
}

export async function postMeChangePassword(
  req: Request,
  res: Response,
): Promise<void> {
  if (!req.user) {
    throw HttpError.unauthorized();
  }
  const { currentPassword, newPassword } = req.body as ChangeMyPasswordInput;
  const user = await changeMyPassword(
    req.user.sub,
    currentPassword,
    newPassword,
  );
  await revokeAllForUser(req.user.sub);
  const meta = clientMeta(req);
  const tokens = await issueTokenPair({ user, ...meta });

  setRefreshCookie(req, res, tokens.refreshToken, tokens.refreshTokenExpiresAt);

  res.status(200).json({
    user,
    accessToken: tokens.accessToken,
    expiresIn: env.ACCESS_TOKEN_TTL,
  });
}

function decodeSub(refreshToken: string): string {
  const parts = refreshToken.split(".");
  if (parts.length !== 3) {
    throw HttpError.unauthorized("Malformed refresh token");
  }
  try {
    const payloadJson = Buffer.from(parts[1] ?? "", "base64url").toString(
      "utf8",
    );
    const payload = JSON.parse(payloadJson) as { sub?: unknown };
    if (typeof payload.sub !== "string") {
      throw new Error("missing sub");
    }
    return payload.sub;
  } catch {
    throw HttpError.unauthorized("Malformed refresh token");
  }
}
