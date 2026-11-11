import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import {
  runListRisksHandler,
  type ListRisksDeps,
} from "./risks.controller.js";

/**
 * Request-level test through the controller (B-7). Exercises the AI-Q
 * compatibility routing decision without a database by injecting fake service
 * functions:
 *   - X-API-Key + `limit=50&sector=X` (no offset/page) -> FULL visible list
 *   - X-API-Key + no params                            -> FULL visible list
 * In both cases the legacy `{ risks, metrics }` shape is streamed and the
 * paginated `listRisks` path is never taken. The paginated path is also asserted
 * for an API-key caller that DOES page (offset present).
 */

type CapturedResponse = Response & {
  _status: number;
  _headers: Record<string, string>;
  _chunks: string[];
  _json: unknown;
  _ended: boolean;
  body(): string;
};

function makeRes(): CapturedResponse {
  // Typed loosely while wiring self-referential methods; cast once on return.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = {
    _status: 0,
    _headers: {},
    _chunks: [],
    _json: undefined,
    _ended: false,
  };
  res.status = (code: number) => {
    res._status = code;
    return res;
  };
  res.setHeader = (name: string, value: string) => {
    res._headers[name] = value;
    return res;
  };
  res.write = (chunk: string) => {
    res._chunks.push(String(chunk));
    return true;
  };
  res.end = () => {
    res._ended = true;
    return res;
  };
  res.json = (body: unknown) => {
    res._json = body;
    return res;
  };
  res.body = () => res._chunks.join("");
  return res as CapturedResponse;
}

function makeReq(
  query: Record<string, unknown>,
  opts: { apiKey?: boolean } = {},
): Request {
  return {
    query,
    ...(opts.apiKey ? { apiKey: { id: "k1" } } : {}),
  } as unknown as Request;
}

const FAKE_DTOS = [
  { id: "a", primaryKey: "technical" },
  { id: "b", primaryKey: "operational" },
  { id: "c", primaryKey: "business" },
] as unknown as Awaited<
  ReturnType<ListRisksDeps["listRisks"]>
>["risks"];

function fullListDeps(onListRisks?: () => never): ListRisksDeps {
  return {
    iterateVisibleRiskDtos: async function* () {
      for (const dto of FAKE_DTOS) yield dto as never;
    },
    listRisks: (async () => {
      if (onListRisks) onListRisks();
      throw new Error("listRisks must not be called on the full-list path");
    }) as ListRisksDeps["listRisks"],
  };
}

test("X-API-Key + limit=50&sector=X returns the FULL visible list (not paginated)", async () => {
  let listRisksCalls = 0;
  const deps = fullListDeps(() => {
    listRisksCalls += 1;
    throw new Error("unreachable");
  });
  const req = makeReq({ limit: "50", sector: "X" }, { apiKey: true });
  const res = makeRes();

  await runListRisksHandler(req, res, deps);

  assert.equal(listRisksCalls, 0, "paginated path must not run");
  assert.equal(res._status, 200);
  assert.equal(res._ended, true, "stream response is ended");
  const body = JSON.parse(res.body()) as {
    risks: { id: string }[];
    metrics: {
      total: number;
      technical: number;
      operational: number;
      business: number;
    };
  };
  assert.deepEqual(
    body.risks.map((r) => r.id),
    ["a", "b", "c"],
    "all visible risks are returned regardless of limit/sector",
  );
  assert.deepEqual(body.metrics, {
    total: 3,
    technical: 1,
    operational: 1,
    business: 1,
  });
});

test("X-API-Key + no params returns the FULL visible list", async () => {
  const deps = fullListDeps();
  const req = makeReq({}, { apiKey: true });
  const res = makeRes();

  await runListRisksHandler(req, res, deps);

  assert.equal(res._status, 200);
  assert.equal(res._ended, true);
  const body = JSON.parse(res.body()) as { risks: { id: string }[] };
  assert.deepEqual(
    body.risks.map((r) => r.id),
    ["a", "b", "c"],
  );
});

test("X-API-Key + offset DOES paginate (listRisks path)", async () => {
  let iterateCalled = false;
  const deps: ListRisksDeps = {
    iterateVisibleRiskDtos: async function* () {
      iterateCalled = true;
    },
    listRisks: (async () => ({
      risks: [{ id: "page1" }] as never,
      metrics: { total: 1, technical: 1, operational: 0, business: 0 },
      total: 1,
      hasMore: true,
      metricsIncluded: true,
    })) as ListRisksDeps["listRisks"],
  };
  const req = makeReq({ limit: "50", offset: "50" }, { apiKey: true });
  const res = makeRes();

  await runListRisksHandler(req, res, deps);

  assert.equal(iterateCalled, false, "full-list path must not run when paging");
  assert.equal(res._status, 200);
  const json = res._json as { total: number; hasMore: boolean };
  assert.equal(json.total, 1);
  assert.equal(json.hasMore, true);
});
