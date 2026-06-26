DROP INDEX "refresh_tokens_token_hash_idx";--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "access_token_hash" text;--> statement-breakpoint
CREATE INDEX "refresh_tokens_access_token_hash_idx" ON "refresh_tokens" USING btree ("access_token_hash");--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_access_token_hash_unique" UNIQUE("access_token_hash");