import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SkipIngest } from "./filters.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const pythonRoot = path.join(repoRoot, "python");

const DEFAULT_PYTHON_INGEST_URL = "http://localhost:5006";
const INGEST_TIMEOUT_MS = 120_000;

export type PythonIngestResult = {
  text: string;
  title: string;
  details: {
    include_hits: number;
    exclude_hits: number;
    threshold: number;
  };
};

type CliResponse =
  | { ok: true; text: string; title: string; details: PythonIngestResult["details"] }
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

function handleIngestResponse(parsed: CliResponse): PythonIngestResult {
  if (!parsed.ok) {
    if (parsed.error === "SkipIngest") {
      throw new SkipIngest(parsed.message);
    }
    throw new Error(parsed.message || parsed.error);
  }

  return {
    text: parsed.text,
    title: parsed.title,
    details: parsed.details,
  };
}

async function runPythonIngestHttp(
  payload: Record<string, unknown>,
): Promise<PythonIngestResult> {
  const op = payload.op as string;
  const base = pythonIngestUrl();

  const pathByOp: Record<string, { path: string; body: Record<string, unknown> }> = {
    ingest_pdf: {
      path: "/ingest/pdf",
      body: {
        url: payload.url ?? "",
        title: payload.title ?? "",
        pdf_base64: payload.pdf_base64 ?? "",
        skip_ai_check: payload.skip_ai_check === true,
      },
    },
    ingest_raw: {
      path: "/ingest/raw",
      body: {
        url: payload.url ?? "",
        title: payload.title ?? "",
        raw_text: payload.raw_text ?? "",
      },
    },
    ingest_html: {
      path: "/ingest/html",
      body: {
        url: payload.url ?? "",
        title: payload.title ?? "",
        html: payload.html ?? "",
        skip_ai_check: payload.skip_ai_check === true,
      },
    },
  };

  const route = pathByOp[op];
  if (!route) {
    throw new Error(`Unknown Python ingest op: ${op}`);
  }

  let res: Response;
  try {
    res = await fetch(`${base}${route.path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(route.body),
      signal: AbortSignal.timeout(INGEST_TIMEOUT_MS),
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
      `Python ingestion returned empty body (HTTP ${res.status}). Check ${base}/health`,
    );
  }

  let parsed: CliResponse;
  try {
    parsed = JSON.parse(raw) as CliResponse;
  } catch {
    throw new Error(`Invalid Python HTTP JSON: ${raw.slice(0, 500)}`);
  }

  return handleIngestResponse(parsed);
}

function runPythonIngestCli(
  payload: Record<string, unknown>,
): Promise<PythonIngestResult> {
  return new Promise((resolve, reject) => {
    const py = pythonCommand();
    const child = spawn(py, ["-m", "app.ingestion.cli"], {
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
            `Python ingestion produced no output (exit ${code}). ${stderr || "Check PYTHON_BIN and dependencies."}`,
          ),
        );
        return;
      }

      let parsed: CliResponse;
      try {
        parsed = JSON.parse(trimmed) as CliResponse;
      } catch {
        reject(new Error(`Invalid Python CLI JSON: ${trimmed.slice(0, 500)}`));
        return;
      }

      try {
        resolve(handleIngestResponse(parsed));
      } catch (err) {
        reject(err);
      }
    });
  });
}

function runPythonIngest(payload: Record<string, unknown>): Promise<PythonIngestResult> {
  if (useCliBridge()) {
    return runPythonIngestCli(payload);
  }
  return runPythonIngestHttp(payload);
}

export async function pythonIngestPdf(
  pdfBytes: Buffer,
  options: { url?: string; title?: string; skipAiCheck?: boolean },
): Promise<PythonIngestResult> {
  return runPythonIngest({
    op: "ingest_pdf",
    url: options.url ?? "",
    title: options.title ?? "",
    pdf_base64: pdfBytes.toString("base64"),
    skip_ai_check: options.skipAiCheck === true,
  });
}

export async function pythonIngestRaw(
  rawText: string,
  options: { url?: string; title?: string },
): Promise<PythonIngestResult> {
  return runPythonIngest({
    op: "ingest_raw",
    url: options.url ?? "",
    title: options.title ?? "",
    raw_text: rawText,
  });
}

export async function pythonIngestHtml(
  html: string,
  options: { url?: string; title?: string; skipAiCheck?: boolean },
): Promise<PythonIngestResult> {
  return runPythonIngest({
    op: "ingest_html",
    url: options.url ?? "",
    title: options.title ?? "",
    html,
    skip_ai_check: options.skipAiCheck === true,
  });
}
