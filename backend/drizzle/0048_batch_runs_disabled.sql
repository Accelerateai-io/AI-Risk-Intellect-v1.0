ALTER TABLE "batch_runs" ADD COLUMN IF NOT EXISTS "disabled" boolean DEFAULT false NOT NULL;
