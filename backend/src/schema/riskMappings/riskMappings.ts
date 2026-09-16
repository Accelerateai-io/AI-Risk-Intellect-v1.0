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
    riskTitle: text("risk_title"),
    domains: text("domains"),
    description: text("description"),
    technicalDescription: text("technical_description"),
    executiveSummary: text("executive_summary"),
    attackVector: text("attack_vector"),
    observableIndicators: text("observable_indicators"),
    dataToIdentifyRisk: text("data_to_identify_risk"),
    evidenceSources: text("evidence_sources"),
    intent: text("intent"),
    timing: text("timing"),
    riskTypeDetected: text("risk_type_detected"),
    primaryRisk: text("primary_risk"),
    secondaryRisks: text("secondary_risks"),
  },
  (table) => [
    index("idx_risk_mappings_domains").on(table.domains),
    index("idx_risk_mappings_risk_type_detected").on(table.riskTypeDetected),
  ],
);

export type RiskMapping = typeof riskMappings.$inferSelect;
