CREATE TABLE "ingest_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"url" varchar(2048) NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ingest_links_url_active_uidx" ON "ingest_links" USING btree ("url") WHERE "archived" = false;
--> statement-breakpoint
CREATE INDEX "ingest_links_archived_idx" ON "ingest_links" USING btree ("archived");
--> statement-breakpoint
CREATE INDEX "ingest_links_created_at_idx" ON "ingest_links" USING btree ("created_at");
