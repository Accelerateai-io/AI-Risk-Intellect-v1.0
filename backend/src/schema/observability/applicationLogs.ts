import {
  index,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export const applicationLogs = pgTable(
  "application_logs",
  {
    id: serial("id").primaryKey(),
    level: varchar("level", { length: 16 }).notNull(),
    label: varchar("label", { length: 64 }),
    message: text("message").notNull(),
    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: text("user_agent"),
    browser: varchar("browser", { length: 64 }),
    browserVersion: varchar("browser_version", { length: 32 }),
    os: varchar("os", { length: 64 }),
    osVersion: varchar("os_version", { length: 32 }),
    device: varchar("device", { length: 128 }),
    deviceType: varchar("device_type", { length: 16 }),
    meta: jsonb("meta")
      .notNull()
      .$type<Record<string, unknown>>()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("application_logs_created_at_idx").on(table.createdAt),
    index("application_logs_level_idx").on(table.level),
    index("application_logs_label_idx").on(table.label),
    index("application_logs_ip_address_idx").on(table.ipAddress),
  ],
);

export type ApplicationLog = typeof applicationLogs.$inferSelect;
export type NewApplicationLog = typeof applicationLogs.$inferInsert;
