ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "model_name" varchar(128);
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "model_label" varchar(256);
