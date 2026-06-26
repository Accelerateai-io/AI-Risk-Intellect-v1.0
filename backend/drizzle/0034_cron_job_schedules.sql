CREATE TYPE "public"."cron_repeat_unit" AS ENUM('day', 'week', 'month', 'year');
--> statement-breakpoint
CREATE TABLE "cron_job_schedules" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"start_date" varchar(10) NOT NULL,
	"start_time" varchar(5) NOT NULL,
	"repeat" boolean DEFAULT true NOT NULL,
	"repeat_interval" integer DEFAULT 1 NOT NULL,
	"repeat_unit" "cron_repeat_unit" DEFAULT 'week' NOT NULL,
	"repeat_days" integer[] DEFAULT '{}' NOT NULL,
	"ends_on" varchar(10),
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cron_job_schedule_feeds" (
	"schedule_id" varchar(64) NOT NULL,
	"ingest_link_id" integer NOT NULL,
	CONSTRAINT "cron_job_schedule_feeds_schedule_id_ingest_link_id_pk" PRIMARY KEY("schedule_id","ingest_link_id")
);
--> statement-breakpoint
ALTER TABLE "cron_job_schedule_feeds" ADD CONSTRAINT "cron_job_schedule_feeds_schedule_id_cron_job_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."cron_job_schedules"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cron_job_schedule_feeds" ADD CONSTRAINT "cron_job_schedule_feeds_ingest_link_id_ingest_links_id_fk" FOREIGN KEY ("ingest_link_id") REFERENCES "public"."ingest_links"("id") ON DELETE cascade ON UPDATE no action;
