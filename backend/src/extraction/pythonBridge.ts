import { spawn } from "node:child_process";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  activeAttemptSkipReason,
  getActiveAttemptLimitMs,
  getJobMaxRuntimeMs,
  isAbortOrTimeoutError,
  signalWithJobTimeout,
} from "../services/jobs/jobTimeout.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const pythonRoot = path.join(repoRoot, "python");

const DEFAULT_PYTHON_URL = "http://localhost:5006";

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

function timeoutAbortError(): Error {
  const err = new Error("The operation was aborted due to timeout");
  err.name = "TimeoutError";
  return err;
}

/**
 * POST extraction with Node's HTTP client.
 * Global fetch gives up after 5 minutes of silence, which is shorter than a
 * 10–60 minute Controls limit and was reported as the service being down.
 */
function postExtraction(
  url: string,
  body: string,
  signal: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(timeoutAbortError());
      return;
    }

    const target = new URL(url);
    const transport = target.protocol === "https:" ? https : http;
    const req = transport.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on("end", () => {
          signal.removeEventListener("abort", onAbort);
          resolve(Buffer.concat(chunks).toString("utf8"));
        });
      },
    );

    const onAbort = () => {
      req.destroy(timeoutAbortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    req.on("error", (err) => {
      signal.removeEventListener("abort", onAbort);
      reject(err);
    });
    req.write(body);
    req.end();
  });
}

async function runExtractHttp(payload: {
  text: string;
  title: string;
  url: string;
  modelId?: string;
}): Promise<PythonExtractResult> {
  const base = pythonUrl();
  const limitMs = getActiveAttemptLimitMs() ?? (await getJobMaxRuntimeMs());
  const signal = signalWithJobTimeout(limitMs);
  let raw: string;
  try {
    raw = await postExtraction(
      `${base}/extract/risk`,
      JSON.stringify({
        text: payload.text,
        title: payload.title,
        url: payload.url,
        ...(payload.modelId?.trim()
          ? { modelId: payload.modelId.trim() }
          : {}),
      }),
      signal,
    );
  } catch (err) {
    if (signal.aborted || isAbortOrTimeoutError(err)) {
      throw new Error(activeAttemptSkipReason());
    }
    throw new Error(
      `The extraction service could not be reached at ${base}.`,
    );
  }
  let parsed: ExtractResponse;
  try {
    parsed = JSON.parse(raw) as ExtractResponse;
  } catch {
    throw new Error(`Invalid Python extract JSON: ${raw.slice(0, 500)}`);
  }

  return handleExtractResponse(parsed);
}

async function runExtractCli(payload: {
  text: string;
  title: string;
  url: string;
  modelId?: string;
}): Promise<PythonExtractResult> {
  const extractLimitMs = getActiveAttemptLimitMs() ?? (await getJobMaxRuntimeMs());
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

    const jobSignal = signalWithJobTimeout(extractLimitMs);
    const onAbort = () => {
      child.kill("SIGTERM");
      reject(new Error(activeAttemptSkipReason()));
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
