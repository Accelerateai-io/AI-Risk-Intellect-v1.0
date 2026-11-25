import { spawn } from "node:child_process";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  activeAttemptSkipReason,
  getActiveAttemptLimitMs,
  getJobMaxRuntimeMs,
  getJobRunSignal,
  isAbortOrTimeoutError,
  signalWithJobTimeout,
} from "../services/jobs/jobTimeout.service.js";
import { shouldRetryEmptyTransport } from "../services/risks/processingFailure.js";

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
    if (parsed.error === "NoAiRisk") {
      throw new NoAiRiskError(parsed.message || "no AI-relevant risk in content");
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

/**
 * Raised when Python extracted no AI-relevant risk from the content (B-4):
 * the page is not about AI, so no `risks` row should be inserted. Distinct
 * from StubExtractionError, which means the LLM transport/JSON itself failed.
 */
export class NoAiRiskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoAiRiskError";
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

    let settled = false;
    let response: import("node:http").IncomingMessage | null = null;
    const finish = (err: Error | null, raw?: string) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      if (err) reject(err);
      else resolve(raw ?? "");
    };

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
        response = res;
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on("end", () => {
          finish(null, Buffer.concat(chunks).toString("utf8"));
        });
        res.on("error", (err) => {
          finish(err instanceof Error ? err : timeoutAbortError());
        });
      },
    );

    const onAbort = () => {
      const err = timeoutAbortError();
      req.destroy(err);
      response?.destroy(err);
      finish(err);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    req.on("error", (err) => {
      finish(err instanceof Error ? err : timeoutAbortError());
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
    // Only the job interval may be described as "took more than N minutes".
    // A model read timeout is a different failure and keeps its own message.
    if (getJobRunSignal()?.aborted) {
      throw new Error(activeAttemptSkipReason());
    }
    if (isAbortOrTimeoutError(err)) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        detail.trim() ||
          "The model request timed out before the job execution limit.",
      );
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

const EMPTY_TRANSPORT_ATTEMPTS = 3;

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
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < EMPTY_TRANSPORT_ATTEMPTS; attempt++) {
    try {
      return useCliBridge()
        ? await runExtractCli(body)
        : await runExtractHttp(body);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (
        !shouldRetryEmptyTransport(lastError.message) ||
        attempt === EMPTY_TRANSPORT_ATTEMPTS - 1
      ) {
        throw lastError;
      }
    }
  }
  throw lastError ?? new Error("Model returned an empty response");
}

export type PythonAssessment = {
  ran?: boolean;
  parsed?: boolean;
  checks?: Record<string, unknown>;
  grounding_score?: number | null;
  quoted_support?: string[];
  safety_claim?: string | null;
  repair?: { drop_clause?: string; reason?: string } | null;
  buyer_relevance?: { pass?: boolean | null; use_case?: string; consequence?: string } | null;
};

async function runAssessHttp(payload: {
  text: string;
  record: Record<string, unknown>;
  modelId?: string;
  catalogCandidates: unknown[];
  hints: unknown;
}): Promise<PythonAssessment> {
  const base = pythonUrl();
  const limitMs = getActiveAttemptLimitMs() ?? (await getJobMaxRuntimeMs());
  const signal = signalWithJobTimeout(limitMs);
  let raw: string;
  try {
    raw = await postExtraction(
      `${base}/extract/assess`,
      JSON.stringify({
        text: payload.text,
        record: payload.record,
        catalogCandidates: payload.catalogCandidates,
        hints: payload.hints ?? {},
        ...(payload.modelId?.trim() ? { modelId: payload.modelId.trim() } : {}),
      }),
      signal,
    );
  } catch (err) {
    if (signal.aborted || isAbortOrTimeoutError(err)) {
      throw new Error(activeAttemptSkipReason());
    }
    throw new Error(`The assessment service could not be reached at ${base}.`);
  }
  let parsed: { ok?: boolean; assessment?: PythonAssessment; message?: string };
  try {
    parsed = JSON.parse(raw) as { ok?: boolean; assessment?: PythonAssessment; message?: string };
  } catch {
    throw new Error(`Invalid Python assess JSON: ${raw.slice(0, 500)}`);
  }
  if (!parsed.ok || !parsed.assessment) {
    throw new Error(parsed.message || "assessment failed");
  }
  return parsed.assessment;
}

async function runAssessCli(payload: {
  text: string;
  record: Record<string, unknown>;
  modelId?: string;
  catalogCandidates: unknown[];
  hints: unknown;
}): Promise<PythonAssessment> {
  const extractLimitMs = getActiveAttemptLimitMs() ?? (await getJobMaxRuntimeMs());
  return new Promise((resolve, reject) => {
    const py = pythonCommand();
    const child = spawn(py, ["-m", "app.extraction.cli"], {
      cwd: pythonRoot,
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (c: string) => {
      stdout += c;
    });
    child.stdin.write(
      JSON.stringify({
        op: "assess_risk",
        text: payload.text,
        record: payload.record,
        catalogCandidates: payload.catalogCandidates,
        hints: payload.hints ?? {},
        ...(payload.modelId?.trim() ? { modelId: payload.modelId.trim() } : {}),
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
    child.on("close", () => {
      jobSignal.removeEventListener("abort", onAbort);
      try {
        const parsed = JSON.parse(stdout.trim()) as {
          ok?: boolean;
          assessment?: PythonAssessment;
          message?: string;
        };
        if (!parsed.ok || !parsed.assessment) {
          reject(new Error(parsed.message || "assessment failed"));
          return;
        }
        resolve(parsed.assessment);
      } catch (err) {
        reject(err);
      }
    });
  });
}

/** Worker assessor call. Same source cache point as extraction, nine checks. */
export async function pythonAssessRisk(payload: {
  text: string;
  record: Record<string, unknown>;
  modelId?: string;
  catalogCandidates?: unknown[];
  hints?: unknown;
}): Promise<PythonAssessment> {
  const body = {
    text: payload.text,
    record: payload.record,
    catalogCandidates: payload.catalogCandidates ?? [],
    hints: payload.hints ?? {},
    ...(payload.modelId?.trim() ? { modelId: payload.modelId.trim() } : {}),
  };
  if (useCliBridge()) return runAssessCli(body);
  return runAssessHttp(body);
}
