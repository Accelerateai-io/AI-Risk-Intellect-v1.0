import type { Request, Response } from "express";
import { processApiKeyWebhook } from "../../services/apiKeys/webhookApiKey.service.js";
import type { ApiKeyWebhookBody } from "../../validators/webhooks.validators.js";
import { HttpError } from "../../utils/httpError.js";

export async function apiKeyWebhookHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const deliveryId = req.webhookDeliveryId;
  if (!deliveryId) throw HttpError.badRequest("Missing webhook delivery id");

  const rawBody =
    typeof req.rawBody === "string"
      ? req.rawBody
      : JSON.stringify(req.body ?? {});

  const result = await processApiKeyWebhook({
    deliveryId,
    payload: req.body as ApiKeyWebhookBody,
    rawBody,
  });

  if (result.status === "duplicate") {
    res.status(200).json({
      ok: true,
      duplicate: true,
      key: {
        id: result.key.id,
        name: result.key.name,
        keyPrefix: result.key.keyPrefix,
        createdAt: result.key.createdAt,
        revokedAt: result.key.revokedAt,
      },
    });
    return;
  }

  res.status(201).json({
    ok: true,
    duplicate: false,
    key: {
      id: result.key.id,
      name: result.key.name,
      keyPrefix: result.key.keyPrefix,
      plaintext: result.key.plaintext,
      createdAt: result.key.createdAt,
    },
  });
}
