/**
 * Reprocess every URL on the golden-set sheet and write the outcome back.
 *
 *   npm run golden:run
 *
 * Python must already be listening on PYTHON_INGEST_URL (default port 5006).
 * The script enqueues each unique URL with force reprocess, runs those jobs,
 * then fills "Pipeline outcome" and "Mismatch" on the sheet.
 */
import "../bootstrap.js";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx") as typeof import("xlsx");
import { pool } from "../database/db.js";
import { enqueueManualJobUrl } from "../services/admin/manualJobEnqueue.service.js";
import { assertPythonServiceReady } from "../services/worker/pythonHealth.js";
import { runOneJob } from "../services/worker/jobWorker.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

const SHEET_NAME = "Golden set (30 dev records)";
const OUTCOME_HEADER = "Pipeline outcome";
const MISMATCH_HEADER = "Mismatch";

const REASON_CODES = [
  "PUBLISHED_LABELLED",
  "CATALOG_SUGGESTED",
  "CLAIM_UNSUPPORTED",
  "SAFETY_HOLD",
  "RATIONALE_UNSUPPORTED",
  "SEVERITY_UNSUPPORTED",
  "REPAIR_FAILED",
  "FETCH_FAIL",
  "NOT_AI",
  "RESEARCH",
  "PUBLISHED_WITH_NOTES",
  "VERIFIED",
  "REPAIRED",
  "MERGED",
] as const;

type SheetRow = {
  rowNumber: number;
  record: string;
  url: string;
  expectedReason: string;
};

type JobResult = {
  status: string;
  skipReason: string | null;
  errorMessage: string | null;
  reason: string | null;
  publication: string | null;
  catalogPercent: number | null;
  catalogVerdict: string | null;
};

function expectedCode(raw: string): string | null {
  const text = raw.trim();
  for (const code of REASON_CODES) {
    if (text === code || text.startsWith(`${code} `) || text.startsWith(`${code}(`)) {
      return code;
    }
  }
  return null;
}

function publicationWord(result: JobResult, reason: string): string {
  if (
    reason === "FETCH_FAIL" ||
    reason === "NOT_AI" ||
    reason === "MERGED" ||
    reason === "RESEARCH"
  ) {
    return "No record";
  }
  if (result.publication === "held") return "Held";
  if (result.publication === "published") return "Published";
  if (result.status === "skipped") return "No record";
  if (result.status === "error") return "Error";
  return result.publication ?? result.status;
}

function mismatchNote(expected: string | null, actual: string, result: JobResult): string {
  if (!expected) return "No v2 expected code";
  if (expected === actual) return "Matches";
  if (
    actual === "CATALOG_SUGGESTED" &&
    (expected === "VERIFIED" || expected === "PUBLISHED_LABELLED")
  ) {
    if (result.catalogPercent == null) return "Catalog match has no score";
    return `Catalog score ${result.catalogPercent}, under 60`;
  }
  if (actual === "CLAIM_UNSUPPORTED") return "Claim check failed";
  if (actual === "SAFETY_HOLD") return "Safety hold";
  if (actual === "RATIONALE_UNSUPPORTED") return "Rationale check failed";
  if (actual === "SEVERITY_UNSUPPORTED") return "Severity check failed";
  if (expected === "CLAIM_UNSUPPORTED") return "Claim check passed";
  if (expected === "CATALOG_SUGGESTED" && result.catalogPercent != null) {
    return `Catalog score ${result.catalogPercent}, at or above 60`;
  }
  if (expected === "SAFETY_HOLD") return "Safety hold did not trigger";
  if (expected === "REPAIRED") return "Repair did not run";
  if (expected === "FETCH_FAIL" || expected === "NOT_AI") return `Ended as ${actual}`;
  return `Got ${actual}`;
}

function sheetRows(filePath: string): { sheet: XLSX.WorkSheet; matrix: string[][] } {
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[SHEET_NAME];
  if (!sheet) throw new Error(`Sheet not found: ${SHEET_NAME}`);
  const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" });
  return { sheet, matrix };
}

function columnIndex(header: string[], name: string): number {
  const index = header.findIndex((cell) => cell.trim() === name);
  if (index < 0) throw new Error(`Golden set is missing ${name}`);
  return index;
}

function readRows(filePath: string): SheetRow[] {
  const { matrix } = sheetRows(filePath);
  const header = matrix[0] ?? [];
  const urlCol = columnIndex(header, "Article URL");
  const recordCol = columnIndex(header, "Record");
  const reasonCol = columnIndex(header, "Expected reason code");
  const rows: SheetRow[] = [];
  matrix.forEach((line, index) => {
    if (index === 0) return;
    const url = (line[urlCol] ?? "").trim();
    if (!url) return;
    rows.push({
      rowNumber: index + 1,
      record: (line[recordCol] ?? "").trim(),
      url,
      expectedReason: (line[reasonCol] ?? "").trim(),
    });
  });
  return rows;
}

function putCell(sheet: XLSX.WorkSheet, rowIndex: number, colIndex: number, value: string): void {
  const address = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
  sheet[address] = { t: "s", v: value };
}

function writeResults(
  filePath: string,
  rows: SheetRow[],
  byUrl: Map<string, JobResult>,
): void {
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[SHEET_NAME];
  if (!sheet) throw new Error(`Sheet not found: ${SHEET_NAME}`);
  const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" });
  const header = matrix[0] ?? [];
  let outcomeCol = header.findIndex((cell) => cell.trim() === OUTCOME_HEADER);
  if (outcomeCol < 0) outcomeCol = header.length;
  let mismatchCol = header.findIndex((cell) => cell.trim() === MISMATCH_HEADER);
  if (mismatchCol < 0) mismatchCol = Math.max(outcomeCol + 1, header.length);
  putCell(sheet, 0, outcomeCol, OUTCOME_HEADER);
  putCell(sheet, 0, mismatchCol, MISMATCH_HEADER);

  for (const row of rows) {
    const result = byUrl.get(row.url);
    const rowIndex = row.rowNumber - 1;
    if (!result) {
      putCell(sheet, rowIndex, outcomeCol, "Not run");
      putCell(sheet, rowIndex, mismatchCol, "Job was not queued");
      continue;
    }
    const reason =
      result.reason ??
      result.skipReason ??
      (result.status === "error" ? "ERROR" : result.status);
    putCell(sheet, rowIndex, outcomeCol, `${reason}, ${publicationWord(result, reason)}`);
    putCell(
      sheet,
      rowIndex,
      mismatchCol,
      mismatchNote(expectedCode(row.expectedReason), reason, result),
    );
  }

  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1");
  range.e.c = Math.max(range.e.c, outcomeCol, mismatchCol);
  range.e.r = Math.max(range.e.r, rows.length);
  sheet["!ref"] = XLSX.utils.encode_range(range);
  XLSX.writeFile(workbook, filePath);
}

async function loadResults(jobIds: number[]): Promise<Map<number, JobResult>> {
  const { rows } = await pool.query<{
    id: number;
    status: string;
    skip_reason_code: string | null;
    error_message: string | null;
    reason: string | null;
    publication: string | null;
    catalog_percent: string | null;
    catalog_verdict: string | null;
  }>(
    `SELECT j.id, j.status, j.skip_reason_code, j.error_message,
            r.extraction_json->>'decision_reason' AS reason,
            r.extraction_json->>'publication_status' AS publication,
            r.extraction_json->'verifier_checks'->'catalog_match'->>'percent' AS catalog_percent,
            r.extraction_json->'verifier_checks'->'catalog_match'->>'verdict' AS catalog_verdict
     FROM jobs j
     LEFT JOIN LATERAL (
       SELECT extraction_json
       FROM risks
       WHERE article_id = j.article_id
         AND created_at >= COALESCE(j.started_at, j.created_at)
       ORDER BY created_at DESC
       LIMIT 1
     ) r ON true
     WHERE j.id = ANY($1::int[])`,
    [jobIds],
  );
  const out = new Map<number, JobResult>();
  for (const row of rows) {
    const percent = row.catalog_percent == null ? null : Number(row.catalog_percent);
    out.set(row.id, {
      status: row.status,
      skipReason: row.skip_reason_code,
      errorMessage: row.error_message,
      reason: row.reason,
      publication: row.publication,
      catalogPercent: percent != null && Number.isFinite(percent) ? percent : null,
      catalogVerdict: row.catalog_verdict,
    });
  }
  return out;
}

function terminal(status: string | undefined): boolean {
  return status === "done" || status === "skipped" || status === "error" || status === "completed" || status === "failed";
}

async function main(): Promise<void> {
  const sheetPath =
    process.argv.find((arg) => arg.endsWith(".xlsx")) ??
    path.join(repoRoot, "files", "AIRI_Golden_Set_A0_30_completed.xlsx");
  const rows = await readRows(sheetPath);
  const urls = [...new Set(rows.map((row) => row.url))];
  console.log(`Sheet rows: ${rows.length}. Unique URLs: ${urls.length}.`);

  await assertPythonServiceReady();

  const jobByUrl = new Map<string, number>();
  if (process.argv.includes("--resume")) {
    const existing = await pool.query<{ id: number; url: string; status: string }>(
      `SELECT DISTINCT ON (url) id, url, status
       FROM jobs
       WHERE id >= 119
       ORDER BY url, id DESC`,
    );
    const stuck = existing.rows.filter((row) => row.status === "running").map((row) => row.id);
    if (stuck.length > 0) {
      await pool.query(
        `UPDATE jobs
         SET status = 'pending', started_at = NULL, finished_at = NULL, updated_at = NOW()
         WHERE id = ANY($1::int[]) AND status = 'running'`,
        [stuck],
      );
      console.log(`reset stuck jobs ${stuck.join(", ")}`);
    }
    for (const row of existing.rows) {
      if (urls.includes(row.url)) jobByUrl.set(row.url, row.id);
    }
    const missing = urls.filter((url) => !jobByUrl.has(url));
    for (const url of missing) {
      const queued = await enqueueManualJobUrl(url, { forceReprocess: true });
      jobByUrl.set(url, queued.job.id);
      console.log(`queued ${queued.job.id} ${url}`);
    }
    console.log(`resuming ${jobByUrl.size} jobs`);
  } else {
    for (const url of urls) {
      const queued = await enqueueManualJobUrl(url, { forceReprocess: true });
      jobByUrl.set(url, queued.job.id);
      console.log(`queued ${queued.job.id} ${url}`);
    }
  }

  const jobIds = [...jobByUrl.values()];
  for (;;) {
    const current = await loadResults(jobIds);
    const finished = jobIds.filter((id) => terminal(current.get(id)?.status)).length;
    console.log(`progress ${finished}/${jobIds.length}`);
    if (finished === jobIds.length) break;
    const ran = await runOneJob(jobIds);
    if (!ran) await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  const current = await loadResults(jobIds);
  const byUrl = new Map<string, JobResult>();
  let comparable = 0;
  let matched = 0;
  for (const row of rows) {
    const result = current.get(jobByUrl.get(row.url) ?? -1);
    if (!result) continue;
    byUrl.set(row.url, result);
    const reason = result.reason ?? result.skipReason ?? result.status;
    const expected = expectedCode(row.expectedReason);
    const note = mismatchNote(expected, reason, result);
    if (expected) {
      comparable += 1;
      if (expected === reason) matched += 1;
    }
    console.log(`${row.record} ${reason} ${note}`);
  }

  const targets = [
    sheetPath,
    path.join(repoRoot, "AIRI_Golden_Set_A0_30_completed.xlsx"),
    path.join(repoRoot, "files", "AIRI_Golden_Set_A0_30_completed.xlsx"),
  ];
  const written = new Set<string>();
  for (const target of targets) {
    const resolved = path.resolve(target);
    if (written.has(resolved)) continue;
    written.add(resolved);
    try {
      await writeResults(resolved, rows, byUrl);
      console.log(`updated ${resolved}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`could not update ${resolved}: ${message}`);
    }
  }

  console.log(
    comparable === 0
      ? "No rows had a v2 expected code."
      : `Agreement on rows with a v2 code: ${matched}/${comparable}`,
  );
  await pool.end();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
