import type { Request, Response } from "express";
import {
  createApiKeyForUser,
  listApiKeysForUser,
  revokeApiKeyForUser,
} from "../../services/apiKeys/apiKeys.service.js";
import type { CreateApiKeyInput } from "../../validators/apiKeys.validators.js";
import { HttpError } from "../../utils/httpError.js";

export async function listApiKeysHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = req.user?.sub;
  if (!userId) throw HttpError.unauthorized();

  const keys = await listApiKeysForUser(userId);
  res.status(200).json({ keys });
}

export async function createApiKeyHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = req.user?.sub;
  if (!userId) throw HttpError.unauthorized();

  const body = req.body as CreateApiKeyInput;
  const key = await createApiKeyForUser({
    userId,
    name: body.name,
    actor: "user",
    auditAction: "created",
  });

  res.status(201).json({ key });
}

export async function revokeApiKeyHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = req.user?.sub;
  if (!userId) throw HttpError.unauthorized();

  const { id } = req.params as { id: string };
  const key = await revokeApiKeyForUser({ userId, apiKeyId: id });
  res.status(200).json({ key });
}

/** Validates an API key (`X-Api-Key` or `Authorization: Bearer ari_...`). */
export async function verifyApiKeyHandler(
  req: Request,
  res: Response,
): Promise<void> {
  if (!req.apiKey || !req.user) throw HttpError.unauthorized();

  res.status(200).json({
    ok: true,
    key: {
      id: req.apiKey.id,
      keyPrefix: req.apiKey.keyPrefix,
    },
    user: {
      id: req.user.sub,
      email: req.user.email,
      username: req.user.username,
    },
  });
}
