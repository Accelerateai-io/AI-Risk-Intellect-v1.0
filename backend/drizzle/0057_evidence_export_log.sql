CREATE TABLE IF NOT EXISTS "evidence_export_log" (
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
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evidence_export_log_record_id_idx" ON "evidence_export_log" USING btree ("record_id");
