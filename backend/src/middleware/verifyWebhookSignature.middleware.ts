import { createHmac } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "../env.js";
import { HttpError } from "../utils/httpError.js";
import { timingSafeEqualHex } from "../utils/apiKeyCrypto.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const MAX_SKEW_SECONDS = 5 * 60;

declare module "express-serve-static-core" {
  interface Request {
    rawBody?: string;
    webhookDeliveryId?: string;
  }
}

function parseSignatureHeader(header: string | undefined): string | null {
  if (!header?.trim()) return null;
  const trimmed = header.trim();
  if (trimmed.startsWith("sha256=")) return trimmed.slice("sha256=".length);
  return trimmed;
}

async function verifyWebhookSignatureImpl(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const signatureHex = parseSignatureHeader(
    req.header("x-webhook-signature") ?? undefined,
  );
  const timestampRaw = req.header("x-webhook-timestamp") ?? undefined;
  const deliveryId = (req.header("x-webhook-delivery-id") ?? "").trim();

  if (!signatureHex)
    throw HttpError.unauthorized("Missing X-Webhook-Signature header");
  if (!timestampRaw)
    throw HttpError.unauthorized("Missing X-Webhook-Timestamp header");
  if (!deliveryId)
    throw HttpError.badRequest("Missing X-Webhook-Delivery-Id header");

  const timestamp = Number(timestampRaw);
  if (!Number.isFinite(timestamp))
    throw HttpError.unauthorized("Invalid X-Webhook-Timestamp");

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestamp) > MAX_SKEW_SECONDS)
    throw HttpError.unauthorized("Webhook timestamp outside allowed window");

  const rawBody =
    typeof req.rawBody === "string"
      ? req.rawBody
      : typeof req.body === "string"
        ? req.body
        : JSON.stringify(req.body ?? {});

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", env.WEBHOOK_SIGNING_SECRET)
    .update(signedPayload, "utf8")
    .digest("hex");

  if (!timingSafeEqualHex(expected, signatureHex))
    throw HttpError.unauthorized("Invalid webhook signature");

  req.webhookDeliveryId = deliveryId;
  req.rawBody = rawBody;
  next();
}

export const verifyWebhookSignature = asyncHandler(
  verifyWebhookSignatureImpl,
);
