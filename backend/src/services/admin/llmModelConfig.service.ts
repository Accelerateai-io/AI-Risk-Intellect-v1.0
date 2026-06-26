import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  findCatalogOption,
  loadModelOptionsFromCatalog,
  resolveBedrockModelId,
  type LlmModelOption as CatalogModelOption,
} from "../../config/modelsCatalog.js";
import { normalizeBedrockModelAlias } from "../../utils/bedrockModelId.js";
import { upsertEnvFile } from "../../utils/envFile.js";
import { invokeBedrockModelTest, invokeBedrockModelPrompt } from "./bedrockModelTest.service.js";
import { backendRoot } from "./spawnBackendScript.js";
import {
  buildModelFulfillmentResponse,
  printModelFulfillmentToTerminal,
  type ModelFulfillmentResponse,
} from "../../utils/modelFulfillmentResponse.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envLocalPath = path.join(backendRoot, ".env.local");

export type LlmBackend = "bedrock" | "local" | "openai" | "sagemaker" | "cisco";

export type LlmModelOption = CatalogModelOption | {
  id: string;
  label: string;
  backend: LlmBackend;
};

function activeBackend(): LlmBackend {
  if (process.env.USE_BEDROCK === "true") return "bedrock";
  if (process.env.USE_SAGEMAKER === "true") return "sagemaker";
  if (process.env.USE_OPENAI === "true") return "openai";
  if (process.env.USE_CISCO === "true") return "cisco";
  return "local";
}

function currentModelId(): string {
  const backend = activeBackend();
  if (backend === "bedrock") {
    const raw =
      process.env.BEDROCK_MODEL?.trim() ||
      process.env.BEDROCK_MODEL_ID?.trim() ||
      "";
    return normalizeBedrockModelAlias(raw);
  }
  if (backend === "openai") {
    return process.env.OPENAI_MODEL?.trim() || "gpt-5-mini";
  }
  if (backend === "sagemaker") {
    return process.env.SAGEMAKER_MODEL_NAME?.trim() || "foundation-sec-8b";
  }
  if (backend === "cisco") {
    return process.env.CISCO_MODEL_NAME?.trim() || "foundation-sec-8b";
  }
  return process.env.LOCAL_MODEL_ID?.trim() || "Qwen/Qwen2.5-3B-Instruct";
}

function findOption(modelId: string): LlmModelOption | undefined {
  return findCatalogOption(modelId);
}

function listOptions(): LlmModelOption[] {
  const options = loadModelOptionsFromCatalog();
  const current = currentModelId();

  if (current && !findOption(current)) {
    return [
      {
        id: current,
        label: `Current (${current})`,
        backend: activeBackend(),
      },
      ...options,
    ];
  }

  return options;
}

function isBedrockModel(modelId: string): boolean {
  return (
    Boolean(findCatalogOption(modelId)) ||
    modelId.startsWith("us.anthropic.") ||
    modelId.startsWith("anthropic.") ||
    modelId.startsWith("claude-") ||
    modelId.includes(".")
  );
}

function envUpdatesForModel(modelId: string): Record<string, string> {
  const option = findOption(modelId);
  const backend = option?.backend ?? (isBedrockModel(modelId) ? "bedrock" : activeBackend());

  const base: Record<string, string> = {
    USE_BEDROCK: "false",
    USE_SAGEMAKER: "false",
    USE_OPENAI: "false",
    USE_CISCO: "false",
  };

  if (backend === "bedrock" || isBedrockModel(modelId)) {
    const resolved = resolveBedrockModelId(modelId);
    return {
      ...base,
      USE_BEDROCK: "true",
      BEDROCK_MODEL: resolved,
      BEDROCK_MODEL_ID: resolved,
    };
  }

  if (backend === "openai") {
    return {
      ...base,
      USE_OPENAI: "true",
      OPENAI_MODEL: modelId,
    };
  }

  if (backend === "local") {
    return {
      ...base,
      LOCAL_MODEL_ID: modelId,
    };
  }

  throw new Error(`Unsupported model: ${modelId}`);
}

function applyEnvToProcess(updates: Record<string, string>): void {
  for (const [key, value] of Object.entries(updates)) {
    process.env[key] = value;
  }
}

function pythonUrl(): string {
  return (
    process.env.PYTHON_INGEST_URL?.trim() || "http://localhost:5006"
  ).replace(/\/$/, "");
}

async function syncPythonModel(modelId: string): Promise<{
  ok: boolean;
  requiresPythonRestart?: boolean;
}> {
  const url = `${pythonUrl()}/config/llm-model`;
  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      return { ok: false };
    }
    const data = (await res.json()) as {
      requiresPythonRestart?: boolean;
    };
    return {
      ok: true,
      requiresPythonRestart: data.requiresPythonRestart,
    };
  } catch {
    return { ok: false };
  }
}

export type LlmModelConfig = {
  backend: LlmBackend;
  modelId: string;
  modelLabel: string;
  options: LlmModelOption[];
  pythonSynced: boolean;
  requiresPythonRestart: boolean;
};

export function getLlmModelConfig(): LlmModelConfig {
  const backend = activeBackend();
  let modelId = currentModelId();
  if (backend === "bedrock" && modelId) {
    modelId = resolveBedrockModelId(modelId);
  }
  const option = findOption(modelId);

  return {
    backend,
    modelId,
    modelLabel: option?.label ?? modelId,
    options: listOptions(),
    pythonSynced: false,
    requiresPythonRestart: backend === "local",
  };
}

export type LlmModelValidationResult = {
  success: boolean;
  message: string;
  modelId?: string;
  invokeModelId?: string;
  response?: string;
  latencyMs?: number;
  fulfillmentResponse?: ModelFulfillmentResponse;
};

export type LlmModelInvokeResult = {
  success: boolean;
  message: string;
  modelId?: string;
  invokeModelId?: string;
  prompt?: string;
  response?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  latencyMs?: number;
  fulfillmentResponse?: ModelFulfillmentResponse;
};

export async function invokeLlmModel(input: {
  modelId: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<LlmModelInvokeResult> {
  const trimmed = input.modelId.trim();
  if (!trimmed) {
    return { success: false, message: "This model is not supported" };
  }

  const catalogOption = findOption(trimmed);
  if (
    !catalogOption &&
    activeBackend() === "bedrock" &&
    !isBedrockModel(trimmed)
  ) {
    return { success: false, message: "This model is not supported" };
  }

  try {
    envUpdatesForModel(trimmed);
  } catch {
    return { success: false, message: "This model is not supported" };
  }

  const backend =
    catalogOption?.backend ?? (isBedrockModel(trimmed) ? "bedrock" : activeBackend());
  if (backend === "bedrock" || isBedrockModel(trimmed)) {
    return invokeBedrockModelPrompt(input);
  }

  return {
    success: false,
    message: "Custom prompt invoke is only supported for Bedrock models.",
  };
}

export async function validateLlmModel(
  modelId: string,
): Promise<LlmModelValidationResult> {
  const trimmed = modelId.trim();
  if (!trimmed) {
    return {
      success: false,
      message: "This model is not supported",
    };
  }

  const catalogOption = findOption(trimmed);
  if (
    !catalogOption &&
    activeBackend() === "bedrock" &&
    !isBedrockModel(trimmed)
  ) {
    return {
      success: false,
      message: "This model is not supported",
    };
  }

  try {
    envUpdatesForModel(trimmed);
  } catch {
    return {
      success: false,
      message: "This model is not supported",
    };
  }

  const backend = catalogOption?.backend ?? (isBedrockModel(trimmed) ? "bedrock" : activeBackend());
  if (backend === "bedrock" || isBedrockModel(trimmed)) {
    return invokeBedrockModelTest(trimmed);
  }

  const fulfillmentResponse = buildModelFulfillmentResponse({
    success: true,
    text: "Model works",
    modelId: trimmed,
  });
  printModelFulfillmentToTerminal("LLM model test", fulfillmentResponse);
  return {
    success: true,
    message: "Model works",
    modelId: trimmed,
    fulfillmentResponse,
  };
}

export async function setLlmModel(modelId: string): Promise<LlmModelConfig> {
  const trimmed = modelId.trim();
  if (!trimmed) {
    throw new Error("modelId is required");
  }

  const catalogOption = findOption(trimmed);
  if (!catalogOption && activeBackend() === "bedrock" && !isBedrockModel(trimmed)) {
    throw new Error(`Model not found in models.json: ${trimmed}`);
  }

  const updates = envUpdatesForModel(trimmed);
  applyEnvToProcess(updates);

  if (fs.existsSync(envLocalPath)) {
    upsertEnvFile(envLocalPath, updates);
  }

  const python = await syncPythonModel(updates.BEDROCK_MODEL ?? trimmed);
  const config = getLlmModelConfig();
  config.pythonSynced = python.ok;
  config.requiresPythonRestart =
    python.requiresPythonRestart ?? config.requiresPythonRestart;

  return config;
}
