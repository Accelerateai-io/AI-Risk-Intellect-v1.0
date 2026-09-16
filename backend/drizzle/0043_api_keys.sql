DO $$ BEGIN
  CREATE TYPE "public"."api_key_audit_action" AS ENUM('created', 'revoked', 'webhook_created', 'webhook_idempotent_hit');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."api_key_audit_actor" AS ENUM('user', 'webhook');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."webhook_delivery_status" AS ENUM('processed', 'duplicate', 'failed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(128) DEFAULT 'Default' NOT NULL,
	"key_prefix" varchar(16) NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api_key_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"api_key_id" uuid,
	"user_id" uuid NOT NULL,
	"action" "api_key_audit_action" NOT NULL,
	"actor" "api_key_audit_actor" NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" varchar(64) DEFAULT 'generic' NOT NULL,
	"delivery_id" varchar(255) NOT NULL,
	"event_type" varchar(128) NOT NULL,
	"api_key_id" uuid,
	"status" "webhook_delivery_status" DEFAULT 'processed' NOT NULL,
	"payload_hash" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "api_keys"
    ADD CONSTRAINT "api_keys_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "api_key_audit_logs"
    ADD CONSTRAINT "api_key_audit_logs_api_key_id_api_keys_id_fk"
    FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "api_key_audit_logs"
    ADD CONSTRAINT "api_key_audit_logs_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "webhook_deliveries"
    ADD CONSTRAINT "webhook_deliveries_api_key_id_api_keys_id_fk"
    FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_keys_user_id_idx" ON "api_keys" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_keys_key_prefix_idx" ON "api_keys" USING btree ("key_prefix");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_keys_revoked_at_idx" ON "api_keys" USING btree ("revoked_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_key_audit_logs_api_key_id_idx" ON "api_key_audit_logs" USING btree ("api_key_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_key_audit_logs_user_id_idx" ON "api_key_audit_logs" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_key_audit_logs_created_at_idx" ON "api_key_audit_logs" USING btree ("created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "webhook_deliveries_source_delivery_id_uidx" ON "webhook_deliveries" USING btree ("source","delivery_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_deliveries_created_at_idx" ON "webhook_deliveries" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_deliveries_api_key_id_idx" ON "webhook_deliveries" USING btree ("api_key_id");
