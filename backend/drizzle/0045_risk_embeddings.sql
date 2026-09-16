CREATE TABLE IF NOT EXISTS "risk_mapping_embeddings" (
	"id" serial PRIMARY KEY NOT NULL,
	"risk_mapping_id" integer NOT NULL,
	"model" varchar(128) NOT NULL,
	"dims" integer NOT NULL,
	"text_hash" varchar(64) NOT NULL,
	"embedding" real[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "risk_mapping_embeddings_risk_mapping_id_unique" UNIQUE("risk_mapping_id")
);--> statement-breakpoint
ALTER TABLE "risk_mapping_embeddings" ADD CONSTRAINT "risk_mapping_embeddings_risk_mapping_id_fk" FOREIGN KEY ("risk_mapping_id") REFERENCES "public"."risk_mappings"("risk_mapping_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "risk_embeddings" (
	"risk_id" uuid PRIMARY KEY NOT NULL,
	"model" varchar(128) NOT NULL,
	"dims" integer NOT NULL,
	"text_hash" varchar(64) NOT NULL,
	"embedding" real[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "risk_embeddings" ADD CONSTRAINT "risk_embeddings_risk_id_fk" FOREIGN KEY ("risk_id") REFERENCES "public"."risks"("id") ON DELETE cascade ON UPDATE no action;
