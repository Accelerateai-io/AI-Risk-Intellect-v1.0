import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HttpError } from "./httpError.js";
import { assertAdminUser, isAdminUser } from "./isAdminUser.js";

describe("isAdminUser", () => {
  it("recognizes role=admin", () => {
    assert.equal(isAdminUser({ role: "admin" }), true);
    assert.equal(isAdminUser({ role: "Admin" }), true);
  });

  it("rejects missing or non-admin roles", () => {
    assert.equal(isAdminUser(undefined), false);
    assert.equal(isAdminUser({}), false);
    assert.equal(isAdminUser({ role: "user" }), false);
    assert.equal(isAdminUser({ role: null }), false);
  });

  it("assertAdminUser throws forbidden for non-admins", () => {
    assert.throws(
      () => assertAdminUser({ role: "user" }),
      (e: unknown) => e instanceof HttpError && e.status === 403,
    );
    assert.doesNotThrow(() => assertAdminUser({ role: "admin" }));
  });
});
