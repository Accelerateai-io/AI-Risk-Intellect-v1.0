ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "finished_at" timestamp with time zone;

UPDATE "jobs"
SET "finished_at" = "updated_at"
WHERE "finished_at" IS NULL
  AND "status" IN ('done', 'completed', 'error', 'failed', 'skipped');
