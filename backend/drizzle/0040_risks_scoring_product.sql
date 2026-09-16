ALTER TABLE "risks" ADD COLUMN IF NOT EXISTS "likelihood" integer;
ALTER TABLE "risks" ADD COLUMN IF NOT EXISTS "impact" integer;
ALTER TABLE "risks" ADD COLUMN IF NOT EXISTS "severity_score" integer;
ALTER TABLE "risks" ADD COLUMN IF NOT EXISTS "severity_band" varchar(16);
ALTER TABLE "risks" ADD COLUMN IF NOT EXISTS "ai_product_name" varchar(256);
ALTER TABLE "risks" ADD COLUMN IF NOT EXISTS "ai_product_vendor" varchar(256);
CREATE INDEX IF NOT EXISTS "risks_severity_band_idx" ON "risks" ("severity_band");
CREATE INDEX IF NOT EXISTS "risks_severity_score_idx" ON "risks" ("severity_score");
