import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import ExcelJS from "exceljs";
import { iterateInBatches } from "./risksExport.service.js";

test("iterateInBatches yields every row across multiple batches", async () => {
  const all = Array.from({ length: 1250 }, (_, i) => ({ id: i }));
  let calls = 0;
  const fetchPage = async (limit: number, offset: number) => {
    calls += 1;
    return all.slice(offset, offset + limit);
  };

  const seen: number[] = [];
  for await (const row of iterateInBatches(fetchPage, 500)) {
    seen.push(row.id);
  }

  assert.equal(seen.length, 1250);
  // Preserves order and covers the whole set with no gaps/dupes.
  assert.deepEqual(
    seen,
    all.map((r) => r.id),
  );
  // 500 + 500 + 250 => 3 pages; a trailing short page ends the scan (no 4th call).
  assert.equal(calls, 3);
});

test("iterateInBatches makes one final call when the last batch is exactly full", async () => {
  const all = Array.from({ length: 1000 }, (_, i) => ({ id: i }));
  let calls = 0;
  const fetchPage = async (limit: number, offset: number) => {
    calls += 1;
    return all.slice(offset, offset + limit);
  };
  const seen: number[] = [];
  for await (const row of iterateInBatches(fetchPage, 500)) seen.push(row.id);
  assert.equal(seen.length, 1000);
  // 500 + 500 (full) + 0 (empty) => 3 calls, then stop.
  assert.equal(calls, 3);
});

test("ExcelJS streaming writer emits every row into a readable workbook", async () => {
  // Validates the streaming API usage the export relies on: rows are committed
  // to the output stream and the resulting workbook contains them all.
  const chunks: Buffer[] = [];
  const out = new PassThrough();
  out.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
  const finished = new Promise<void>((resolve) => out.on("finish", resolve));

  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: out,
    useStyles: false,
    useSharedStrings: false,
  });
  const ws = wb.addWorksheet("Risks");
  ws.addRow(["Display ID", "Title"]).commit();
  const ROW_COUNT = 1200;
  for (let i = 0; i < ROW_COUNT; i += 1) {
    ws.addRow([`R-${i}`, `Risk ${i}`]).commit();
  }
  ws.commit();
  await wb.commit();
  await finished;

  const buffer = Buffer.concat(chunks);
  const read = new ExcelJS.Workbook();
  await read.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = read.getWorksheet("Risks");
  assert.ok(sheet, "Risks sheet exists");
  // Header + all data rows round-trip.
  assert.equal(sheet!.rowCount, ROW_COUNT + 1);
  assert.equal(String(sheet!.getRow(2).getCell(1).value), "R-0");
  assert.equal(
    String(sheet!.getRow(ROW_COUNT + 1).getCell(1).value),
    `R-${ROW_COUNT - 1}`,
  );
});
