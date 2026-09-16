import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { signalWithJobTimeout } from "../services/jobs/jobTimeout.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const pythonRoot = path.join(repoRoot, "python");

const DEFAULT_PYTHON_URL = "http://localhost:5006";
const EXTRACT_TIMEOUT_MS = 5 * 60 * 1000;

export type RiskExtractionObject = {
  risk?: {
    risk_title?: string;
    domains?: string;
    description?: string;
    primary_risk?: string;
    secondary_risks?: string;
    sector?: string;
    industry?: string;
    intent?: string;
    ai_product_name?: string | null;
    ai_product_vendor?: string | null;
    [key: string]: unknown;
  };
  risk_scoring?: {
    likelihood?: number | null;
    likelihood_reasoning?: string;
    impact?: number | null;
    impact_reasoning?: string;
    loss_categories?: string[];
    severity_score?: number | null;
    severity_band?: string | null;
    [key: string]: unknown;
  };
  justification?: {
    self_assessment?: { total_score?: number };
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type PythonExtractMetrics = {
  word_count: number;
  tokens_generated: number;
  duration_ms: number;
};

export type PythonExtractResult = {
  object: RiskExtractionObject;
  sourceFlag: string;
  model: string;
  metrics: PythonExtractMetrics;
};

type ExtractResponse =
  | {
      ok: true;
      object: RiskExtractionObject;
      source_flag: string;
      model: string;
      metrics?: PythonExtractMetrics;
    }
  | {
      ok: false;
      error: string;
      message: string;
      source_flag?: string;
      object?: RiskExtractionObject;
      metrics?: PythonExtractMetrics;
    };

function pythonUrl(): string {
  return (
    process.env.PYTHON_INGEST_URL?.trim() || DEFAULT_PYTHON_URL
  ).replace(/\/$/, "");
}

function useCliBridge(): boolean {
  return process.env.PYTHON_INGEST_USE_CLI === "true";
}

function pythonCommand(): string {
  return (
    process.env.PYTHON_BIN?.trim() ||
    (process.platform === "win32" ? "python" : "python3")
  );
}

function stubExtractionDetail(parsed: ExtractResponse & { ok: false }): string {
  const stubReason = parsed.object?._stub_reason;
  if (typeof stubReason === "string" && stubReason.trim()) {
    return `${parsed.message}: ${stubReason.trim()}`;
  }
  return parsed.message;
}

function handleExtractResponse(parsed: ExtractResponse): PythonExtractResult {
  if (!parsed.ok) {
    if (parsed.error === "StubExtraction") {
      throw new StubExtractionError(stubExtractionDetail(parsed));
    }
    throw new Error(parsed.message || parsed.error);
  }

  const metrics = parsed.metrics ?? {
    word_count: 0,
    tokens_generated: 0,
    duration_ms: 1,
  };

  return {
    object: parsed.object,
    sourceFlag: parsed.source_flag,
    model: parsed.model,
    metrics,
  };
}

export class StubExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StubExtractionError";
  }
}

async function runExtractHttp(payload: {
  text: string;
  title: string;
  url: string;
  modelId?: string;
}): Promise<PythonExtractResult> {
  const base = pythonUrl();
  let res: Response;
  try {
    res = await fetch(`${base}/extract/risk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: payload.text,
        title: payload.title,
        url: payload.url,
        ...(payload.modelId?.trim()
          ? { modelId: payload.modelId.trim() }
          : {}),
      }),
      signal: signalWithJobTimeout(EXTRACT_TIMEOUT_MS),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Python extraction unreachable at ${base}. Start with npm run py:dev. ${msg}`,
    );
  }

  const raw = await res.text();
  let parsed: ExtractResponse;
  try {
    parsed = JSON.parse(raw) as ExtractResponse;
  } catch {
    throw new Error(`Invalid Python extract JSON: ${raw.slice(0, 500)}`);
  }

  return handleExtractResponse(parsed);
}

function runExtractCli(payload: {
  text: string;
  title: string;
  url: string;
  modelId?: string;
}): Promise<PythonExtractResult> {
  return new Promise((resolve, reject) => {
    const py = pythonCommand();
    const child = spawn(py, ["-m", "app.extraction.cli"], {
      cwd: pythonRoot,
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c: string) => {
      stdout += c;
    });
    child.stderr.on("data", (c: string) => {
      stderr += c;
    });

    child.stdin.write(
      JSON.stringify({
        op: "extract_risk",
        text: payload.text,
        title: payload.title,
        url: payload.url,
        ...(payload.modelId?.trim()
          ? { modelId: payload.modelId.trim() }
          : {}),
      }),
    );
    child.stdin.end();

    const jobSignal = signalWithJobTimeout(EXTRACT_TIMEOUT_MS);
    const onAbort = () => {
      child.kill("SIGTERM");
      reject(new Error("Skipped because this URL took more than 5 minutes without finishing — it was taking too long."));
    };
    if (jobSignal.aborted) {
      onAbort();
      return;
    }
    jobSignal.addEventListener("abort", onAbort, { once: true });

    child.on("error", (err) => {
      jobSignal.removeEventListener("abort", onAbort);
      reject(new Error(`Failed to start Python (${py}): ${err.message}`));
    });

    child.on("close", (code) => {
      jobSignal.removeEventListener("abort", onAbort);
      const trimmed = stdout.trim();
      if (!trimmed) {
        reject(
          new Error(
            `Python extraction produced no output (exit ${code}). ${stderr}`,
          ),
        );
        return;
      }
      try {
        resolve(
          handleExtractResponse(JSON.parse(trimmed) as ExtractResponse),
        );
      } catch (err) {
        reject(err);
      }
    });
  });
}

export async function pythonExtractRisk(payload: {
  text: string;
  title?: string;
  url?: string;
  modelId?: string;
}): Promise<PythonExtractResult> {
  const body = {
    text: payload.text,
    title: payload.title ?? "",
    url: payload.url ?? "",
    ...(payload.modelId?.trim() ? { modelId: payload.modelId.trim() } : {}),
  };
  if (useCliBridge()) {
    return runExtractCli(body);
  }
  return runExtractHttp(body);
}
