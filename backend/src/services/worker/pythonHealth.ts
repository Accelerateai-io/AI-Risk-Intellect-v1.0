import { resolveBedrockModelId } from "../../config/modelsCatalog.js";

const DEFAULT_PYTHON_URL = "http://localhost:5006";

function pythonBaseUrl(): string {
  return (
    process.env.PYTHON_INGEST_URL?.trim() || DEFAULT_PYTHON_URL
  ).replace(/\/$/, "");
}

function configuredLlmModelId(): string | null {
  if (process.env.USE_BEDROCK === "true") {
    const model =
      process.env.BEDROCK_MODEL?.trim() ||
      process.env.BEDROCK_MODEL_ID?.trim() ||
      "claude-haiku-4-5";
    return resolveBedrockModelId(model);
  }
  if (process.env.USE_OPENAI === "true") {
    return process.env.OPENAI_MODEL?.trim() || "gpt-5-mini";
  }
  if (process.env.USE_SAGEMAKER === "true") {
    return process.env.SAGEMAKER_MODEL_NAME?.trim() || "foundation-sec-8b";
  }
  if (process.env.USE_CISCO === "true") {
    return process.env.CISCO_MODEL_NAME?.trim() || "foundation-sec-8b";
  }
  return process.env.LOCAL_MODEL_ID?.trim() || null;
}

/** Ensure Python HTTP service is up before processing jobs. */
export async function assertPythonServiceReady(): Promise<void> {
  const base = pythonBaseUrl();
  let res: Response;
  try {
    res = await fetch(`${base}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(8_000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Python unreachable at ${base}/health — ${msg}`);
  }
  if (!res.ok) {
    throw new Error(`Python health check failed (HTTP ${res.status}) at ${base}/health`);
  }
}

/** Align the running Python service with backend LLM env settings. */
export async function syncPythonLlmFromEnv(): Promise<void> {
  const modelId = configuredLlmModelId();
  if (!modelId) return;

  const base = pythonBaseUrl();
  try {
    const res = await fetch(`${base}/config/llm-model`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not sync LLM model (${modelId}) to Python at ${base}/config/llm-model — ${msg}`,
    );
  }
}
