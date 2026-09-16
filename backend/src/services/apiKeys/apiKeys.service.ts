import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../../db/index.js";
import { apiKeys } from "../../schema/apiKeys/apiKeys.js";
import { apiKeyAuditLogs } from "../../schema/apiKeys/apiKeyAuditLogs.js";
import { generateApiKey, hashApiKey } from "../../utils/apiKeyCrypto.js";
import { HttpError } from "../../utils/httpError.js";
import { logger } from "../../logger/index.js";

export type ApiKeyPublicDto = {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ApiKeyCreatedDto = ApiKeyPublicDto & {
  plaintext: string;
};

function toPublicDto(row: typeof apiKeys.$inferSelect): ApiKeyPublicDto {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.keyPrefix,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listApiKeysForUser(userId: string): Promise<ApiKeyPublicDto[]> {
  const rows = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))
    .orderBy(desc(apiKeys.createdAt));

  return rows.map(toPublicDto);
}

export async function createApiKeyForUser(args: {
  userId: string;
  name?: string;
  actor: "user" | "webhook";
  auditAction: "created" | "webhook_created";
  metadata?: Record<string, unknown>;
}): Promise<ApiKeyCreatedDto> {
  const { plaintext, keyHash, keyPrefix } = generateApiKey();
  const name = (args.name?.trim() || "Default").slice(0, 128);
  const now = new Date();

  const [row] = await db
    .insert(apiKeys)
    .values({
      userId: args.userId,
      name,
      keyPrefix,
      keyHash,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!row) throw HttpError.internal("Failed to create API key");

  await db.insert(apiKeyAuditLogs).values({
    apiKeyId: row.id,
    userId: args.userId,
    action: args.auditAction,
    actor: args.actor,
    metadata: args.metadata ?? null,
  });

  logger.info("API key created", {
    apiKeyId: row.id,
    userId: args.userId,
    actor: args.actor,
    keyPrefix,
  });

  return {
    ...toPublicDto(row),
    plaintext,
  };
}

export async function revokeApiKeyForUser(args: {
  userId: string;
  apiKeyId: string;
}): Promise<ApiKeyPublicDto> {
  const [existing] = await db
    .select()
    .from(apiKeys)
    .where(
      and(eq(apiKeys.id, args.apiKeyId), eq(apiKeys.userId, args.userId)),
    )
    .limit(1);

  if (!existing) throw HttpError.notFound("API key not found");
  if (existing.revokedAt) throw HttpError.conflict("API key is already revoked");

  const now = new Date();
  const [updated] = await db
    .update(apiKeys)
    .set({ revokedAt: now, updatedAt: now })
    .where(eq(apiKeys.id, existing.id))
    .returning();

  if (!updated) throw HttpError.internal("Failed to revoke API key");

  await db.insert(apiKeyAuditLogs).values({
    apiKeyId: updated.id,
    userId: args.userId,
    action: "revoked",
    actor: "user",
    metadata: { keyPrefix: updated.keyPrefix },
  });

  logger.info("API key revoked", {
    apiKeyId: updated.id,
    userId: args.userId,
    keyPrefix: updated.keyPrefix,
  });

  return toPublicDto(updated);
}

export async function findActiveApiKeyByPlaintext(plaintext: string) {
  const keyHash = hashApiKey(plaintext);
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
    .limit(1);
  return row ?? null;
}

/** Lookup by hash including revoked keys (for clearer error messages). */
export async function findApiKeyByPlaintextAnyStatus(plaintext: string) {
  const keyHash = hashApiKey(plaintext);
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, keyHash))
    .limit(1);
  return row ?? null;
}

export async function touchApiKeyLastUsed(apiKeyId: string): Promise<void> {
  const now = new Date();
  await db
    .update(apiKeys)
    .set({ lastUsedAt: now, updatedAt: now })
    .where(eq(apiKeys.id, apiKeyId));
}

export async function getApiKeyById(apiKeyId: string) {
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.id, apiKeyId))
    .limit(1);
  return row ?? null;
}

export { toPublicDto as apiKeyToPublicDto };
