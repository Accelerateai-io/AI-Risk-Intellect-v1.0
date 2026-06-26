import { randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db } from "../../db/index.js";
import { users, type User } from "../../schema/users/users.js";
import { userProfileUpdateLogs } from "../../schema/userProfileUpdateLogs.js";
import {
  decodeInviteSetPasswordTokenUnsafe,
  verifyInviteSetPasswordToken,
} from "../../utils/jwt.js";
import { hashPassword, verifyPassword } from "../../utils/password.js";
import { HttpError } from "../../utils/httpError.js";
import type { LoginInput, RegisterInput } from "../../validators/auth.validators.js";

export type SafeUser = Omit<User, "passwordHash">;

function toSafeUser(user: User): SafeUser {
  const { passwordHash: _omit, ...rest } = user;
  void _omit;
  return rest;
}

export async function registerUser(input: RegisterInput): Promise<SafeUser> {
  const [existingEmail] = await db
    .select()
    .from(users)
    .where(eq(users.email, input.email))
    .limit(1);

  if (existingEmail?.passwordHash) {
    throw HttpError.conflict("A user with that email already exists");
  }

  if (existingEmail && !existingEmail.passwordHash) {
    const [usernameOwner] = await db
      .select()
      .from(users)
      .where(eq(users.username, input.username))
      .limit(1);
    if (usernameOwner && usernameOwner.id !== existingEmail.id) {
      throw HttpError.conflict("That username is already taken");
    }
    const passwordHash = await hashPassword(input.password);
    const [updated] = await db
      .update(users)
      .set({
        username: input.username,
        passwordHash,
        fullName: input.fullName?.trim() || null,
        isActive: true,
        accountStatus: "completed",
        updatedAt: new Date(),
      })
      .where(eq(users.id, existingEmail.id))
      .returning();
    if (!updated) {
      throw HttpError.internal("Could not complete registration");
    }
    return toSafeUser(updated);
  }

  const [usernameTaken] = await db
    .select()
    .from(users)
    .where(eq(users.username, input.username))
    .limit(1);
  if (usernameTaken) {
    throw HttpError.conflict("A user with that username already exists");
  }

  const passwordHash = await hashPassword(input.password);
  const [created] = await db
    .insert(users)
    .values({
      email: input.email,
      username: input.username,
      passwordHash,
      fullName: input.fullName ?? null,
      accountStatus: "completed",
    })
    .returning();

  if (!created) {
    throw HttpError.internal("Could not create user");
  }
  return toSafeUser(created);
}

export async function authenticateUser(input: LoginInput): Promise<SafeUser> {
  const lookup = input.emailOrUsername.toLowerCase();
  const [user] = await db
    .select()
    .from(users)
    .where(or(eq(users.email, lookup), eq(users.username, input.emailOrUsername)))
    .limit(1);

  if (!user) {
    throw HttpError.unauthorized("Invalid credentials");
  }

  if (!user.passwordHash) {
    throw HttpError.unauthorized(
      "Complete your registration using the link from your invitation email.",
    );
  }

  if (!user.isActive) {
    throw HttpError.unauthorized("Invalid credentials");
  }

  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) {
    throw HttpError.unauthorized("Invalid credentials");
  }

  return toSafeUser(user);
}

export async function getUserById(id: string): Promise<SafeUser | null> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return user ? toSafeUser(user) : null;
}

export async function updateMyProfile(
  userId: string,
  input: { username: string; fullName?: string; reason: string },
): Promise<SafeUser> {
  return updateUserProfileRecord({
    targetUserId: userId,
    updatedByUserId: userId,
    username: input.username,
    fullName: input.fullName,
    reason: input.reason,
  });
}

/** Updates profile fields on a user row and records reason + field diffs in `user_profile_update_logs`. */
export async function updateUserProfileRecord(input: {
  targetUserId: string;
  updatedByUserId: string;
  username: string;
  fullName?: string;
  reason: string;
  isActive?: boolean;
}): Promise<SafeUser> {
  const normalized = input.username.trim();
  const reason = input.reason.trim();

  return await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(users)
      .where(eq(users.id, input.targetUserId))
      .limit(1);

    if (!before) {
      throw HttpError.notFound("User not found");
    }

    const [other] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, normalized))
      .limit(1);
    if (other && other.id !== input.targetUserId) {
      throw HttpError.conflict("That username is already taken");
    }

    if (
      input.isActive === false &&
      input.targetUserId === input.updatedByUserId
    ) {
      throw HttpError.badRequest(
        "You cannot deactivate your own account here.",
      );
    }

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    if (before.username !== normalized) {
      changes.username = { from: before.username, to: normalized };
    }

    const patch: {
      username: string;
      updatedAt: Date;
      fullName?: string | null;
      isActive?: boolean;
    } = {
      username: normalized,
      updatedAt: new Date(),
    };

    if (input.fullName !== undefined) {
      const t = input.fullName.trim();
      const nextFullName = t.length === 0 ? null : t;
      patch.fullName = nextFullName;
      if (before.fullName !== nextFullName) {
        changes.fullName = { from: before.fullName, to: nextFullName };
      }
    }

    if (input.isActive !== undefined) {
      patch.isActive = input.isActive;
      if (before.isActive !== input.isActive) {
        changes.isActive = { from: before.isActive, to: input.isActive };
      }
    }

    const [updated] = await tx
      .update(users)
      .set(patch)
      .where(eq(users.id, input.targetUserId))
      .returning();

    if (!updated) {
      throw HttpError.notFound("User not found");
    }

    await tx.insert(userProfileUpdateLogs).values({
      targetUserId: input.targetUserId,
      updatedByUserId: input.updatedByUserId,
      reason,
      changes,
    });

    return toSafeUser(updated);
  });
}

export async function changeMyPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<SafeUser> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user?.passwordHash) {
    throw HttpError.badRequest("Password is not set for this account");
  }

  const ok = await verifyPassword(currentPassword, user.passwordHash);
  if (!ok) {
    throw HttpError.badRequest("Current password is incorrect");
  }

  const passwordHash = await hashPassword(newPassword);
  const [updated] = await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();

  if (!updated) {
    throw HttpError.internal("Could not update password");
  }
  return toSafeUser(updated);
}

export async function listUsers(): Promise<SafeUser[]> {
  const rows = await db
    .select()
    .from(users)
    .orderBy(desc(users.createdAt));
  return rows.map(toSafeUser);
}

/** Ensures a users row exists for this invite (pending until registration). */
export async function upsertInvitedUser(
  email: string,
): Promise<{ userId: string }> {
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing) {
    if (existing.passwordHash) {
      throw HttpError.conflict("A user with this email already has an account.");
    }
    await db
      .update(users)
      .set({
        updatedAt: new Date(),
        accountStatus: "pending",
      })
      .where(eq(users.id, existing.id));
    return { userId: existing.id };
  }

  const username = await allocateInviteUsername(email);
  const [inserted] = await db
    .insert(users)
    .values({
      email,
      username,
      passwordHash: null,
      fullName: null,
      isActive: false,
    })
    .returning({ id: users.id });

  if (!inserted) {
    throw HttpError.internal("Could not store invitation");
  }
  return { userId: inserted.id };
}

async function resolveInviteSetPasswordToken(
  token: string,
): Promise<{ userId: string; email: string }> {
  const trimmed = token.trim();
  if (!trimmed) {
    throw HttpError.badRequest("Missing invite token");
  }
  let payload: ReturnType<typeof verifyInviteSetPasswordToken>;
  try {
    payload = verifyInviteSetPasswordToken(trimmed);
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      const decoded = decodeInviteSetPasswordTokenUnsafe(trimmed);
      if (decoded) {
        await markInviteAccountExpiredIfStillPending(decoded.sub);
      }
    }
    throw HttpError.badRequest("Invalid or expired invite link");
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, payload.sub))
    .limit(1);

  if (!user || user.email !== payload.email) {
    throw HttpError.badRequest("Invalid or expired invite link");
  }

  if (user.passwordHash) {
    throw HttpError.conflict(
      "This invitation has already been used. Sign in instead.",
    );
  }

  return { userId: user.id, email: user.email };
}

export async function getInviteSetPasswordPreview(
  token: string,
): Promise<{ email: string }> {
  const { email } = await resolveInviteSetPasswordToken(token);
  return { email };
}

export async function completeInviteSetPassword(
  token: string,
  password: string,
): Promise<SafeUser> {
  const { userId } = await resolveInviteSetPasswordToken(token);
  const passwordHash = await hashPassword(password);
  const [updated] = await db
    .update(users)
    .set({
      passwordHash,
      isActive: true,
      accountStatus: "completed",
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
    .returning();

  if (!updated) {
    throw HttpError.internal("Could not set password");
  }
  return toSafeUser(updated);
}

async function markInviteAccountExpiredIfStillPending(
  userId: string,
): Promise<void> {
  await db
    .update(users)
    .set({
      accountStatus: "expired",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(users.id, userId),
        isNull(users.passwordHash),
        eq(users.accountStatus, "pending"),
      ),
    );
}

async function allocateInviteUsername(email: string): Promise<string> {
  const local = email.split("@")[0] ?? "user";
  let base = local
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^\.+|\.+$/g, "");
  if (base.length < 3) {
    base = `${base}_inv`.slice(0, 64);
  }
  if (base.length > 64) {
    base = base.slice(0, 64);
  }

  for (let n = 0; n < 100; n++) {
    const suffix = n === 0 ? "" : `_${n}`;
    const maxBase = 64 - suffix.length;
    const trimmed =
      maxBase >= 3 ? base.slice(0, maxBase) : base.slice(0, 3);
    const candidate = `${trimmed}${suffix}`;
    if (candidate.length > 64) continue;
    const [taken] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, candidate))
      .limit(1);
    if (!taken) return candidate;
  }

  return `u_${randomBytes(8).toString("hex")}`.slice(0, 64);
}
