import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveEtlExtractionStatus } from "./etlExtractionStatus.js";

describe("deriveEtlExtractionStatus", () => {
  it("returns pending and processing from upload status", () => {
    assert.equal(
      deriveEtlExtractionStatus({
        status: "pending",
        importedRows: 0,
        skippedRows: 0,
        failedRows: 0,
      }),
      "pending",
    );
    assert.equal(
      deriveEtlExtractionStatus({
        status: "processing",
        importedRows: 0,
        skippedRows: 0,
        failedRows: 0,
      }),
      "processing",
    );
  });

  it("returns completed when all unique urls import", () => {
    assert.equal(
      deriveEtlExtractionStatus({
        status: "completed",
        importedRows: 12,
        skippedRows: 0,
        failedRows: 0,
      }),
      "completed",
    );
  });

  it("returns partially completed when some rows import and some skip", () => {
    assert.equal(
      deriveEtlExtractionStatus({
        status: "completed",
        importedRows: 4,
        skippedRows: 2,
        failedRows: 0,
      }),
      "partially_completed",
    );
  });

  it("returns skipped when every url already exists", () => {
    assert.equal(
      deriveEtlExtractionStatus({
        status: "completed",
        importedRows: 0,
        skippedRows: 8,
        failedRows: 0,
      }),
      "skipped",
    );
  });
});
