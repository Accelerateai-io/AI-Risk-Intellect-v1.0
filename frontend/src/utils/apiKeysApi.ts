import { authFetch } from "./authFetch";

export type ApiKeyRow = {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreatedApiKey = ApiKeyRow & {
  plaintext: string;
};

type ApiErrorBody = {
  error?: { message?: string };
  message?: string;
};

function errorMessage(data: ApiErrorBody, fallback: string): string {
  return data.error?.message ?? data.message ?? fallback;
}

export async function listApiKeys(): Promise<
  { ok: true; keys: ApiKeyRow[] } | { ok: false; message: string }
> {
  try {
    const res = await authFetch("/keys");
    const data = (await res.json().catch(() => ({}))) as ApiErrorBody & {
      keys?: ApiKeyRow[];
    };
    if (!res.ok)
      return { ok: false, message: errorMessage(data, "Could not load API keys") };
    return { ok: true, keys: data.keys ?? [] };
  } catch {
    return { ok: false, message: "Could not load API keys" };
  }
}

export async function createApiKey(name?: string): Promise<
  { ok: true; key: CreatedApiKey } | { ok: false; message: string }
> {
  try {
    const res = await authFetch("/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(name?.trim() ? { name: name.trim() } : {}),
    });
    const data = (await res.json().catch(() => ({}))) as ApiErrorBody & {
      key?: CreatedApiKey;
    };
    if (!res.ok)
      return {
        ok: false,
        message: errorMessage(data, "Could not generate API key"),
      };
    if (!data.key?.plaintext)
      return { ok: false, message: "API key was created but plaintext was missing" };
    return { ok: true, key: data.key };
  } catch {
    return { ok: false, message: "Could not generate API key" };
  }
}

export async function revokeApiKey(
  id: string,
): Promise<{ ok: true; key: ApiKeyRow } | { ok: false; message: string }> {
  try {
    const res = await authFetch(`/keys/${encodeURIComponent(id)}/revoke`, {
      method: "POST",
    });
    const data = (await res.json().catch(() => ({}))) as ApiErrorBody & {
      key?: ApiKeyRow;
    };
    if (!res.ok)
      return { ok: false, message: errorMessage(data, "Could not revoke API key") };
    if (!data.key)
      return { ok: false, message: "Revoke succeeded but key was missing" };
    return { ok: true, key: data.key };
  } catch {
    return { ok: false, message: "Could not revoke API key" };
  }
}
