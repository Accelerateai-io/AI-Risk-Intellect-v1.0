import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { ingestLinks } from "../ingestLinks/ingestLinks.js";

export const cronRepeatUnitEnum = pgEnum("cron_repeat_unit", [
  "day",
  "week",
  "month",
  "year",
]);

export const cronJobSchedules = pgTable("cron_job_schedules", {
  id: varchar("id", { length: 64 }).primaryKey(),
  startDate: varchar("start_date", { length: 10 }).notNull(),
  startTime: varchar("start_time", { length: 5 }).notNull(),
  timezone: varchar("timezone", { length: 64 }).notNull().default("UTC"),
  repeat: boolean("repeat").notNull().default(true),
  repeatInterval: integer("repeat_interval").notNull().default(1),
  repeatUnit: cronRepeatUnitEnum("repeat_unit").notNull().default("week"),
  repeatDays: integer("repeat_days").array().notNull().default([]),
  endsOn: varchar("ends_on", { length: 10 }),
  active: boolean("active").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const cronJobScheduleFeeds = pgTable(
  "cron_job_schedule_feeds",
  {
    scheduleId: varchar("schedule_id", { length: 64 })
      .notNull()
      .references(() => cronJobSchedules.id, { onDelete: "cascade" }),
    ingestLinkId: integer("ingest_link_id")
      .notNull()
      .references(() => ingestLinks.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.scheduleId, table.ingestLinkId] }),
  ],
);

export type CronJobSchedule = typeof cronJobSchedules.$inferSelect;
export type CronJobScheduleFeed = typeof cronJobScheduleFeeds.$inferSelect;
