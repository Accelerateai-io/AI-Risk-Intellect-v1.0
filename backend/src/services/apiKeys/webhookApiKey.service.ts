import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { users } from "../../schema/users/users.js";
import { apiKeyAuditLogs } from "../../schema/apiKeys/apiKeyAuditLogs.js";
import { webhookDeliveries } from "../../schema/apiKeys/webhookDeliveries.js";
import { env } from "../../env.js";
import { HttpError } from "../../utils/httpError.js";
import { logger } from "../../logger/index.js";
import {
  apiKeyToPublicDto,
  createApiKeyForUser,
  getApiKeyById,
  type ApiKeyCreatedDto,
  type ApiKeyPublicDto,
} from "./apiKeys.service.js";

const WEBHOOK_SOURCE = "generic";

export type WebhookApiKeyPayload = {
  event: string;
  userId?: string;
  email?: string;
  name?: string;
};

export type WebhookApiKeyResult =
  | { status: "created"; key: ApiKeyCreatedDto }
  | { status: "duplicate"; key: ApiKeyPublicDto };

async function resolveOwnerUser(payload: WebhookApiKeyPayload) {
  if (payload.userId) {
    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.id, payload.userId))
      .limit(1);
    if (!row) throw HttpError.notFound("User not found for webhook payload");
    if (!row.isActive) throw HttpError.forbidden("User account is inactive");
    return row;
  }

  if (payload.email) {
    const email = payload.email.trim().toLowerCase();
    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (!row) throw HttpError.notFound("User not found for webhook payload");
    if (!row.isActive) throw HttpError.forbidden("User account is inactive");
    return row;
  }

  throw HttpError.badRequest("Webhook payload must include userId or email");
}

export async function processApiKeyWebhook(args: {
  deliveryId: string;
  payload: WebhookApiKeyPayload;
  rawBody: string;
}): Promise<WebhookApiKeyResult> {
  const expectedEvent = env.WEBHOOK_API_KEY_EVENT;
  if (args.payload.event !== expectedEvent) {
    throw HttpError.badRequest(
      `Unsupported event type. Expected "${expectedEvent}"`,
    );
  }

  const [existingDelivery] = await db
    .select()
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.source, WEBHOOK_SOURCE),
        eq(webhookDeliveries.deliveryId, args.deliveryId),
      ),
    )
    .limit(1);

  if (existingDelivery) {
    if (!existingDelivery.apiKeyId)
      throw HttpError.conflict("Webhook delivery already processed");

    const keyRow = await getApiKeyById(existingDelivery.apiKeyId);
    if (!keyRow)
      throw HttpError.conflict("Webhook delivery already processed");

    await db.insert(apiKeyAuditLogs).values({
      apiKeyId: keyRow.id,
      userId: keyRow.userId,
      action: "webhook_idempotent_hit",
      actor: "webhook",
      metadata: { deliveryId: args.deliveryId },
    });

    logger.info("Webhook delivery already processed (idempotent)", {
      deliveryId: args.deliveryId,
      apiKeyId: keyRow.id,
    });
    return { status: "duplicate", key: apiKeyToPublicDto(keyRow) };
  }

  const owner = await resolveOwnerUser(args.payload);
  const payloadHash = createHash("sha256")
    .update(args.rawBody, "utf8")
    .digest("hex");

  const created = await createApiKeyForUser({
    userId: owner.id,
    name: args.payload.name,
    actor: "webhook",
    auditAction: "webhook_created",
    metadata: {
      deliveryId: args.deliveryId,
      event: args.payload.event,
    },
  });

  try {
    await db.insert(webhookDeliveries).values({
      source: WEBHOOK_SOURCE,
      deliveryId: args.deliveryId,
      eventType: args.payload.event,
      apiKeyId: created.id,
      status: "processed",
      payloadHash,
    });
  } catch (err) {
    const [race] = await db
      .select()
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.source, WEBHOOK_SOURCE),
          eq(webhookDeliveries.deliveryId, args.deliveryId),
        ),
      )
      .limit(1);

    if (race?.apiKeyId) {
      const keyRow = await getApiKeyById(race.apiKeyId);
      if (keyRow) {
        logger.warn("Webhook delivery race resolved as duplicate", {
          deliveryId: args.deliveryId,
          apiKeyId: keyRow.id,
          err: err instanceof Error ? err.message : String(err),
        });
        return { status: "duplicate", key: apiKeyToPublicDto(keyRow) };
      }
    }
    throw err;
  }

  logger.info("Webhook API key generated", {
    deliveryId: args.deliveryId,
    apiKeyId: created.id,
    userId: owner.id,
  });

  return { status: "created", key: created };
}
