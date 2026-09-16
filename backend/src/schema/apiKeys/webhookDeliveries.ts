import {
  index,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { apiKeys } from "./apiKeys.js";

export const webhookDeliveryStatusEnum = pgEnum("webhook_delivery_status", [
  "processed",
  "duplicate",
  "failed",
]);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: varchar("source", { length: 64 }).notNull().default("generic"),
    deliveryId: varchar("delivery_id", { length: 255 }).notNull(),
    eventType: varchar("event_type", { length: 128 }).notNull(),
    apiKeyId: uuid("api_key_id").references(() => apiKeys.id, {
      onDelete: "set null",
    }),
    status: webhookDeliveryStatusEnum("status").notNull().default("processed"),
    payloadHash: varchar("payload_hash", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("webhook_deliveries_source_delivery_id_uidx").on(
      table.source,
      table.deliveryId,
    ),
    index("webhook_deliveries_created_at_idx").on(table.createdAt),
    index("webhook_deliveries_api_key_id_idx").on(table.apiKeyId),
  ],
);

export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDelivery = typeof webhookDeliveries.$inferInsert;
