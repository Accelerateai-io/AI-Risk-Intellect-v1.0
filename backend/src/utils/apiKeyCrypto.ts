import { randomBytes, timingSafeEqual } from "node:crypto";
import { hashToken } from "./jwt.js";

export const API_KEY_PREFIX = "ari_";

export type GeneratedApiKey = {
  plaintext: string;
  keyHash: string;
  keyPrefix: string;
};

/** Cryptographically secure API key: `ari_` + 64 hex chars (32 bytes). */
export function generateApiKey(): GeneratedApiKey {
  const secret = randomBytes(32).toString("hex");
  const plaintext = `${API_KEY_PREFIX}${secret}`;
  return {
    plaintext,
    keyHash: hashToken(plaintext),
    keyPrefix: plaintext.slice(0, 12),
  };
}

export function hashApiKey(plaintext: string): string {
  return hashToken(normalizeApiKey(plaintext));
}

export function apiKeyPrefixFromPlaintext(plaintext: string): string {
  return normalizeApiKey(plaintext).slice(0, 12);
}

/**
 * Normalize pasted keys from Postman/clients:
 * trim whitespace, strip wrapping quotes, drop zero-width chars.
 */
export function normalizeApiKey(raw: string): string {
  let value = raw.trim().replace(/[\u200B-\u200D\uFEFF]/g, "");
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }
  return value;
}

/** Timing-safe hex string compare (equal length required). */
export function timingSafeEqualHex(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, "hex");
    const bufB = Buffer.from(b, "hex");
    if (bufA.length === 0 || bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

export function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function isPlausibleApiKeyFormat(plaintext: string): boolean {
  const value = normalizeApiKey(plaintext);
  // ari_ + 64 hex chars
  return /^ari_[0-9a-f]{64}$/i.test(value);
}
