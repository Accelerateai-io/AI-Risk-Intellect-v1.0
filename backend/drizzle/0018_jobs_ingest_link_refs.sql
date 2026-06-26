ALTER TABLE "jobs" ADD COLUMN "ingest_link_id" integer;
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "ingest_link_item_id" integer;
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_ingest_link_id_ingest_links_id_fk" FOREIGN KEY ("ingest_link_id") REFERENCES "public"."ingest_links"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_ingest_link_item_id_ingest_link_items_id_fk" FOREIGN KEY ("ingest_link_item_id") REFERENCES "public"."ingest_link_items"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "jobs_ingest_link_id_idx" ON "jobs" USING btree ("ingest_link_id");
--> statement-breakpoint
CREATE INDEX "jobs_ingest_link_item_id_idx" ON "jobs" USING btree ("ingest_link_item_id");
