import { createHash } from "node:crypto";

/** SHA-256 hex digest of UTF-8 text (port of Python `sha256(text.encode("utf-8")).hexdigest()`). */
export function contentSha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
