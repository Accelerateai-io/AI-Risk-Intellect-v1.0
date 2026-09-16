import fs from "node:fs";
import path from "node:path";
import {
  BedrockClient,
  ListInferenceProfilesCommand,
  type InferenceProfileSummary,
} from "@aws-sdk/client-bedrock";
import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { backendRoot } from "./spawnBackendScript.js";
import { formatBedrockTestError } from "../../utils/bedrockErrors.js";

export type InferenceProfile = InferenceProfileSummary & {
  profileType?: string;
  modelId?: string;
};

export type StoredInferenceProfile = InferenceProfile & {
  foundationModelId: string | null;
};

export type InferenceProfilesFile = {
  region: string;
  fetchedAt: string;
  count: number;
  profiles: StoredInferenceProfile[];
};

export type InferenceProfileTestResultsFile = {
  region: string;
  updatedAt: string;
  count: number;
  results: InferenceProfileTestResult[];
};

export type ProfileTestTarget = {
  identifierType: "model" | "inferenceProfileId" | "inferenceProfileArn";
  value: string;
};

export type ProfileTargetTestResult = {
  status: "working" | "not working";
  identifierType: ProfileTestTarget["identifierType"];
  value: string;
  prompt: string;
  reply?: string;
  latencyMs: number;
  stopReason?: string;
  error?: string;
  errorName?: string;
};

export type InferenceProfileTestResult = {
  profileName: string;
  profileType?: string;
  inferenceProfileId?: string;
  inferenceProfileArn?: string;
  foundationModelId: string | null;
  prompt: string;
  testedAt: string;
  tests: ProfileTargetTestResult[];
  overallStatus: "working" | "not working";
  workingTarget?: ProfileTestTarget;
  workingReply?: string;
  summary: {
    working: number;
    notWorking: number;
  };
};

let cachedProfiles: InferenceProfile[] | null = null;
let cachedProfilesAt = 0;
const PROFILE_CACHE_MS = 5 * 60 * 1000;

export function inferenceProfilesFilePath(region?: string): string {
  const resolved = region?.trim() || bedrockRegion();
  return path.join(backendRoot, `inference-profiles-${resolved}.json`);
}

export function inferenceProfileTestResultsFilePath(region?: string): string {
  const resolved = region?.trim() || bedrockRegion();
  return path.join(
    backendRoot,
    `inference-profile-test-results-${resolved}.json`,
  );
}

function enrichProfileForStorage(profile: InferenceProfile): StoredInferenceProfile {
  return {
    ...profile,
    foundationModelId: getFoundationModelId(profile),
  };
}

export function saveInferenceProfilesToFile(
  profiles: InferenceProfile[],
): InferenceProfilesFile {
  const region = bedrockRegion();
  const payload: InferenceProfilesFile = {
    region,
    fetchedAt: new Date().toISOString(),
    count: profiles.length,
    profiles: profiles.map(enrichProfileForStorage),
  };
  const filePath = inferenceProfilesFilePath(region);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(
    `[inference-profiles] Saved ${payload.count} profile(s) to ${filePath}`,
  );
  return payload;
}

export function loadInferenceProfilesFromFile(
  region?: string,
): InferenceProfile[] | null {
  const filePath = inferenceProfilesFilePath(region);
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw) as InferenceProfilesFile;
    if (!Array.isArray(data.profiles)) return null;

    const currentRegion = bedrockRegion();
    if (data.region && data.region !== currentRegion) {
      console.warn(
        `[inference-profiles] File region ${data.region} does not match active region ${currentRegion} — ignoring cache`,
      );
      return null;
    }

    console.log(
      `[inference-profiles] Loaded ${data.profiles.length} profile(s) from ${filePath}`,
    );
    return data.profiles;
  } catch (err) {
    console.error(`[inference-profiles] Failed to read ${filePath}:`, err);
    return null;
  }
}

function saveProfileTestResultToFile(result: InferenceProfileTestResult): void {
  const region = bedrockRegion();
  const filePath = inferenceProfileTestResultsFilePath(region);
  let existing: InferenceProfileTestResult[] = [];

  if (fs.existsSync(filePath)) {
    try {
      const data = JSON.parse(
        fs.readFileSync(filePath, "utf8"),
      ) as InferenceProfileTestResultsFile;
      if (Array.isArray(data.results)) existing = data.results;
    } catch {
      existing = [];
    }
  }

  const profileKey =
    result.inferenceProfileId ||
    result.inferenceProfileArn ||
    result.profileName;
  const results = [
    ...existing.filter(
      (item) =>
        (item.inferenceProfileId ||
          item.inferenceProfileArn ||
          item.profileName) !== profileKey,
    ),
    result,
  ];

  const payload: InferenceProfileTestResultsFile = {
    region,
    updatedAt: new Date().toISOString(),
    count: results.length,
    results,
  };

  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`[inference-profiles] Saved test result to ${filePath}`);
}

const PROFILE_TEST_CACHE_MS = 24 * 60 * 60 * 1000;

function profileMatchesId(
  result: InferenceProfileTestResult,
  profileId: string,
): boolean {
  const needle = profileId.trim();
  if (!needle) return false;
  return (
    result.inferenceProfileId === needle ||
    result.inferenceProfileArn === needle ||
    result.profileName === needle ||
    result.workingTarget?.value === needle
  );
}

export function getCachedWorkingInvokeIdForProfile(
  profileId: string,
): string | null {
  const filePath = inferenceProfileTestResultsFilePath();
  if (!fs.existsSync(filePath)) return null;

  try {
    const data = JSON.parse(
      fs.readFileSync(filePath, "utf8"),
    ) as InferenceProfileTestResultsFile;
    if (data.region && data.region !== bedrockRegion()) return null;

    const match = (data.results ?? []).find(
      (item) =>
        profileMatchesId(item, profileId) && item.overallStatus === "working",
    );
    if (!match?.workingTarget?.value) return null;

    const testedAt = Date.parse(match.testedAt);
    if (Number.isFinite(testedAt) && Date.now() - testedAt > PROFILE_TEST_CACHE_MS) {
      return null;
    }

    return match.workingTarget.value;
  } catch {
    return null;
  }
}

export function bedrockRegion(): string {
  return (
    process.env.AWS_REGION?.trim() ||
    process.env.AWS_DEFAULT_REGION?.trim() ||
    "us-east-1"
  );
}

export function bedrockBearerToken(): string | undefined {
  return process.env.AWS_BEARER_TOKEN_BEDROCK?.trim() || undefined;
}

export function inferenceProfilesEnabled(): boolean {
  return Boolean(bedrockBearerToken());
}

export function createBedrockControlClient(): BedrockClient {
  const region = bedrockRegion();
  const token = bedrockBearerToken();
  if (token) {
    return new BedrockClient({
      region,
      token: { token },
      authSchemePreference: ["httpBearerAuth"],
    });
  }
  return new BedrockClient({ region });
}

export function createBedrockRuntimeClient(): BedrockRuntimeClient {
  const region = bedrockRegion();
  const token = bedrockBearerToken();
  if (token) {
    return new BedrockRuntimeClient({
      region,
      token: { token },
      authSchemePreference: ["httpBearerAuth"],
    });
  }
  return new BedrockRuntimeClient({ region });
}

function getModelIdFromProfile(profile: InferenceProfile): string | undefined {
  if (profile.inferenceProfileId) return profile.inferenceProfileId;

  const arn = profile.inferenceProfileArn || "";
  const marker = ":inference-profile/";
  const appMarker = ":application-inference-profile/";

  if (arn.includes(marker)) return arn.split(marker)[1];
  if (arn.includes(appMarker)) return arn.split(appMarker)[1];

  return profile.inferenceProfileName;
}

export function getFoundationModelId(profile: InferenceProfile): string | null {
  const region = bedrockRegion();
  const models = profile.models || [];
  const regionalModel = models.find((item) =>
    item.modelArn?.includes(`:bedrock:${region}:`),
  );
  const modelArn = regionalModel?.modelArn || models[0]?.modelArn;
  if (!modelArn) return null;

  const marker = ":foundation-model/";
  if (modelArn.includes(marker)) return modelArn.split(marker)[1];

  return null;
}

export function getProfileOptionId(profile: InferenceProfile): string {
  return (
    profile.inferenceProfileId?.trim() ||
    profile.inferenceProfileArn?.trim() ||
    getModelIdFromProfile(profile)?.trim() ||
    profile.inferenceProfileName?.trim() ||
    ""
  );
}

export function getProfileTestTargets(profile: InferenceProfile): ProfileTestTarget[] {
  const targets: ProfileTestTarget[] = [];
  const foundationModelId = getFoundationModelId(profile);
  const inferenceProfileId =
    profile.inferenceProfileId || profile.modelId || getModelIdFromProfile(profile);
  const inferenceProfileArn = profile.inferenceProfileArn;

  if (inferenceProfileId) {
    targets.push({ identifierType: "inferenceProfileId", value: inferenceProfileId });
  }
  if (inferenceProfileArn) {
    targets.push({ identifierType: "inferenceProfileArn", value: inferenceProfileArn });
  }
  if (foundationModelId) {
    targets.push({ identifierType: "model", value: foundationModelId });
  }

  return targets;
}

export async function fetchAllInferenceProfiles(
  forceRefresh = false,
): Promise<InferenceProfile[]> {
  const now = Date.now();
  if (
    !forceRefresh &&
    cachedProfiles &&
    now - cachedProfilesAt < PROFILE_CACHE_MS
  ) {
    return cachedProfiles;
  }

  try {
    const client = createBedrockControlClient();
    const profiles: InferenceProfile[] = [];
    const types = ["SYSTEM_DEFINED", "APPLICATION"] as const;

    for (const typeEquals of types) {
      let nextToken: string | undefined;

      do {
        const response = await client.send(
          new ListInferenceProfilesCommand({
            typeEquals,
            maxResults: 100,
            nextToken,
          }),
        );

        const summaries = response.inferenceProfileSummaries || [];
        for (const profile of summaries) {
          profiles.push({
            ...profile,
            profileType: typeEquals,
            modelId: getModelIdFromProfile(profile),
          });
        }

        nextToken = response.nextToken;
      } while (nextToken);
    }

    profiles.sort((a, b) =>
      (a.inferenceProfileName || a.modelId || "").localeCompare(
        b.inferenceProfileName || b.modelId || "",
        undefined,
        { sensitivity: "base" },
      ),
    );

    saveInferenceProfilesToFile(profiles);
    cachedProfiles = profiles;
    cachedProfilesAt = now;
    return profiles;
  } catch (err) {
    console.error("[inference-profiles] AWS fetch failed:", err);
    const fromFile = loadInferenceProfilesFromFile();
    if (fromFile?.length) {
      cachedProfiles = fromFile;
      cachedProfilesAt = now;
      return fromFile;
    }
    throw err;
  }
}

export function findInferenceProfileById(
  profileId: string,
  profiles?: InferenceProfile[],
): InferenceProfile | undefined {
  const needle = profileId.trim();
  if (!needle) return undefined;

  const list = profiles ?? cachedProfiles ?? [];
  return list.find((profile) => {
    const optionId = getProfileOptionId(profile);
    if (optionId === needle) return true;
    if (profile.inferenceProfileId === needle) return true;
    if (profile.inferenceProfileArn === needle) return true;
    const foundation = getFoundationModelId(profile);
    if (foundation === needle) return true;
    return false;
  });
}

export function findProfileForActiveModel(
  activeModelId: string,
  profiles: InferenceProfile[],
): InferenceProfile | undefined {
  const needle = activeModelId.trim();
  if (!needle) return undefined;

  return profiles.find((profile) => {
    if (getProfileOptionId(profile) === needle) return true;
    if (profile.inferenceProfileId === needle) return true;
    if (profile.inferenceProfileArn === needle) return true;
    const foundation = getFoundationModelId(profile);
    if (foundation === needle) return true;
    return false;
  });
}

async function testModelTarget(
  runtimeClient: BedrockRuntimeClient,
  target: ProfileTestTarget,
  prompt: string,
): Promise<ProfileTargetTestResult> {
  const startedAt = Date.now();
  const { identifierType, value } = target;

  try {
    const response = await runtimeClient.send(
      new ConverseCommand({
        modelId: value,
        messages: [
          {
            role: "user",
            content: [{ text: prompt }],
          },
        ],
        inferenceConfig: {
          maxTokens: 256,
          temperature: 0.7,
        },
      }),
      { abortSignal: AbortSignal.timeout(45_000) },
    );

    const reply =
      response.output?.message?.content
        ?.map((item) => ("text" in item ? item.text : undefined))
        .filter(Boolean)
        .join("\n") || "";

    if (!reply.trim()) {
      return {
        status: "not working",
        identifierType,
        value,
        prompt,
        latencyMs: Date.now() - startedAt,
        error: "Model responded without text output.",
      };
    }

    return {
      status: "working",
      identifierType,
      value,
      prompt,
      reply: reply.trim(),
      latencyMs: Date.now() - startedAt,
      stopReason: response.stopReason,
    };
  } catch (error) {
    return {
      status: "not working",
      identifierType,
      value,
      prompt,
      latencyMs: Date.now() - startedAt,
      error: formatBedrockTestError(error),
      errorName: error instanceof Error ? error.name : undefined,
    };
  }
}

export async function testInferenceProfile(
  profile: InferenceProfile,
  prompt: string,
): Promise<InferenceProfileTestResult> {
  const runtimeClient = createBedrockRuntimeClient();
  const targets = getProfileTestTargets(profile);
  const tests: ProfileTargetTestResult[] = [];

  for (const target of targets) {
    const result = await testModelTarget(runtimeClient, target, prompt);
    tests.push(result);
    if (result.status === "working") break;
  }

  const workingTest = tests.find((item) => item.status === "working");

  const result: InferenceProfileTestResult = {
    profileName: profile.inferenceProfileName || profile.modelId || "Unknown profile",
    profileType: profile.profileType,
    inferenceProfileId: profile.inferenceProfileId,
    inferenceProfileArn: profile.inferenceProfileArn,
    foundationModelId: getFoundationModelId(profile),
    prompt,
    testedAt: new Date().toISOString(),
    tests,
    overallStatus: workingTest ? "working" : "not working",
    workingTarget: workingTest
      ? { identifierType: workingTest.identifierType, value: workingTest.value }
      : undefined,
    workingReply: workingTest?.reply,
    summary: {
      working: tests.filter((item) => item.status === "working").length,
      notWorking: tests.filter((item) => item.status === "not working").length,
    },
  };

  saveProfileTestResultToFile(result);
  return result;
}

export async function testInferenceProfileById(
  profileId: string,
  prompt: string,
): Promise<InferenceProfileTestResult | null> {
  const profiles = await fetchAllInferenceProfiles();
  const profile = findInferenceProfileById(profileId, profiles);
  if (!profile) return null;
  return testInferenceProfile(profile, prompt);
}
