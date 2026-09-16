import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listReportUploadItemsQuerySchema } from "../../validators/admin.validators.js";

describe("listReportUploadItemsQuerySchema", () => {
  it("defaults to a 50-row first page", () => {
    const parsed = listReportUploadItemsQuerySchema.parse({});
    assert.equal(parsed.limit, 50);
    assert.equal(parsed.offset, 0);
    assert.equal(parsed.afterId, undefined);
  });

  it("rejects a request that would load thousands of URLs at once", () => {
    const parsed = listReportUploadItemsQuerySchema.safeParse({
      limit: 6000,
      offset: 0,
    });
    assert.equal(parsed.success, false);
  });

  it("rejects oversized limits", () => {
    const parsed = listReportUploadItemsQuerySchema.safeParse({ limit: 201 });
    assert.equal(parsed.success, false);
  });

  it("accepts keyset pagination after the first batch", () => {
    const parsed = listReportUploadItemsQuerySchema.parse({
      limit: "40",
      offset: "40",
      afterId: "1200",
    });
    assert.equal(parsed.limit, 40);
    assert.equal(parsed.offset, 40);
    assert.equal(parsed.afterId, 1200);
  });
});
