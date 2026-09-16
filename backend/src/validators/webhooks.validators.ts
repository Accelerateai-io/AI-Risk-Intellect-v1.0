import { z } from "zod";

export const apiKeyWebhookBodySchema = z
  .object({
    event: z.string().min(1).max(128).trim(),
    userId: z.uuid("Invalid userId").optional(),
    email: z.email("Invalid email").max(255).toLowerCase().trim().optional(),
    name: z
      .string()
      .max(128, "Name must be at most 128 characters")
      .trim()
      .optional(),
  })
  .refine((data) => Boolean(data.userId || data.email), {
    message: "Either userId or email is required",
    path: ["userId"],
  });

export type ApiKeyWebhookBody = z.infer<typeof apiKeyWebhookBodySchema>;
