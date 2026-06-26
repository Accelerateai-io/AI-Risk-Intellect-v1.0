ALTER TABLE "users" ADD COLUMN "last_profile_update_reason" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_profile_updated_by_user_id" uuid;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_last_profile_updated_by_user_id_users_id_fk" FOREIGN KEY ("last_profile_updated_by_user_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
