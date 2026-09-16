ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "batch_run_id" integer;

DO $$ BEGIN
  ALTER TABLE "jobs"
    ADD CONSTRAINT "jobs_batch_run_id_batch_runs_id_fk"
    FOREIGN KEY ("batch_run_id")
    REFERENCES "public"."batch_runs"("id")
    ON DELETE set null
    ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "jobs_batch_run_id_idx" ON "jobs" USING btree ("batch_run_id");
