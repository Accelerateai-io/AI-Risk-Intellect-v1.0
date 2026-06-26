import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PythonEtlImportResult } from "./etlImport.types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const pythonRoot = path.join(repoRoot, "python");

const DEFAULT_PYTHON_INGEST_URL = "http://localhost:5006";
const ETL_TIMEOUT_MS = 300_000;

type CliResponse =
  | ({ ok: true } & PythonEtlImportResult)
  | { ok: false; error: string; message: string };

function pythonIngestUrl(): string {
  return (
    process.env.PYTHON_INGEST_URL?.trim() ||
    DEFAULT_PYTHON_INGEST_URL
  ).replace(/\/$/, "");
}

function useCliBridge(): boolean {
  return process.env.PYTHON_INGEST_USE_CLI === "true";
}

function pythonCommand(): string {
  return process.env.PYTHON_BIN?.trim() || (process.platform === "win32" ? "python" : "python3");
}

function handleEtlResponse(parsed: CliResponse): PythonEtlImportResult {
  if (!parsed.ok) {
    throw new Error(parsed.message || parsed.error);
  }

  return {
    totalRows: parsed.totalRows,
    records: parsed.records,
    skippedRows: parsed.skippedRows,
    failedRows: parsed.failedRows,
    skippedDetails: parsed.skippedDetails,
    failedDetails: parsed.failedDetails,
  };
}

async function runPythonEtlHttp(
  payload: Record<string, unknown>,
): Promise<PythonEtlImportResult> {
  const base = pythonIngestUrl();

  let res: Response;
  try {
    res = await fetch(`${base}/etl/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(ETL_TIMEOUT_MS),
    });
  } catch (err) {
    const hint =
      `Is the Python service running? Start with: npm run py:dev (from backend/) or npm run dev. ` +
      `URL: ${base}`;
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`${hint} ${msg}`);
  }

  const raw = await res.text();
  if (!raw.trim()) {
    throw new Error(
      `Python ETL returned empty body (HTTP ${res.status}). Check ${base}/health`,
    );
  }

  let parsed: CliResponse;
  try {
    parsed = JSON.parse(raw) as CliResponse;
  } catch {
    throw new Error(`Invalid Python ETL JSON: ${raw.slice(0, 500)}`);
  }

  return handleEtlResponse(parsed);
}

function runPythonEtlCli(
  payload: Record<string, unknown>,
): Promise<PythonEtlImportResult> {
  return new Promise((resolve, reject) => {
    const py = pythonCommand();
    const child = spawn(py, ["-m", "app.etl.cli"], {
      cwd: pythonRoot,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();

    child.on("error", (err) => {
      reject(
        new Error(
          `Failed to start Python (${py}). Install Python 3 and run: pip install -r python/requirements.txt. ${err.message}`,
        ),
      );
    });

    child.on("close", (code) => {
      const trimmed = stdout.trim();
      if (!trimmed) {
        reject(
          new Error(
            `Python ETL produced no output (exit ${code}). ${stderr || "Check PYTHON_BIN and dependencies."}`,
          ),
        );
        return;
      }

      let parsed: CliResponse;
      try {
        parsed = JSON.parse(trimmed) as CliResponse;
      } catch {
        reject(new Error(`Invalid Python ETL CLI JSON: ${trimmed.slice(0, 500)}`));
        return;
      }

      try {
        resolve(handleEtlResponse(parsed));
      } catch (err) {
        reject(err);
      }
    });
  });
}

function runPythonEtl(payload: Record<string, unknown>): Promise<PythonEtlImportResult> {
  if (useCliBridge()) {
    return runPythonEtlCli(payload);
  }
  return runPythonEtlHttp(payload);
}

/** Prefer on-disk path for large files to avoid huge base64 JSON payloads. */
export async function pythonEtlImportFromPath(
  absolutePath: string,
  options: { filename: string },
): Promise<PythonEtlImportResult> {
  return runPythonEtl({
    filename: options.filename,
    file_path: absolutePath,
  });
}

export async function pythonEtlImport(
  fileBytes: Buffer,
  options: { filename: string },
): Promise<PythonEtlImportResult> {
  const usePathThreshold = 8 * 1024 * 1024;
  if (fileBytes.length >= usePathThreshold) {
    throw new Error(
      "Large ETL files must be parsed from a stored file path. Use pythonEtlImportFromPath instead.",
    );
  }

  return runPythonEtl({
    filename: options.filename,
    file_base64: fileBytes.toString("base64"),
  });
}
