import { z } from "zod";

export const listArticlesQuerySchema = z.object({
  page: z.coerce.number().int().min(0).optional().default(0),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(10),
  search: z.string().trim().max(200).optional().default(""),
  risks: z.enum(["all", "with", "none"]).optional().default("all"),
  order: z.enum(["newest", "oldest"]).optional().default("newest"),
});

export type ListArticlesQuery = z.infer<typeof listArticlesQuerySchema>;
