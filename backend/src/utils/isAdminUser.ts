import { HttpError } from "./httpError.js";

export function normalizeUserRole(role: unknown): "admin" | "user" {
  return typeof role === "string" && role.trim().toLowerCase() === "admin"
    ? "admin"
    : "user";
}

export function isAdminRole(role: string | null | undefined): boolean {
  return normalizeUserRole(role) === "admin";
}

/** True when the user's `users.role` is admin. */
export function isAdminUser(
  user: { role?: string | null } | undefined,
): boolean {
  return isAdminRole(user?.role);
}

export function assertAdminUser(
  user: { role?: string | null } | undefined,
  message = "Only Admin users can edit risks.",
): void {
  if (!isAdminUser(user)) {
    throw HttpError.forbidden(message);
  }
}
