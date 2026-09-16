import { z } from "zod";

export const listJobsQuerySchema = z.object({
  page: z.coerce.number().int().min(0).optional().default(0),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(100),
  search: z.string().trim().max(200).optional().default(""),
  status: z
    .enum(["all", "pending", "running", "done", "error", "skipped"])
    .optional()
    .default("all"),
  type: z
    .enum(["all", "crawler", "indexer", "ingest"])
    .optional()
    .default("all"),
  source: z
    .enum(["all", "rss", "etl_reports", "manual"])
    .optional()
    .default("all"),
  execution: z
    .enum(["all", "do_not_execute"])
    .optional()
    .default("all"),
});

export type ListJobsQuery = z.infer<typeof listJobsQuerySchema>;

export const executeJobUrlSchema = z.object({
  modelName: z.string().trim().min(1).max(256).optional(),
  modelLabel: z.string().trim().max(2000).optional(),
});

export type ExecuteJobUrlInput = z.infer<typeof executeJobUrlSchema>;
