import assert from "node:assert/strict";
import { test } from "node:test";
import { jwtExpiresIn } from "./jwt.js";

test("a bare number is seconds, not milliseconds", () => {
  assert.equal(jwtExpiresIn("900"), 900);
  assert.equal(jwtExpiresIn("45m"), "45m");
  assert.equal(jwtExpiresIn("7d"), "7d");
});
