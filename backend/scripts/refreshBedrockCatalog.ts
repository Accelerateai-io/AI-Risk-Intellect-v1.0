/**
 * Refresh backend/models.json from AWS Bedrock ListFoundationModels.
 * Ported from 26May2026_Models/server.js.
 */
import { config as loadEnv } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BedrockClient,
  ListFoundationModelsCommand,
} from "@aws-sdk/client-bedrock";
import { backendRoot } from "../src/services/admin/spawnBackendScript.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

loadEnv({ path: path.join(backendRoot, ".env.local") });
loadEnv({ path: path.join(backendRoot, ".env") });
const modelsJsonPath = path.join(backendRoot, "models.json");

const region =
  process.env.AWS_REGION?.trim() ||
  process.env.AWS_DEFAULT_REGION?.trim() ||
  "us-east-1";

type FoundationModelSummary = {
  modelId?: string;
  modelName?: string;
  providerName?: string;
  modelArn?: string;
  inputModalities?: string[];
  outputModalities?: string[];
  customizationsSupported?: string[];
  inferenceTypesSupported?: string[];
  modelLifecycle?: { status?: string };
};

function toModelJson(model: FoundationModelSummary) {
  return {
    modelId: model.modelId,
    name: model.modelName,
    provider: model.providerName,
    modelArn: model.modelArn,
    inputModalities: model.inputModalities ?? [],
    outputModalities: model.outputModalities ?? [],
    supportedCustomizations: model.customizationsSupported ?? [],
    supportedInferenceTypes: model.inferenceTypesSupported ?? [],
    lifecycleStatus: model.modelLifecycle?.status ?? null,
  };
}

async function main(): Promise<void> {
  console.log(
    `[models.json] Fetching foundation models from AWS Bedrock (region: ${region})…`,
  );

  const client = new BedrockClient({ region });
  const response = await client.send(new ListFoundationModelsCommand({}));
  const models = response.modelSummaries ?? [];

  const active = models.filter(
    (m) => m.modelLifecycle?.status === "ACTIVE",
  ).length;
  const legacy = models.filter(
    (m) => m.modelLifecycle?.status === "LEGACY",
  ).length;

  const output = {
    region,
    generatedAt: new Date().toISOString(),
    summary: {
      total: models.length,
      active,
      legacy,
    },
    models: models.map(toModelJson),
  };

  const serialized = JSON.stringify(output, null, 2);

  console.log("[models.json] Complete JSON fetched from AWS Bedrock:");
  console.log(serialized);

  console.log(`[models.json] Writing catalog to ${modelsJsonPath}`);
  fs.writeFileSync(modelsJsonPath, `${serialized}\n`, "utf8");

  const stored = fs.readFileSync(modelsJsonPath, "utf8");
  console.log("[models.json] Complete JSON stored on disk:");
  console.log(stored);

  console.log(
    `[models.json] Done — ${models.length} models (${active} active, ${legacy} legacy) in ${region}.`,
  );
}

await main();
