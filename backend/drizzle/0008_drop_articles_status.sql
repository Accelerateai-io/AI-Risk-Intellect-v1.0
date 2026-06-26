DROP INDEX IF EXISTS "articles_status_idx";--> statement-breakpoint
ALTER TABLE "articles" DROP COLUMN IF EXISTS "status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."article_status";
