CREATE TYPE "user_account_status" AS ENUM('pending', 'completed', 'expired');
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "account_status" "user_account_status" DEFAULT 'pending' NOT NULL;
--> statement-breakpoint
UPDATE "users" SET "account_status" = 'completed' WHERE "password_hash" IS NOT NULL;
