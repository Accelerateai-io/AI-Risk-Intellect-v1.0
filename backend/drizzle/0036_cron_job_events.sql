CREATE TYPE "public"."cron_job_event_type" AS ENUM('started', 'stopped');
--> statement-breakpoint
CREATE TABLE "cron_job_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" varchar(64) NOT NULL,
	"event_type" "cron_job_event_type" NOT NULL,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "cron_job_events_job_id_created_at_idx" ON "cron_job_events" USING btree ("job_id","created_at");
