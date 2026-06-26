CREATE TABLE IF NOT EXISTS "risks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"risk_title" text NOT NULL,
	"domains" text,
	"primary_risk" varchar(128),
	"secondary_risk" varchar(256),
	"sector" varchar(128),
	"industry" varchar(256),
	"intent" varchar(128),
	"quality_score" integer,
	"extraction_json" jsonb NOT NULL,
	"model_name" varchar(128),
	"source_flag" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "risks" ADD CONSTRAINT "risks_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "risks_article_id_idx" ON "risks" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "risks_primary_risk_idx" ON "risks" USING btree ("primary_risk");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "risks_created_at_idx" ON "risks" USING btree ("created_at");
