import type { AiriUser } from "./reviewOpsApi";

/** Match the signed-in session to a user by email or username. */
export function findSessionUser(users: readonly AiriUser[]): AiriUser | undefined {
  const email = sessionStorage.getItem("userEmail")?.trim().toLowerCase() ?? "";
  const username = sessionStorage.getItem("userName")?.trim().toLowerCase() ?? "";
  if (!email && !username) return undefined;
  return users.find((u) => {
    const userEmail = u.email.trim().toLowerCase();
    const userName = u.username.trim().toLowerCase();
    return (email && userEmail === email) || (username && userName === username);
  });
}
