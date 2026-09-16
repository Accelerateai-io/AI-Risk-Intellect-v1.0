import {
  integer,
  pgTable,
  real,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { risks } from "./risks.js";

/** Titan embedding per extracted risk; used for matching and dedup. */
export const riskEmbeddings = pgTable("risk_embeddings", {
  riskId: uuid("risk_id")
    .primaryKey()
    .references(() => risks.id, { onDelete: "cascade" }),
  model: varchar("model", { length: 128 }).notNull(),
  dims: integer("dims").notNull(),
  textHash: varchar("text_hash", { length: 64 }).notNull(),
  embedding: real("embedding").array().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type RiskEmbedding = typeof riskEmbeddings.$inferSelect;
