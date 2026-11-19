/**
 * Local only. Reads the development database named in .env.local and writes
 * Pipeline outcome, Mismatch, and Catalog score note on the client workbook.
 */
import "../bootstrap.js";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../database/db.js";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx") as typeof import("xlsx");

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const workbookPath = path.join(repoRoot, "AIRI_Golden_Set_A0_30_completed_1.xlsx");
const SHEET = "Golden set (30 dev records)";

const CODES = [
  "PUBLISHED_LABELLED",
  "CATALOG_SUGGESTED",
  "CLAIM_UNSUPPORTED",
  "SAFETY_HOLD",
  "REPAIR_FAILED",
  "FETCH_FAIL",
  "NOT_AI",
  "VERIFIED",
  "REPAIRED",
  "MERGED",
] as const;

type RowResult = {
  reason: string;
  publication: string;
  pct: number | null;
  best: string;
  title: string;
  verdict: string;
};

function expectedCode(raw: string): string | null {
  const text = raw.trim();
  for (const code of CODES) {
    if (text === code || text.startsWith(`${code} `) || text.startsWith(`${code}(`)) return code;
  }
  return null;
}

function scoreLine(result: RowResult): string {
  if (result.pct == null) return "No catalog score";
  const title = result.title ? ` (${result.title})` : "";
  const verdict = result.verdict ? `. The judge called it ${result.verdict}` : "";
  return `Score ${result.pct} on ${result.best}${title}${verdict}`;
}

function mismatchNote(expected: string | null, actual: string, result: RowResult): string {
  if (!expected) return "No v2 expected code";
  if (expected === actual) return "Matches";
  const pct = result.pct;
  if (actual === "CATALOG_SUGGESTED" && (expected === "VERIFIED" || expected === "PUBLISHED_LABELLED")) {
    return pct == null ? "Catalog match has no score" : `Catalog score ${pct}, under 60`;
  }
  if (actual === "CLAIM_UNSUPPORTED") return "Claim check failed";
  if (actual === "SAFETY_HOLD") return "Safety hold";
  if (expected === "CLAIM_UNSUPPORTED") return "Claim check passed";
  if (expected === "CATALOG_SUGGESTED" && pct != null) return `Catalog score ${pct}, at or above 60`;
  if (expected === "SAFETY_HOLD") return "Safety hold did not trigger";
  if (expected === "REPAIRED") return "Repair did not run";
  if (expected === "FETCH_FAIL" || expected === "NOT_AI") return `Ended as ${actual}`;
  return `Got ${actual}`;
}

function catalogNote(expected: string | null, actual: string, result: RowResult): string {
  const line = scoreLine(result);
  const pct = result.pct;
  if (actual === "FETCH_FAIL") return "No catalog score. The page could not be fetched, so nothing was scored.";
  if (actual === "NOT_AI") return "No catalog score. The page was not classified as an AI risk.";
  if (!expected) return `${line}. There is no v2 expected code to compare.`;
  if (expected === actual) {
    if (actual === "CATALOG_SUGGESTED") return `${line}. Under 60, which is why this matches the expected suggestion.`;
    if ((actual === "VERIFIED" || actual === "PUBLISHED_LABELLED") && pct != null && pct >= 60) {
      return `${line}. At or above 60, which is why this matches.`;
    }
    return `${line}. This row matches for a reason other than the 60 line.`;
  }
  if (actual === "CATALOG_SUGGESTED" && (expected === "VERIFIED" || expected === "PUBLISHED_LABELLED")) {
    return `${line}. Under 60, so it is a suggestion and does not match ${expected}.`;
  }
  if (expected === "CATALOG_SUGGESTED" && pct != null && pct >= 60) {
    return `${line}. At or above 60, so it is ${actual} instead of a suggestion.`;
  }
  if (actual === "CLAIM_UNSUPPORTED") return `${line}. The claim check failed before the catalog score could set the code.`;
  if (actual === "SAFETY_HOLD") return `${line}. The safety hold runs before the catalog score.`;
  if (expected === "REPAIRED") return `${line}. No unsupported clause was dropped, so it was not repaired.`;
  if (actual === "PUBLISHED_LABELLED" && expected === "VERIFIED") {
    return `${line}. At or above 60, but the evidence label keeps it labelled rather than verified.`;
  }
  return `${line}. Got ${actual}.`;
}

function publicationWord(reason: string, publication: string): string {
  if (reason === "FETCH_FAIL" || reason === "NOT_AI" || reason === "MERGED") return "No record";
  if (publication === "held") return "Held";
  if (publication === "published") return "Published";
  return publication || "Published";
}

async function loadResults(): Promise<Map<string, RowResult>> {
  const { rows } = await pool.query<{
    url: string;
    status: string;
    skip_reason_code: string | null;
    reason: string | null;
    publication: string | null;
    pct: string | null;
    best: string | null;
    verdict: string | null;
    title: string | null;
  }>(
    `SELECT a.url, j.status, j.skip_reason_code,
            r.extraction_json->>'decision_reason' AS reason,
            r.extraction_json->>'publication_status' AS publication,
            r.extraction_json->'verifier_checks'->'catalog_match'->>'percent' AS pct,
            r.extraction_json->'verifier_checks'->'catalog_match'->>'best_id' AS best,
            r.extraction_json->'verifier_checks'->'catalog_match'->>'verdict' AS verdict,
            (
              SELECT m->>'title'
              FROM jsonb_array_elements(COALESCE(r.extraction_json->'catalog_matches', '[]'::jsonb)) m
              WHERE m->>'riskId' = r.extraction_json->'verifier_checks'->'catalog_match'->>'best_id'
              LIMIT 1
            ) AS title
     FROM articles a
     JOIN LATERAL (
       SELECT status, skip_reason_code, started_at, created_at
       FROM jobs
       WHERE url = a.url
       ORDER BY id DESC
       LIMIT 1
     ) j ON true
     LEFT JOIN LATERAL (
       SELECT extraction_json
       FROM risks
       WHERE article_id = a.id
         AND created_at >= COALESCE(j.started_at, j.created_at) - interval '1 minute'
       ORDER BY created_at DESC
       LIMIT 1
     ) r ON true`,
  );
  const out = new Map<string, RowResult>();
  for (const row of rows) {
    const skipped = row.status === "skipped" || row.status === "error";
    const reason = skipped
      ? row.skip_reason_code || (row.status === "error" ? "ERROR" : "SKIPPED")
      : row.reason || "No decision";
    const pct = row.pct == null ? null : Number(row.pct);
    out.set(row.url.trim(), {
      reason,
      publication: skipped ? "" : row.publication || "",
      pct: skipped || pct == null || !Number.isFinite(pct) ? null : pct,
      best: skipped ? "" : row.best || "",
      title: skipped ? "" : (row.title || "").replace(/\s+/g, " ").trim(),
      verdict: skipped ? "" : row.verdict || "",
    });
  }
  return out;
}

function put(sheet: XLSX.WorkSheet, row: number, col: number, value: string): void {
  const address = XLSX.utils.encode_cell({ r: row, c: col });
  sheet[address] = { t: "s", v: value };
}

async function main(): Promise<void> {
  const results = await loadResults();
  const workbook = XLSX.readFile(workbookPath);
  const sheet = workbook.Sheets[SHEET];
  if (!sheet) throw new Error(`Missing sheet ${SHEET}`);
  const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" });
  const header = matrix[0] ?? [];
  const urlCol = header.findIndex((cell) => cell.trim() === "Article URL");
  const reasonCol = header.findIndex((cell) => cell.trim() === "Expected reason code");
  let outcomeCol = header.findIndex((cell) => cell.trim() === "Pipeline outcome");
  if (outcomeCol < 0) outcomeCol = header.length;
  let mismatchCol = header.findIndex((cell) => cell.trim() === "Mismatch");
  if (mismatchCol < 0) mismatchCol = outcomeCol + 1;
  let noteCol = header.findIndex((cell) => cell.trim() === "Catalog score note");
  if (noteCol < 0) noteCol = mismatchCol + 1;

  put(sheet, 0, outcomeCol, "Pipeline outcome");
  put(sheet, 0, mismatchCol, "Mismatch");
  put(sheet, 0, noteCol, "Catalog score note");

  let comparable = 0;
  let matched = 0;
  matrix.forEach((line, index) => {
    if (index === 0) return;
    const url = (line[urlCol] ?? "").trim();
    if (!url) return;
    const result = results.get(url);
    if (!result) {
      put(sheet, index, outcomeCol, "Not in development database");
      put(sheet, index, mismatchCol, "No job for this URL");
      put(sheet, index, noteCol, "No catalog score from the development database.");
      console.log(`${line[0]} missing`);
      return;
    }
    const expected = expectedCode(line[reasonCol] ?? "");
    const note = mismatchNote(expected, result.reason, result);
    if (expected) {
      comparable += 1;
      if (note === "Matches") matched += 1;
    }
    put(sheet, index, outcomeCol, `${result.reason}, ${publicationWord(result.reason, result.publication)}`);
    put(sheet, index, mismatchCol, note);
    put(sheet, index, noteCol, catalogNote(expected, result.reason, result));
    console.log(`${line[0]} ${result.reason} ${note}`);
  });

  const updates = matrix.slice(1).map((line, index) => {
    const rowNumber = index + 2;
    return {
      row: rowNumber,
      outcome: String(sheet[XLSX.utils.encode_cell({ r: index + 1, c: outcomeCol })]?.v ?? ""),
      mismatch: String(sheet[XLSX.utils.encode_cell({ r: index + 1, c: mismatchCol })]?.v ?? ""),
      note: String(sheet[XLSX.utils.encode_cell({ r: index + 1, c: noteCol })]?.v ?? ""),
    };
  });
  const jsonPath = path.join(repoRoot, "backend", "src", "scripts", "client-sheet-update.json");
  fs.writeFileSync(jsonPath, JSON.stringify(updates));
  console.log(`Agreement on rows with a v2 code: ${matched}/${comparable}`);
  console.log(`wrote ${jsonPath}`);
  await pool.end();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
