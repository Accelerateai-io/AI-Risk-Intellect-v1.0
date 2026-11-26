import type { Pool } from "pg";
import { createLogger } from "../logger/index.js";

const schemaLog = createLogger("schema");

/**
 * Idempotent: creates the Evidence Bridge export log on boot if the drizzle
 * migration (0057_evidence_export_log) has not run on this database yet.
 */
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "evidence_export_log" (
	"checkpoint" bigint PRIMARY KEY NOT NULL,
	"record_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"airi_row_id" uuid NOT NULL,
	"status" varchar(16) NOT NULL,
	"content_hash" varchar(80) NOT NULL,
	"payload" jsonb NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_export_log_record_version_uq" UNIQUE("record_id","version")
)`,
  `CREATE INDEX IF NOT EXISTS "evidence_export_log_record_id_idx" ON "evidence_export_log" USING btree ("record_id")`,
];

export async function ensureEvidenceSchema(pool: Pool): Promise<void> {
  for (const statement of STATEMENTS) {
    await pool.query(statement);
  }
  schemaLog.info("Evidence export schema ensured");
}
