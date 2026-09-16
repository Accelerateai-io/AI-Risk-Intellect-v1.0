import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  normalizeBedrockModelAlias,
  stripUsModelPrefix,
  withUsModelPrefix,
} from "../utils/bedrockModelId.js";
import { backendRoot } from "../services/admin/spawnBackendScript.js";

export type LlmModelOption = {
  id: string;
  label: string;
  backend: "bedrock";
};

const modelsJsonPath = path.join(backendRoot, "models.json");

const bedrockModelSchema = z.object({
  modelId: z.string().min(1),
  name: z.string().min(1),
  provider: z.string().optional(),
  inputModalities: z.array(z.string()).default([]),
  outputModalities: z.array(z.string()).default([]),
  lifecycleStatus: z.string().optional(),
});

const modelsFileSchema = z.object({
  models: z.array(bedrockModelSchema).default([]),
});

export type BedrockCatalogModel = z.infer<typeof bedrockModelSchema>;

let cachedOptions: LlmModelOption[] | null = null;
let cachedById: Map<string, BedrockCatalogModel> | null = null;

function loadCatalogFile(): z.infer<typeof modelsFileSchema> {
  if (!fs.existsSync(modelsJsonPath)) {
    throw new Error(`models.json not found at ${modelsJsonPath}`);
  }

  console.log(`[models.json] Reading catalog from ${modelsJsonPath}`);
  const raw = fs.readFileSync(modelsJsonPath, "utf8");

  const parsed = modelsFileSchema.parse(JSON.parse(raw));
  console.log(
    `[models.json] Parsed ${parsed.models.length} model(s) from catalog file`,
  );
  return parsed;
}

/** Text-generation Bedrock models suitable for risk extraction. */
function isTextGenerationModel(model: BedrockCatalogModel): boolean {
  const outputs = model.outputModalities.map((m) => m.toUpperCase());
  const inputs = model.inputModalities.map((m) => m.toUpperCase());
  return outputs.includes("TEXT") && inputs.includes("TEXT");
}

function optionLabel(model: BedrockCatalogModel): string {
  const provider = model.provider?.trim();
  return provider ? `${model.name} (${provider})` : model.name;
}

function buildCache(): void {
  const parsed = loadCatalogFile();
  const byId = new Map<string, BedrockCatalogModel>();
  const options: LlmModelOption[] = [];

  // Include LEGACY models in the picker (e.g. Claude 3 Sonnet). That is generally
  // not recommended — AWS may block or retire those endpoints.
  for (const model of parsed.models) {
    if (!isTextGenerationModel(model)) continue;

    const resolvedId = withUsModelPrefix(model.modelId);
    byId.set(model.modelId, model);
    byId.set(resolvedId, model);
    options.push({
      id: resolvedId,
      label: optionLabel(model),
      backend: "bedrock",
    });
  }

  options.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));

  cachedById = byId;
  cachedOptions = options;

  console.log(
    `[models.json] Built dropdown cache — ${options.length} text-generation option(s)`,
  );
}

export function getCatalogModel(modelId: string): BedrockCatalogModel | undefined {
  if (!cachedById) buildCache();
  const normalized = modelId.trim();
  if (
    normalized.startsWith("arn:aws:bedrock:") ||
    normalized.includes(":inference-profile/") ||
    normalized.includes(":application-inference-profile/")
  ) {
    return undefined;
  }

  const candidates = [
    normalized,
    stripUsModelPrefix(normalized),
    withUsModelPrefix(stripUsModelPrefix(normalized)),
  ];

  for (const candidate of candidates) {
    const exact = cachedById!.get(candidate);
    if (exact) return exact;
  }

  return undefined;
}

export function loadModelOptionsFromCatalog(): LlmModelOption[] {
  if (!cachedOptions) buildCache();
  return [...cachedOptions!];
}

export function findCatalogOption(modelId: string): LlmModelOption | undefined {
  const model = getCatalogModel(modelId);
  if (!model) return undefined;
  return {
    id: withUsModelPrefix(model.modelId),
    label: optionLabel(model),
    backend: "bedrock",
  };
}

export function resolveBedrockModelId(modelId: string): string {
  const normalized = normalizeBedrockModelAlias(modelId);
  const catalog = getCatalogModel(normalized);
  const base = catalog?.modelId ?? normalized;
  return withUsModelPrefix(base);
}
