import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dedupeRecordsByUrlInFile,
  findDuplicateUrlsInFile,
  validateEtlUploadFile,
} from "./etlImport.service.js";
import { mapRecordToRow } from "./etlRowSanitize.js";
import { HttpError } from "../../utils/httpError.js";
import type { ParsedEtlRecord } from "../../etl/etlImport.types.js";

describe("validateEtlUploadFile", () => {
  it("rejects missing file", () => {
    assert.throws(
      () => validateEtlUploadFile(undefined),
      (err: unknown) => err instanceof HttpError && err.status === 400,
    );
  });

  it("rejects unsupported extensions", () => {
    assert.throws(
      () =>
        validateEtlUploadFile({
          originalname: "data.txt",
          buffer: Buffer.from("a"),
          size: 1,
        } as Express.Multer.File),
      (err: unknown) => err instanceof HttpError && err.status === 400,
    );
  });

  it("accepts csv uploads", () => {
    const file = validateEtlUploadFile({
      originalname: "reports.csv",
      buffer: Buffer.from("ObjectId,title,url\n"),
      size: 20,
    } as Express.Multer.File);

    assert.equal(file.originalname, "reports.csv");
  });
});

describe("findDuplicateUrlsInFile", () => {
  it("returns urls that appear more than once", () => {
    const duplicates = findDuplicateUrlsInFile([
      "https://example.com/a",
      "https://example.com/b",
      "https://example.com/a",
      "https://example.com/c",
      "https://example.com/b",
    ]);

    assert.deepEqual(duplicates, [
      "https://example.com/a",
      "https://example.com/b",
    ]);
  });

  it("returns an empty list when all urls are unique", () => {
    assert.deepEqual(
      findDuplicateUrlsInFile([
        "https://example.com/a",
        "https://example.com/b",
      ]),
      [],
    );
  });
});

describe("dedupeRecordsByUrlInFile", () => {
  it("keeps the first row for each url and skips later duplicates", () => {
    const records = [
      { id: "1", title: "First A", url: "https://example.com/a" },
      { id: "2", title: "B", url: "https://example.com/b" },
      { id: "3", title: "Second A", url: "https://example.com/a" },
    ];

    const result = dedupeRecordsByUrlInFile(records);

    assert.equal(result.skippedRows, 1);
    assert.equal(result.records.length, 2);
    assert.equal(result.records[0]?.id, "1");
    assert.equal(result.records[1]?.id, "2");
  });
});

describe("mapRecordToRow", () => {
  it("maps parsed python records into drizzle rows", () => {
    const record: ParsedEtlRecord = {
      id: "507f1f77bcf86cd799439011",
      title: "Sample",
      url: "https://example.com/sample",
      date_published: "2024-01-15T00:00:00+00:00",
      tags: ["ai", "risk"],
    };

    const row = mapRecordToRow(record);

    assert.equal(row.objectId, record.id);
    assert.equal(row.title, record.title);
    assert.equal(row.url, record.url);
    assert.deepEqual(row.tags, ["ai", "risk"]);
    assert.ok(row.datePublished instanceof Date);
  });

  it("strips null bytes from description fields", () => {
    const row = mapRecordToRow({
      id: "507f1f77bcf86cd799439011",
      title: "Hello\u0000World",
      url: "https://example.com/a",
      description: "Body\u0000text",
    });

    assert.equal(row.title, "HelloWorld");
    assert.equal(row.description, "Bodytext");
  });

  it("normalizes empty string tags to null", () => {
    const row = mapRecordToRow({
      id: "507f1f77bcf86cd799439011",
      title: "Sample",
      url: "https://example.com/sample",
      tags: "" as unknown as string[],
    });

    assert.equal(row.tags, null);
  });

  it("truncates url to 2048 characters", () => {
    const longPath = "a".repeat(2100);
    const row = mapRecordToRow({
      id: "507f1f77bcf86cd799439011",
      title: "Sample",
      url: `https://example.com/${longPath}`,
    });

    assert.equal(row.url.length, 2048);
  });
});
