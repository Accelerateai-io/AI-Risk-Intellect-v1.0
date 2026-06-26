import {
  pgTable,
  serial,
  varchar,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const llmObservability = pgTable(
  "llm_observability",
  {
    id: serial("id").primaryKey(),
    modelName: varchar("model_name", { length: 128 }).notNull(),
    url: varchar("url", { length: 2048 }).notNull(),
    wordCount: integer("word_count").notNull(),
    tokensGenerated: integer("tokens_generated").notNull(),
    durationMs: integer("duration_ms").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("llm_observability_created_at_idx").on(table.createdAt),
    index("llm_observability_model_name_idx").on(table.modelName),
  ],
);

export type LlmObservabilityRow = typeof llmObservability.$inferSelect;
export type NewLlmObservabilityRow = typeof llmObservability.$inferInsert;
