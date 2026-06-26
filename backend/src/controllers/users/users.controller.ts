import type { Request, Response } from "express";
import {
  listUsers,
  upsertInvitedUser,
  updateUserProfileRecord,
} from "../../services/auth/auth.service.js";
import { sendUserInviteEmail } from "../../services/auth/inviteEmail.service.js";
import { signInviteSetPasswordToken } from "../../utils/jwt.js";
import type { InviteUserInput, UpdateUserInput } from "../../validators/users.validators.js";

export async function listUsersHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  const users = await listUsers();
  res.status(200).json({ users });
}

export async function inviteUserHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const { email } = req.body as InviteUserInput;
  const inviter = req.user!;
  const { userId } = await upsertInvitedUser(email);
  const inviteToken = signInviteSetPasswordToken({ sub: userId, email });
  await sendUserInviteEmail({
    to: email,
    invitedByEmail: inviter.email,
    invitedByUsername: inviter.username,
    inviteToken,
  });

  res.status(200).json({ ok: true, message: "Invitation email sent." });
}

export async function patchUserHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const actor = req.user!;
  const { id: targetUserId } = req.params as { id: string };
  const { username, fullName, isActive, reason } = req.body as UpdateUserInput;

  const user = await updateUserProfileRecord({
    targetUserId,
    updatedByUserId: actor.sub,
    username,
    fullName,
    isActive,
    reason,
  });

  res.status(200).json({ user });
}
