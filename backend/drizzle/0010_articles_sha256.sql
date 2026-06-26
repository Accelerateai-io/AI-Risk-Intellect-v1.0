ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "sha256" varchar(64);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "articles_sha256_unique" ON "articles" ("sha256") WHERE "sha256" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "articles_sha256_idx" ON "articles" USING btree ("sha256");
