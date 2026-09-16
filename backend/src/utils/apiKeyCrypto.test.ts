import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import {
  apiKeyPrefixFromPlaintext,
  generateApiKey,
  hashApiKey,
  isPlausibleApiKeyFormat,
  normalizeApiKey,
  timingSafeEqualHex,
} from "./apiKeyCrypto.js";

describe("apiKeyCrypto", () => {
  it("generates ari_ prefixed keys with matching hash and prefix", () => {
    const key = generateApiKey();
    assert.ok(key.plaintext.startsWith("ari_"));
    assert.equal(key.plaintext.length, 4 + 64);
    assert.equal(key.keyHash, hashApiKey(key.plaintext));
    assert.equal(key.keyPrefix, apiKeyPrefixFromPlaintext(key.plaintext));
    assert.equal(key.keyPrefix.length, 12);
  });

  it("compares hex digests in constant time", () => {
    const a = createHmac("sha256", "secret").update("body").digest("hex");
    const b = createHmac("sha256", "secret").update("body").digest("hex");
    const c = createHmac("sha256", "secret").update("other").digest("hex");
    assert.equal(timingSafeEqualHex(a, b), true);
    assert.equal(timingSafeEqualHex(a, c), false);
    assert.equal(timingSafeEqualHex(a, "zz"), false);
  });

  it("normalizes quoted and spaced keys", () => {
    const key = generateApiKey();
    assert.equal(normalizeApiKey(`  "${key.plaintext}"  `), key.plaintext);
    assert.equal(isPlausibleApiKeyFormat(key.plaintext), true);
    assert.equal(isPlausibleApiKeyFormat(key.keyPrefix), false);
  });
});
