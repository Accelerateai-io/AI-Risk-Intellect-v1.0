import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  deleteReportUploadFile,
  persistReportUploadFile,
  readReportUploadFile,
  resolveReportUploadAbsolutePath,
} from "./etlReportFileStorage.js";

describe("etlReportFileStorage", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "etl-reports-test-"));
    process.env.ETL_REPORTS_STORAGE_DIR = tempDir;
  });

  afterEach(async () => {
    delete process.env.ETL_REPORTS_STORAGE_DIR;
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("persists and reads uploaded report files", async () => {
    const relativePath = await persistReportUploadFile(
      Buffer.from("ObjectId,title,url\n"),
      "reports.csv",
    );

    assert.match(relativePath, /\.csv$/);
    const absolutePath = resolveReportUploadAbsolutePath(relativePath);
    assert.equal(await fs.stat(absolutePath).then((s) => s.isFile()), true);

    const buffer = await readReportUploadFile(relativePath);
    assert.equal(buffer.toString("utf8"), "ObjectId,title,url\n");
  });

  it("deletes stored report files", async () => {
    const relativePath = await persistReportUploadFile(
      Buffer.from("data"),
      "sample.csv",
    );

    await deleteReportUploadFile(relativePath);

    await assert.rejects(() => readReportUploadFile(relativePath));
  });
});
