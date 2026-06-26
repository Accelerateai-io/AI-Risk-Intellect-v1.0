CREATE TABLE "ingest_link_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"ingest_link_id" integer NOT NULL,
	"url" varchar(2048) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ingest_link_items" ADD CONSTRAINT "ingest_link_items_ingest_link_id_ingest_links_id_fk" FOREIGN KEY ("ingest_link_id") REFERENCES "public"."ingest_links"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "ingest_link_items_feed_url_uidx" ON "ingest_link_items" USING btree ("ingest_link_id","url");
--> statement-breakpoint
CREATE INDEX "ingest_link_items_ingest_link_id_idx" ON "ingest_link_items" USING btree ("ingest_link_id");
