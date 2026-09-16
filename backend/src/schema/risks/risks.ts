import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  jsonb,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { articles } from "../articles/articles.js";
import { users } from "../users/users.js";

export const risks = pgTable(
  "risks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    articleId: integer("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    riskTitle: text("risk_title").notNull(),
    domains: text("domains"),
    primaryRisk: text("primary_risk"),
    secondaryRisk: text("secondary_risk"),
    sector: text("sector"),
    industry: text("industry"),
    intent: text("intent"),
    qualityScore: integer("quality_score"),
    likelihood: integer("likelihood"),
    impact: integer("impact"),
    severityScore: integer("severity_score"),
    severityBand: varchar("severity_band", { length: 16 }),
    aiProductName: text("ai_product_name"),
    aiProductVendor: text("ai_product_vendor"),
    // Human override of the model-derived quality score. The original model value
    // is preserved in `risk_edit_logs`; this flag marks the current value as human-set.
    qualityManual: boolean("quality_manual").notNull().default(false),
    // --- Human Review assignment: who SHOULD review (forward-looking, nullable, additive).
    // Distinct from extraction_json.reviewed_by, which records who DID review. ---
    assignedTo: uuid("assigned_to").references(() => users.id, {
      onDelete: "set null",
    }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    assignedBy: uuid("assigned_by").references(() => users.id, {
      onDelete: "set null",
    }),
    extractionJson: jsonb("extraction_json").notNull(),
    modelName: varchar("model_name", { length: 128 }),
    sourceFlag: varchar("source_flag", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("risks_article_id_idx").on(table.articleId),
    index("risks_primary_risk_idx").on(table.primaryRisk),
    index("risks_created_at_idx").on(table.createdAt),
    index("risks_severity_band_idx").on(table.severityBand),
    index("risks_severity_score_idx").on(table.severityScore),
    index("risks_assigned_to_idx").on(table.assignedTo),
  ],
);

export type Risk = typeof risks.$inferSelect;
export type NewRisk = typeof risks.$inferInsert;
