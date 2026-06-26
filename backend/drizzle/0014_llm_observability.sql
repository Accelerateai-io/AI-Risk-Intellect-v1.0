CREATE TABLE IF NOT EXISTS "llm_observability" (
	"id" serial PRIMARY KEY NOT NULL,
	"model_name" varchar(128) NOT NULL,
	"url" varchar(2048) NOT NULL,
	"word_count" integer NOT NULL,
	"tokens_generated" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_observability_created_at_idx" ON "llm_observability" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_observability_model_name_idx" ON "llm_observability" USING btree ("model_name");
