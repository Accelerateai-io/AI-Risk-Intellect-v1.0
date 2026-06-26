ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_last_profile_updated_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "last_profile_update_reason";
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "last_profile_updated_by_user_id";
--> statement-breakpoint
CREATE TABLE "user_profile_update_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_user_id" uuid NOT NULL,
	"updated_by_user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"changes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_profile_update_logs" ADD CONSTRAINT "user_profile_update_logs_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "user_profile_update_logs" ADD CONSTRAINT "user_profile_update_logs_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "user_profile_update_logs_target_user_id_idx" ON "user_profile_update_logs" USING btree ("target_user_id");
--> statement-breakpoint
CREATE INDEX "user_profile_update_logs_created_at_idx" ON "user_profile_update_logs" USING btree ("created_at");
