import {
  integer,
  pgTable,
  real,
  serial,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { riskMappings } from "./riskMappings.js";

/** Titan embedding per catalog row; refreshed when text_hash changes. */
export const riskMappingEmbeddings = pgTable("risk_mapping_embeddings", {
  id: serial("id").primaryKey(),
  riskMappingId: integer("risk_mapping_id")
    .notNull()
    .unique()
    .references(() => riskMappings.riskMappingId, { onDelete: "cascade" }),
  model: varchar("model", { length: 128 }).notNull(),
  dims: integer("dims").notNull(),
  textHash: varchar("text_hash", { length: 64 }).notNull(),
  embedding: real("embedding").array().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type RiskMappingEmbedding = typeof riskMappingEmbeddings.$inferSelect;
