/**
 * Bedrock cross-region inference profile IDs use a region prefix
 * (us./eu./apac./global.), e.g. us.anthropic.claude-haiku-4-5-20251001-v1:0.
 * Mirrors python/app/llm/bedrock_model_id.py + env_bootstrap.py.
 */

// Legacy default kept so behaviour is unchanged when BEDROCK_DEFAULT_MODEL is
// unset. This id is outdated (Claude 3 Sonnet, 2024) — see PR question for Asad.
const LEGACY_DEFAULT_BEDROCK_MODEL =
  "us.anthropic.claude-3-sonnet-20240229-v1:0:200k";

/** Default/fallback Bedrock model, overridable via BEDROCK_DEFAULT_MODEL (BUG-13). */
export function defaultBedrockModel(): string {
  return process.env.BEDROCK_DEFAULT_MODEL?.trim() || LEGACY_DEFAULT_BEDROCK_MODEL;
}

/** Import-time snapshot kept for modules importing the constant directly. */
export const DEFAULT_BEDROCK_MODEL = defaultBedrockModel();

const BEDROCK_MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9.:-]*$/i;

// Known Bedrock cross-region inference profile prefixes.
const PROFILE_PREFIXES = ["us.", "eu.", "apac.", "global."];

// AWS region geo token -> inference profile prefix (without the trailing dot).
const REGION_GEO_TO_PREFIX: Record<string, string> = {
  us: "us",
  eu: "eu",
  ap: "apac",
  global: "global",
};

// Preserve the original single-region behaviour when nothing is configured.
const DEFAULT_PROFILE_PREFIX = "us";

/**
 * Inference-profile prefix ("us.", "eu.", "apac.", "global.") (BUG-12).
 * Resolved from BEDROCK_PROFILE_PREFIX, else derived from AWS_REGION /
 * AWS_DEFAULT_REGION, else "us." so existing deployments are unchanged.
 */
export function bedrockProfilePrefix(): string {
  const explicit = (process.env.BEDROCK_PROFILE_PREFIX ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.+$/, "");
  if (explicit) return `${explicit}.`;
  const region = (
    (process.env.AWS_REGION ?? "").trim() ||
    (process.env.AWS_DEFAULT_REGION ?? "").trim()
  ).toLowerCase();
  const geo = region ? region.split("-")[0] : "";
  return `${REGION_GEO_TO_PREFIX[geo] ?? DEFAULT_PROFILE_PREFIX}.`;
}

function hasProfilePrefix(modelId: string): boolean {
  const low = modelId.toLowerCase();
  return PROFILE_PREFIXES.some((p) => low.startsWith(p));
}

/** Pass through configured model id; use default when env is empty. */
export function normalizeBedrockModelAlias(modelId: string): string {
  const trimmed = modelId.trim();
  if (!trimmed) return defaultBedrockModel();
  return trimmed;
}

/** Strip any region inference-profile prefix (us./eu./apac./global.). */
export function stripUsModelPrefix(modelId: string): string {
  const trimmed = modelId.trim();
  const low = trimmed.toLowerCase();
  for (const prefix of PROFILE_PREFIXES) {
    if (low.startsWith(prefix)) return trimmed.slice(prefix.length);
  }
  return trimmed;
}

/** True for provider-style Bedrock ids (anthropic.*, meta.*, …), not short aliases. */
export function isBedrockProviderModelId(modelId: string): boolean {
  const trimmed = modelId.trim();
  if (!trimmed || trimmed.includes("/")) return false;
  return BEDROCK_MODEL_ID_PATTERN.test(trimmed);
}

/** Apply the region-derived inference-profile prefix (BUG-12). */
export function withUsModelPrefix(modelId: string): string {
  const trimmed = modelId.trim();
  if (!trimmed) return trimmed;
  if (hasProfilePrefix(trimmed)) return trimmed;
  if (isBedrockProviderModelId(trimmed)) {
    return `${bedrockProfilePrefix()}${trimmed}`;
  }
  return trimmed;
}

function enforceRegionEnabled(): boolean {
  const v = (process.env.BEDROCK_ENFORCE_REGION ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * Refuse to route a region-pinned model to a different geography (BUG-12, TC-34).
 *
 * Opt-in via BEDROCK_ENFORCE_REGION=true (default off). When enabled, if the
 * model id carries an explicit region profile prefix (us./eu./apac.) that
 * conflicts with the resolved profile prefix — e.g. resolved "eu." but the id
 * starts with "us." — throw an error naming both. "global." is multi-region and
 * never conflicts. Returns the id unchanged when compatible or enforcement off.
 *
 * Default is off on purpose: prod may legitimately run an EU region with a
 * us.* model id saved (e.g. us.deepseek.r1-v1:0), and enforcing by default
 * would halt extraction on deploy.
 */
export function assertModelRegionCompatible(modelId: string): string {
  const trimmed = modelId.trim();
  if (!trimmed || !enforceRegionEnabled()) return trimmed;
  const resolved = bedrockProfilePrefix();
  const low = trimmed.toLowerCase();
  const modelPrefix = PROFILE_PREFIXES.find((p) => low.startsWith(p));
  if (
    modelPrefix &&
    modelPrefix !== "global." &&
    resolved !== "global." &&
    modelPrefix !== resolved
  ) {
    throw new Error(
      `Bedrock region mismatch: resolved inference-profile prefix is '${resolved}' ` +
        `(from AWS_REGION / BEDROCK_PROFILE_PREFIX) but model id '${trimmed}' targets ` +
        `the '${modelPrefix}' geography. Pick a '${resolved}' model or unset ` +
        `BEDROCK_ENFORCE_REGION to bypass.`,
    );
  }
  return trimmed;
}

/** Catalog ids like …:v1:0:200k are not valid for bedrock-runtime invoke. */
const INVOKE_CONTEXT_SUFFIX = /:(?:28|48|200)k$/i;

export function resolveBedrockInvokeModelId(modelId: string): string {
  assertModelRegionCompatible(modelId);
  const trimmed = withUsModelPrefix(modelId.trim());
  if (!trimmed) return trimmed;
  return trimmed.replace(INVOKE_CONTEXT_SUFFIX, "");
}
