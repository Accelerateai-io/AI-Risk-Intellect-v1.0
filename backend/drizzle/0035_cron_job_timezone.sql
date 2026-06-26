ALTER TABLE "cron_job_schedules" ADD COLUMN IF NOT EXISTS "timezone" varchar(64) DEFAULT 'UTC' NOT NULL;
