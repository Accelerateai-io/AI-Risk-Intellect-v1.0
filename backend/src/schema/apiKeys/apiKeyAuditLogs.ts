import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "../users/users.js";
import { apiKeys } from "./apiKeys.js";

export const apiKeyAuditActionEnum = pgEnum("api_key_audit_action", [
  "created",
  "revoked",
  "webhook_created",
  "webhook_idempotent_hit",
]);

export const apiKeyAuditActorEnum = pgEnum("api_key_audit_actor", [
  "user",
  "webhook",
]);

export const apiKeyAuditLogs = pgTable(
  "api_key_audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    apiKeyId: uuid("api_key_id").references(() => apiKeys.id, {
      onDelete: "set null",
    }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    action: apiKeyAuditActionEnum("action").notNull(),
    actor: apiKeyAuditActorEnum("actor").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("api_key_audit_logs_api_key_id_idx").on(table.apiKeyId),
    index("api_key_audit_logs_user_id_idx").on(table.userId),
    index("api_key_audit_logs_created_at_idx").on(table.createdAt),
  ],
);

export type ApiKeyAuditLog = typeof apiKeyAuditLogs.$inferSelect;
export type NewApiKeyAuditLog = typeof apiKeyAuditLogs.$inferInsert;
