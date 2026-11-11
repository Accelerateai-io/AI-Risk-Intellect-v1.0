ALTER TABLE "risks" ADD COLUMN "supersedes_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "force_reprocess" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "risks" ADD CONSTRAINT "risks_supersedes_id_risks_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."risks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "risks_supersedes_id_idx" ON "risks" USING btree ("supersedes_id");
