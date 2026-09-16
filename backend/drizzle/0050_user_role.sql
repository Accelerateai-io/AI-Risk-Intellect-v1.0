-- Application role on users. Admin may edit reviewable risk fields.
DO $$ BEGIN
  CREATE TYPE "user_role" AS ENUM('admin', 'user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role" "user_role" DEFAULT 'user' NOT NULL;
--> statement-breakpoint
UPDATE "users"
SET "role" = 'admin'
WHERE lower("username") = 'admin' OR lower("email") = 'admin@work.com';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_role_idx" ON "users" USING btree ("role");
