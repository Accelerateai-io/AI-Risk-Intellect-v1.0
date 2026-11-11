import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Request, Response } from "express";
import { enqueueJobUrlSchema } from "../../validators/admin.validators.js";
import { enqueueJobUrlHandler } from "../../controllers/admin/manualJobEnqueue.controller.js";
import { HttpError } from "../../utils/httpError.js";

// B-3 review guards: strict boolean validation + admin-only force-reprocess.

describe("enqueueJobUrlSchema.forceReprocess (B-3)", () => {
  it("accepts a real JSON boolean", () => {
    assert.equal(
      enqueueJobUrlSchema.parse({ url: "https://example.com", forceReprocess: true })
        .forceReprocess,
      true,
    );
    assert.equal(
      enqueueJobUrlSchema.parse({ url: "https://example.com" }).forceReprocess,
      false,
    );
  });

  it("rejects the string 'false' instead of coercing it to true (z.boolean, not z.coerce)", () => {
    const result = enqueueJobUrlSchema.safeParse({
      url: "https://example.com",
      forceReprocess: "false",
    });
    assert.equal(result.success, false);
  });
});

describe("force-reprocess is admin-only (B-3)", () => {
  function fakeReq(role: string | undefined, forceReprocess: boolean): Request {
    return {
      body: { url: "https://example.com", forceReprocess },
      user: role ? { sub: "u1", role } : { sub: "u1" },
    } as unknown as Request;
  }
  const noopRes = {} as Response;

  it("a non-admin requesting force-reprocess is forbidden (403), before any enqueue", async () => {
    await assert.rejects(
      () => enqueueJobUrlHandler(fakeReq("user", true), noopRes),
      (err: unknown) =>
        err instanceof HttpError && err.status === 403,
    );
  });
});
