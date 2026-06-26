import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_BEDROCK_MODEL,
  normalizeBedrockModelAlias,
  resolveBedrockInvokeModelId,
} from "./bedrockModelId.js";
import { resolveBedrockModelId as resolveFromCatalog } from "../config/modelsCatalog.js";

describe("normalizeBedrockModelAlias", () => {
  it("uses Claude 3 Sonnet 200k when env is empty", () => {
    assert.equal(normalizeBedrockModelAlias(""), DEFAULT_BEDROCK_MODEL);
  });

  it("passes through configured sonnet 200k ids", () => {
    assert.equal(
      normalizeBedrockModelAlias(
        "us.anthropic.claude-3-sonnet-20240229-v1:0:200k",
      ),
      "us.anthropic.claude-3-sonnet-20240229-v1:0:200k",
    );
  });
});

describe("resolveBedrockModelId", () => {
  it("resolves sonnet 200k from catalog", () => {
    const resolved = resolveFromCatalog(
      "us.anthropic.claude-3-sonnet-20240229-v1:0:200k",
    );
    assert.equal(
      resolved,
      "us.anthropic.claude-3-sonnet-20240229-v1:0:200k",
    );
  });
});

describe("resolveBedrockInvokeModelId", () => {
  it("strips context window suffix for invoke", () => {
    assert.equal(
      resolveBedrockInvokeModelId(
        "us.anthropic.claude-3-sonnet-20240229-v1:0:200k",
      ),
      "us.anthropic.claude-3-sonnet-20240229-v1:0",
    );
  });

  it("keeps standard model ids", () => {
    assert.equal(
      resolveBedrockInvokeModelId("anthropic.claude-3-sonnet-20240229-v1:0"),
      "us.anthropic.claude-3-sonnet-20240229-v1:0",
    );
  });
});
