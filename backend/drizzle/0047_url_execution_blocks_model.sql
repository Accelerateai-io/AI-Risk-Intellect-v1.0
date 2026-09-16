ALTER TABLE "url_execution_blocks" ADD COLUMN IF NOT EXISTS "model_name" varchar(128);
ALTER TABLE "url_execution_blocks" ADD COLUMN IF NOT EXISTS "model_label" varchar(256);
