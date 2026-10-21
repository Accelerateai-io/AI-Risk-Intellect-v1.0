import { integer, pgTable, timestamp } from "drizzle-orm/pg-core";

/** Single-row setting for how long a URL may run before it is skipped. */
export const jobRuntimeSettings = pgTable("job_runtime_settings", {
  id: integer("id").primaryKey(),
  maxMinutes: integer("max_minutes").notNull().default(5),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
