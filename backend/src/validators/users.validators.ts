import { z } from "zod";
import { registerSchema } from "./auth.validators.js";

export const inviteUserSchema = z.object({
  email: z.email("Invalid email address").max(255).toLowerCase().trim(),
});

export type InviteUserInput = z.infer<typeof inviteUserSchema>;

export const userIdParamSchema = z.object({
  id: z.uuid("Invalid user id"),
});

export const updateUserSchema = z.object({
  username: registerSchema.shape.username,
  fullName: z
    .string()
    .max(255, "Full name must be at most 255 characters")
    .trim()
    .optional(),
  isActive: z.boolean().optional(),
  reason: z
    .string()
    .min(1, "Please enter a reason for this change")
    .max(2000, "Reason must be at most 2000 characters")
    .trim(),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>;
