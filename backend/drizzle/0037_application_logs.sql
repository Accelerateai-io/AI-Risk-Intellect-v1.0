CREATE TABLE "application_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"level" varchar(16) NOT NULL,
	"label" varchar(64),
	"message" text NOT NULL,
	"ip_address" varchar(64),
	"user_agent" text,
	"browser" varchar(64),
	"browser_version" varchar(32),
	"os" varchar(64),
	"os_version" varchar(32),
	"device" varchar(128),
	"device_type" varchar(16),
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "application_logs_created_at_idx" ON "application_logs" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX "application_logs_level_idx" ON "application_logs" USING btree ("level");
--> statement-breakpoint
CREATE INDEX "application_logs_label_idx" ON "application_logs" USING btree ("label");
--> statement-breakpoint
CREATE INDEX "application_logs_ip_address_idx" ON "application_logs" USING btree ("ip_address");
