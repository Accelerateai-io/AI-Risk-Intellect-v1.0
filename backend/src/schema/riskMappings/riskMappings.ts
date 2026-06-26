import {
  index,
  integer,
  pgTable,
  serial,
  text,
  varchar,
} from "drizzle-orm/pg-core";

/** Reference taxonomy catalog (`risk_mappings` table, loaded via pg_restore). */
export const riskMappings = pgTable(
  "risk_mappings",
  {
    riskMappingId: serial("risk_mapping_id").primaryKey(),
    riskId: varchar("risk_id", { length: 255 }),
    riskTitle: varchar("risk_title", { length: 255 }),
    domains: varchar("domains", { length: 255 }),
    description: text("description"),
    technicalDescription: text("technical_description"),
    executiveSummary: text("executive_summary"),
    attackVector: varchar("attack_vector", { length: 255 }),
    observableIndicators: text("observable_indicators"),
    dataToIdentifyRisk: text("data_to_identify_risk"),
    evidenceSources: text("evidence_sources"),
    intent: varchar("intent", { length: 255 }),
    timing: varchar("timing", { length: 255 }),
    riskTypeDetected: varchar("risk_type_detected", { length: 255 }),
    primaryRisk: varchar("primary_risk", { length: 255 }),
    secondaryRisks: varchar("secondary_risks", { length: 255 }),
  },
  (table) => [
    index("idx_risk_mappings_domains").on(table.domains),
    index("idx_risk_mappings_risk_type_detected").on(table.riskTypeDetected),
  ],
);

export type RiskMapping = typeof riskMappings.$inferSelect;
