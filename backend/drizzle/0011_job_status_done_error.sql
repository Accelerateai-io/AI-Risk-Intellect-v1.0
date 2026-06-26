ALTER TYPE "public"."job_status" ADD VALUE IF NOT EXISTS 'done';--> statement-breakpoint
ALTER TYPE "public"."job_status" ADD VALUE IF NOT EXISTS 'error';
