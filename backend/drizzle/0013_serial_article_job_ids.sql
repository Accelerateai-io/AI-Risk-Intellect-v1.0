-- Replace UUID primary keys with serial integers (1, 2, 3, …) for articles and jobs.
-- Destructive: drops existing articles, jobs, and risks rows.

ALTER TABLE "risks" DROP CONSTRAINT IF EXISTS "risks_article_id_articles_id_fk";--> statement-breakpoint
DROP TABLE IF EXISTS "risks";--> statement-breakpoint
DROP TABLE IF EXISTS "jobs";--> statement-breakpoint
DROP TABLE IF EXISTS "articles";--> statement-breakpoint
CREATE TABLE "articles" (
	"id" serial PRIMARY KEY NOT NULL,
	"url" varchar(2048) NOT NULL,
	"title" text,
	"raw_text" text,
	"html" text,
	"sha256" varchar(64),
	"risk_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "articles_url_unique" UNIQUE("url")
);--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"article_id" integer NOT NULL,
	"url" varchar(2048) NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"job_type" "job_type" DEFAULT 'ingest' NOT NULL,
	"source" "job_source" DEFAULT 'manual' NOT NULL,
	"tries" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "articles_url_idx" ON "articles" USING btree ("url");--> statement-breakpoint
CREATE INDEX "articles_sha256_idx" ON "articles" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "articles_created_at_idx" ON "articles" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "jobs_article_id_idx" ON "jobs" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "jobs_url_idx" ON "jobs" USING btree ("url");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "jobs_created_at_idx" ON "jobs" USING btree ("created_at");--> statement-breakpoint
CREATE TABLE "risks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" integer NOT NULL,
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
CREATE INDEX "risks_article_id_idx" ON "risks" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "risks_primary_risk_idx" ON "risks" USING btree ("primary_risk");--> statement-breakpoint
CREATE INDEX "risks_created_at_idx" ON "risks" USING btree ("created_at");
