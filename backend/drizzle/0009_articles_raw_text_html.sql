ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "raw_text" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "html" text;
