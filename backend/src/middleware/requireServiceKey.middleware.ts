import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/**
 * Service-to-service auth for machine callers (e.g. AI-Q's Risk Intellect client).
 *
 * Distinct from user auth (`requireAuth`, JWT): this gate protects the JSON
 * service export (`GET /api/v1/risks/export`) with a shared `SERVICE_API_KEY`
 * presented via the `X-API-Key` header.
 *
 * Fails closed: if `SERVICE_API_KEY` is unset the endpoint is unusable (401) in
 * every environment, so a misconfigured production deploy can never serve data
 * unauthenticated. Comparison is constant-time to avoid leaking the key by timing.
 */
export function requireServiceKey(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const expected = (process.env.SERVICE_API_KEY ?? "").trim();
  const provided = (req.header("x-api-key") ?? "").trim();

  const reject = (message: string): void => {
    res.status(401).json({ ok: false, error: { message } });
  };

  // Fail closed: no configured key => no access anywhere (never serve unauthenticated).
  if (!expected) {
    reject("Service authentication is not configured.");
    return;
  }
  if (!provided) {
    reject("Missing API key.");
    return;
  }

  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  const matches =
    providedBuf.length === expectedBuf.length &&
    crypto.timingSafeEqual(providedBuf, expectedBuf);

  if (!matches) {
    reject("Invalid API key.");
    return;
  }

  next();
}
