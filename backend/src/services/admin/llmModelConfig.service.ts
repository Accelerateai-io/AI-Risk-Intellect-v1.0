import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  findCatalogOption,
  loadModelOptionsFromCatalog,
  resolveBedrockModelId,
  type LlmModelOption as CatalogModelOption,
} from "../../config/modelsCatalog.js";
import { normalizeBedrockModelAlias, isBedrockProviderModelId } from "../../utils/bedrockModelId.js";
import { upsertEnvFile } from "../../utils/envFile.js";
import {
  invokeBedrockModelTest,
  invokeBedrockModelPrompt,
  invokeInferenceProfileTest,
  resolveWorkingInvokeIdForProfile,
} from "./bedrockModelTest.service.js";
import {
  fetchAllInferenceProfiles,
  findInferenceProfileById,
  findProfileForActiveModel,
  getProfileOptionId,
  inferenceProfilesEnabled,
} from "./bedrockInferenceProfiles.service.js";
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
  if (inferenceProfilesEnabled() && activeBackend() === "bedrock") {
    const profiles = cachedInferenceProfileOptions;
    if (profiles) {
      const match = profiles.find((option) => option.id === modelId);
      if (match) return match;
    }
  }
  return findCatalogOption(modelId);
}

let cachedInferenceProfileOptions: LlmModelOption[] | null = null;

async function listInferenceProfileOptions(): Promise<LlmModelOption[]> {
  if (!inferenceProfilesEnabled()) return [];

  const profiles = await fetchAllInferenceProfiles();
  const options: LlmModelOption[] = [];

  for (const profile of profiles) {
    const id = getProfileOptionId(profile);
    const label = profile.inferenceProfileName?.trim() || profile.modelId || id;
    if (!id || !label) continue;
    options.push({
      id,
      label,
      backend: "bedrock",
    });
  }

  cachedInferenceProfileOptions = options;
  return options;
}

function listOptions(): LlmModelOption[] {
  if (cachedInferenceProfileOptions?.length) {
    return [...cachedInferenceProfileOptions];
  }
  const options = loadModelOptionsFromCatalog();
  const current = currentModelId();

  if (current && !findCatalogOption(current)) {
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

async function listOptionsAsync(): Promise<LlmModelOption[]> {
  if (inferenceProfilesEnabled() && activeBackend() === "bedrock") {
    try {
      const profiles = await fetchAllInferenceProfiles();
      const profileOptions: LlmModelOption[] = [];

      for (const profile of profiles) {
        const id = getProfileOptionId(profile);
        const label = profile.inferenceProfileName?.trim() || profile.modelId || id;
        if (!id || !label) continue;
        profileOptions.push({ id, label, backend: "bedrock" });
      }

      cachedInferenceProfileOptions = profileOptions;

      if (profileOptions.length > 0) {
        const current = currentModelId();
        const activeProfile = current
          ? findProfileForActiveModel(current, profiles)
          : undefined;

        if (
          activeProfile &&
          !profileOptions.some((o) => o.id === getProfileOptionId(activeProfile))
        ) {
          return [
            {
              id: getProfileOptionId(activeProfile),
              label:
                activeProfile.inferenceProfileName ||
                getProfileOptionId(activeProfile),
              backend: "bedrock",
            },
            ...profileOptions,
          ];
        }

        return profileOptions;
      }
    } catch (err) {
      console.error("[llmModelConfig] Failed to load inference profiles:", err);
    }
  }

  return listOptions();
}

function isBedrockModel(modelId: string): boolean {
  return (
    Boolean(findCatalogOption(modelId)) ||
    Boolean(findInferenceProfileById(modelId)) ||
    modelId.startsWith("us.anthropic.") ||
    modelId.startsWith("anthropic.") ||
    modelId.startsWith("claude-") ||
    modelId.startsWith("arn:aws:bedrock:") ||
    isBedrockProviderModelId(modelId)
  );
}

function isInferenceProfileSelection(modelId: string): boolean {
  if (!inferenceProfilesEnabled()) return false;
  if (!cachedInferenceProfileOptions?.some((o) => o.id === modelId)) {
    return false;
  }
  return Boolean(findInferenceProfileById(modelId));
}

function envUpdatesForModel(modelId: string, invokeModelId?: string): Record<string, string> {
  const option = findOption(modelId);
  const backend = option?.backend ?? (isBedrockModel(modelId) ? "bedrock" : activeBackend());

  const base: Record<string, string> = {
    USE_BEDROCK: "false",
    USE_SAGEMAKER: "false",
    USE_OPENAI: "false",
    USE_CISCO: "false",
  };

  if (backend === "bedrock" || isBedrockModel(modelId) || isInferenceProfileSelection(modelId)) {
    const resolved = invokeModelId?.trim() || resolveBedrockModelId(modelId);
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

/** Sync the running Python service to a specific model id (not only process env). */
export async function syncPythonLlmModel(modelId: string): Promise<boolean> {
  const trimmed = modelId.trim();
  if (!trimmed) return false;
  const result = await syncPythonModel(trimmed);
  return result.ok;
}

export type LlmModelConfig = {
  backend: LlmBackend;
  modelId: string;
  modelLabel: string;
  options: LlmModelOption[];
  pythonSynced: boolean;
  requiresPythonRestart: boolean;
  inferenceProfiles?: boolean;
};

export async function getLlmModelConfigAsync(): Promise<LlmModelConfig> {
  const backend = activeBackend();
  const rawModelId = currentModelId();
  const options = await listOptionsAsync();

  let modelId = rawModelId;
  let option = findOption(modelId);

  if (!option && inferenceProfilesEnabled() && backend === "bedrock" && rawModelId) {
    const profiles = await fetchAllInferenceProfiles();
    const activeProfile = findProfileForActiveModel(rawModelId, profiles);
    if (activeProfile) {
      option = {
        id: getProfileOptionId(activeProfile),
        label:
          activeProfile.inferenceProfileName || getProfileOptionId(activeProfile),
        backend: "bedrock",
      };
      modelId = option.id;
    }
  }

  if (!option && backend === "bedrock" && rawModelId && !isInferenceProfileSelection(rawModelId)) {
    modelId = resolveBedrockModelId(rawModelId);
    option = findOption(modelId) ?? findCatalogOption(modelId);
  }

  return {
    backend,
    modelId: option?.id ?? modelId,
    modelLabel: option?.label ?? modelId,
    options,
    pythonSynced: false,
    requiresPythonRestart: backend === "local",
    inferenceProfiles:
      inferenceProfilesEnabled() &&
      options.length > 0 &&
      Boolean(cachedInferenceProfileOptions?.length),
  };
}

export function getLlmModelConfig(): LlmModelConfig {
  const backend = activeBackend();
  let modelId = currentModelId();
  if (backend === "bedrock" && modelId) {
    modelId = resolveBedrockModelId(modelId);
  }
  const option = findOption(modelId);

  return {
    backend,
    modelId: option?.id ?? modelId,
    modelLabel: option?.label ?? modelId,
    options: listOptions(),
    pythonSynced: false,
    requiresPythonRestart: backend === "local",
    inferenceProfiles: inferenceProfilesEnabled(),
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
  workingVia?: string;
  profileTest?: import("./bedrockInferenceProfiles.service.js").InferenceProfileTestResult;
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

  if (inferenceProfilesEnabled()) {
    await listInferenceProfileOptions();
    if (isInferenceProfileSelection(trimmed)) {
      const workingId = await resolveWorkingInvokeIdForProfile(trimmed, {
        forceRetest: false,
      });
      if (!workingId) {
        return {
          success: false,
          message: "Inference profile is not working with any identifier.",
        };
      }
      return invokeBedrockModelPrompt({
        ...input,
        modelId: workingId,
      });
    }
  }

  const catalogOption = findCatalogOption(trimmed);
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

  if (inferenceProfilesEnabled()) {
    await listInferenceProfileOptions();
    if (isInferenceProfileSelection(trimmed)) {
      return invokeInferenceProfileTest(trimmed);
    }
  }

  const catalogOption = findCatalogOption(trimmed);
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

  let invokeModelId: string | undefined;

  if (inferenceProfilesEnabled()) {
    await listInferenceProfileOptions();
    if (isInferenceProfileSelection(trimmed)) {
      const workingId = await resolveWorkingInvokeIdForProfile(trimmed, {
        forceRetest: false,
      });
      if (!workingId) {
        throw new Error(
          "Inference profile test failed. Run Test before Apply, or choose another profile.",
        );
      }
      invokeModelId = workingId;
    }
  }

  const catalogOption = findCatalogOption(trimmed);
  if (!catalogOption && !invokeModelId && activeBackend() === "bedrock" && !isBedrockModel(trimmed)) {
    throw new Error(`Model not found: ${trimmed}`);
  }

  const updates = envUpdatesForModel(trimmed, invokeModelId);
  applyEnvToProcess(updates);
  upsertEnvFile(envLocalPath, updates);

  const python = await syncPythonModel(updates.BEDROCK_MODEL ?? trimmed);
  const config = await getLlmModelConfigAsync();
  config.pythonSynced = python.ok;
  config.requiresPythonRestart =
    python.requiresPythonRestart ?? config.requiresPythonRestart;

  return config;
}
