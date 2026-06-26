import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../../db/index.js";
import { passwordResetTokens } from "../../schema/passwordResetTokens.js";
import { users, type User } from "../../schema/users/users.js";
import { hashToken } from "../../utils/jwt.js";
import { hashPassword } from "../../utils/password.js";
import { HttpError } from "../../utils/httpError.js";
import type { SafeUser } from "../auth/auth.service.js";
import { revokeAllForUser } from "../refreshToken/token.service.js";
import { sendPasswordResetEmail } from "./passwordResetEmail.service.js";

function toSafeUser(user: User): SafeUser {
  const { passwordHash: _omit, ...rest } = user;
  void _omit;
  return rest;
}

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

/**
 * Creates a one-time reset token and sends email when a user with that email
 * exists and has a password set. Otherwise throws NOT_FOUND.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    throw HttpError.badRequest("Email is required");
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, normalized))
    .limit(1);

  if (!user || !user.passwordHash) {
    throw HttpError.notFound("Email is not found");
  }

  await db
    .delete(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.userId, user.id),
        isNull(passwordResetTokens.usedAt),
      ),
    );

  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

  await db.insert(passwordResetTokens).values({
    userId: user.id,
    tokenHash,
    expiresAt,
  });

  await sendPasswordResetEmail({ to: user.email, resetToken: rawToken });
}

/** Validates token, sets new password, revokes refresh sessions. */
export async function completePasswordReset(
  rawToken: string,
  newPassword: string,
): Promise<SafeUser> {
  const trimmed = rawToken.trim();
  if (!trimmed) {
    throw HttpError.badRequest("Missing reset token");
  }

  const tokenHash = hashToken(trimmed);
  const now = new Date();

  const [row] = await db
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, now),
      ),
    )
    .limit(1);

  if (!row) {
    throw HttpError.badRequest("Invalid or expired password reset link");
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, row.userId))
    .limit(1);

  if (!user) {
    throw HttpError.badRequest("Invalid or expired password reset link");
  }

  const passwordHash = await hashPassword(newPassword);

  const [updatedUser] = await db
    .update(users)
    .set({
      passwordHash,
      accountStatus: "completed",
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id))
    .returning();

  if (!updatedUser) {
    throw HttpError.internal("Could not update password");
  }

  const [marked] = await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(passwordResetTokens.id, row.id),
        isNull(passwordResetTokens.usedAt),
      ),
    )
    .returning({ id: passwordResetTokens.id });

  if (!marked) {
    throw HttpError.conflict(
      "This reset link has already been used. Request a new reset if you still need access.",
    );
  }

  await revokeAllForUser(user.id);

  return toSafeUser(updatedUser);
}
