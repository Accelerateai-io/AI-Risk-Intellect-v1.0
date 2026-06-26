/**
 * Bedrock cross-region inference profile IDs use a `us.` prefix
 * (e.g. us.anthropic.claude-haiku-4-5-20251001-v1:0).
 */

/** Default / fallback Bedrock model — keep in sync with python/app/env_bootstrap.py */
export const DEFAULT_BEDROCK_MODEL =
  "us.anthropic.claude-3-sonnet-20240229-v1:0:200k";

const BEDROCK_MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9.:-]*$/i;

/** Pass through configured model id; use default when env is empty. */
export function normalizeBedrockModelAlias(modelId: string): string {
  const trimmed = modelId.trim();
  if (!trimmed) return DEFAULT_BEDROCK_MODEL;
  return trimmed;
}

export function stripUsModelPrefix(modelId: string): string {
  const trimmed = modelId.trim();
  if (trimmed.toLowerCase().startsWith("us.")) {
    return trimmed.slice(3);
  }
  return trimmed;
}

/** True for provider-style Bedrock ids (anthropic.*, meta.*, …), not short aliases. */
export function isBedrockProviderModelId(modelId: string): boolean {
  const trimmed = modelId.trim();
  if (!trimmed || trimmed.includes("/")) return false;
  return BEDROCK_MODEL_ID_PATTERN.test(trimmed);
}

export function withUsModelPrefix(modelId: string): string {
  const trimmed = modelId.trim();
  if (!trimmed) return trimmed;
  if (trimmed.toLowerCase().startsWith("us.")) return trimmed;
  if (isBedrockProviderModelId(trimmed)) {
    return `us.${trimmed}`;
  }
  return trimmed;
}

/** Catalog ids like …:v1:0:200k are not valid for bedrock-runtime invoke. */
const INVOKE_CONTEXT_SUFFIX = /:(?:28|48|200)k$/i;

export function resolveBedrockInvokeModelId(modelId: string): string {
  const trimmed = withUsModelPrefix(modelId.trim());
  if (!trimmed) return trimmed;
  return trimmed.replace(INVOKE_CONTEXT_SUFFIX, "");
}
