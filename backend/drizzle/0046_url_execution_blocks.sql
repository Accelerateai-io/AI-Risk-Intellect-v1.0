CREATE TABLE IF NOT EXISTS "url_execution_blocks" (
	"id" serial PRIMARY KEY NOT NULL,
	"url" varchar(2048) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "url_execution_blocks_url_unique" UNIQUE("url")
);
