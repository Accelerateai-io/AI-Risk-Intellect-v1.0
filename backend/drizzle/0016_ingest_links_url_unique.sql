DROP INDEX IF EXISTS "ingest_links_url_active_uidx";
--> statement-breakpoint
CREATE UNIQUE INDEX "ingest_links_url_unique" ON "ingest_links" USING btree ("url");
