import { z } from "zod";

export const createApiKeySchema = z.object({
  name: z
    .string()
    .max(128, "Name must be at most 128 characters")
    .trim()
    .optional(),
});

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;

export const apiKeyIdParamSchema = z.object({
  id: z.uuid("Invalid API key id"),
});

export type ApiKeyIdParam = z.infer<typeof apiKeyIdParamSchema>;
