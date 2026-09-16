function normalizeRole(role: string | null | undefined): string {
  return role?.trim().toLowerCase() ?? "";
}

export function isAdminUser(user: {
  role?: string | null;
  username?: string | null;
  email?: string | null;
}): boolean {
  const role = normalizeRole(user.role);
  if (role) return role === "admin";
  // Existing sessions before role was stored still treat the seeded Admin as admin.
  const username = user.username?.trim().toLowerCase() ?? "";
  const email = user.email?.trim().toLowerCase() ?? "";
  return username === "admin" || email === "admin@work.com";
}

/** Admin access for the signed-in session (`users.role` = admin). */
export function isCurrentUserAdmin(): boolean {
  return isAdminUser({
    role: sessionStorage.getItem("userRole"),
    username: sessionStorage.getItem("userName"),
    email: sessionStorage.getItem("userEmail"),
  });
}
