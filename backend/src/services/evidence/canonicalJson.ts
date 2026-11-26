/**
 * RFC 8785 (JSON Canonicalization Scheme) for the values Evidence Record v1 uses:
 * objects, arrays, strings, booleans, null and finite numbers. Keys are sorted by
 * UTF-16 code units; numbers use ECMAScript Number-to-String. Port of the
 * reference implementation shipped with the sample file (reference/canonical.mjs),
 * so AIRI and AI-Q agree byte for byte on how content_hash is made.
 */
import { createHash } from "node:crypto";

export function canonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Non-finite number cannot be canonicalized");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return (
      "{" +
      keys.map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k])).join(",") +
      "}"
    );
  }
  throw new Error(`Unsupported type: ${typeof value}`);
}

/** Fields that are NOT part of the content hash (spec section 3). */
export const HASH_EXCLUDED = ["content_hash", "checkpoint", "display_id"] as const;

export function contentHash(record: Record<string, unknown>): string {
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (!(HASH_EXCLUDED as readonly string[]).includes(k)) body[k] = v;
  }
  return (
    "sha256:" + createHash("sha256").update(canonicalize(body), "utf8").digest("hex")
  );
}
