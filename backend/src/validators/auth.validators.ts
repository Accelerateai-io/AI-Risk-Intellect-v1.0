import { z } from "zod";

export const registerSchema = z.object({
  email: z.email("Invalid email address").max(255).toLowerCase().trim(),
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(64)
    .regex(
      /^[a-zA-Z0-9_.-]+$/,
      "Username may only contain letters, numbers, '.', '_' and '-'",
    )
    .trim(),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password is too long"),
  fullName: z.string().max(255).trim().optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const inviteSetPasswordSchema = z.object({
  token: z.string().min(20, "Invalid invite link"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password is too long"),
});
export type InviteSetPasswordInput = z.infer<typeof inviteSetPasswordSchema>;

export const forgotPasswordSchema = z.object({
  email: z.email("Invalid email address").max(255).toLowerCase().trim(),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(20, "Invalid reset link"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password is too long"),
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const loginSchema = z.object({
  emailOrUsername: z
    .string()
    .min(1, "Email or username is required")
    .max(255)
    .trim(),
  password: z.string().min(1, "Password is required").max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const updateMyProfileSchema = z.object({
  username: registerSchema.shape.username,
  fullName: z.string().max(255, "Full name must be at most 255 characters").trim().optional(),
  reason: z
    .string()
    .min(1, "Please enter a reason for this change")
    .max(2000, "Reason must be at most 2000 characters")
    .trim(),
});
export type UpdateMyProfileInput = z.infer<typeof updateMyProfileSchema>;

export const changeMyPasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required").max(128),
  newPassword: z
    .string()
    .min(8, "New password must be at least 8 characters")
    .max(128, "Password is too long"),
});
export type ChangeMyPasswordInput = z.infer<typeof changeMyPasswordSchema>;
