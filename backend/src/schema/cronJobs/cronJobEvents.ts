import {
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export const cronJobEventTypeEnum = pgEnum("cron_job_event_type", [
  "started",
  "stopped",
  "scheduled",
  "completed",
]);

export const cronJobEvents = pgTable("cron_job_events", {
  id: serial("id").primaryKey(),
  jobId: varchar("job_id", { length: 64 }).notNull(),
  eventType: cronJobEventTypeEnum("event_type").notNull(),
  message: text("message"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type CronJobEvent = typeof cronJobEvents.$inferSelect;
