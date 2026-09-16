import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { NextFunction, Request, Response } from "express";
import { requireServiceKey } from "./requireServiceKey.middleware.js";

type Captured = { status: number | null; body: unknown; nextCalled: boolean };

function run(header: string | undefined): Captured {
  const captured: Captured = { status: null, body: null, nextCalled: false };
  const req = {
    header: (name: string) =>
      name.toLowerCase() === "x-api-key" ? header : undefined,
  } as unknown as Request;
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(payload: unknown) {
      captured.body = payload;
      return this;
    },
  } as unknown as Response;
  const next: NextFunction = () => {
    captured.nextCalled = true;
  };
  requireServiceKey(req, res, next);
  return captured;
}

const ORIGINAL = process.env.SERVICE_API_KEY;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.SERVICE_API_KEY;
  else process.env.SERVICE_API_KEY = ORIGINAL;
});

describe("requireServiceKey", () => {
  it("rejects a missing X-API-Key header with 401", () => {
    process.env.SERVICE_API_KEY = "secret-value";
    const out = run(undefined);
    assert.equal(out.status, 401);
    assert.equal(out.nextCalled, false);
  });

  it("rejects an invalid key with 401", () => {
    process.env.SERVICE_API_KEY = "secret-value";
    const out = run("wrong-key");
    assert.equal(out.status, 401);
    assert.equal(out.nextCalled, false);
  });

  it("accepts a valid key and calls next()", () => {
    process.env.SERVICE_API_KEY = "secret-value";
    const out = run("secret-value");
    assert.equal(out.nextCalled, true);
    assert.equal(out.status, null);
  });

  it("fails closed with 401 when SERVICE_API_KEY is unset", () => {
    delete process.env.SERVICE_API_KEY;
    const out = run("anything");
    assert.equal(out.status, 401);
    assert.equal(out.nextCalled, false);
  });

  it("rejects a valid-prefix key of different length (no timing-unsafe compare)", () => {
    process.env.SERVICE_API_KEY = "secret-value";
    const out = run("secret-value-extra");
    assert.equal(out.status, 401);
    assert.equal(out.nextCalled, false);
  });
});
