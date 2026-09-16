export type SessionAuthUser = {
  username: string;
  email: string;
  role?: string | null;
};

export function persistSessionUser(
  user: SessionAuthUser,
  accessToken?: string,
): void {
  if (accessToken) sessionStorage.setItem("accessToken", accessToken);
  sessionStorage.setItem("userName", user.username);
  sessionStorage.setItem("userEmail", user.email);
  const role = user.role?.trim().toLowerCase() ?? "";
  if (role) sessionStorage.setItem("userRole", role);
  else sessionStorage.removeItem("userRole");
}
