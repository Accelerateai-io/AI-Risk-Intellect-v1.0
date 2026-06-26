ALTER TABLE "etl_report_uploads" RENAME COLUMN "file_name" TO "report_file_path";
--> statement-breakpoint
ALTER TABLE "etl_report_uploads" ALTER COLUMN "report_file_path" TYPE varchar(1024);
