import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_BEDROCK_MODEL,
  assertModelRegionCompatible,
  bedrockProfilePrefix,
  defaultBedrockModel,
  normalizeBedrockModelAlias,
  resolveBedrockInvokeModelId,
  stripUsModelPrefix,
  withUsModelPrefix,
} from "./bedrockModelId.js";
import { resolveBedrockModelId as resolveFromCatalog } from "../config/modelsCatalog.js";

/** Run `fn` with the given region/model env, restoring the prior values after. */
function withEnv(
  env: Record<string, string | undefined>,
  fn: () => void,
): void {
  const keys = [
    "BEDROCK_PROFILE_PREFIX",
    "AWS_REGION",
    "AWS_DEFAULT_REGION",
    "BEDROCK_DEFAULT_MODEL",
    "BEDROCK_ENFORCE_REGION",
  ];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined) process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

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

// TC-33: inference-profile prefix follows the configured region (BUG-12).
describe("bedrockProfilePrefix", () => {
  it("defaults to us. when nothing is configured", () => {
    withEnv({}, () => {
      assert.equal(bedrockProfilePrefix(), "us.");
      assert.equal(
        withUsModelPrefix("anthropic.claude-x-v1:0"),
        "us.anthropic.claude-x-v1:0",
      );
    });
  });

  it("uses the explicit prefix env over the region", () => {
    withEnv({ BEDROCK_PROFILE_PREFIX: "eu", AWS_REGION: "us-east-1" }, () => {
      assert.equal(bedrockProfilePrefix(), "eu.");
      assert.equal(
        withUsModelPrefix("anthropic.claude-x-v1:0"),
        "eu.anthropic.claude-x-v1:0",
      );
    });
  });

  it("derives eu. and apac. from AWS_REGION", () => {
    withEnv({ AWS_REGION: "eu-west-1" }, () => {
      assert.equal(bedrockProfilePrefix(), "eu.");
      assert.equal(
        resolveBedrockInvokeModelId("anthropic.claude-x-v1:0:200k"),
        "eu.anthropic.claude-x-v1:0",
      );
    });
    withEnv({ AWS_REGION: "ap-southeast-2" }, () => {
      assert.equal(bedrockProfilePrefix(), "apac.");
    });
  });

  it("falls back to us. for an unknown region", () => {
    withEnv({ AWS_REGION: "sa-east-1" }, () => {
      assert.equal(bedrockProfilePrefix(), "us.");
    });
  });

  it("does not double-prefix an already-prefixed id", () => {
    withEnv({ AWS_REGION: "eu-west-1" }, () => {
      assert.equal(
        withUsModelPrefix("apac.anthropic.claude-x-v1:0"),
        "apac.anthropic.claude-x-v1:0",
      );
    });
  });

  it("strips any region profile prefix", () => {
    assert.equal(
      stripUsModelPrefix("eu.anthropic.claude-x-v1:0"),
      "anthropic.claude-x-v1:0",
    );
    assert.equal(
      stripUsModelPrefix("apac.anthropic.claude-x-v1:0"),
      "anthropic.claude-x-v1:0",
    );
  });
});

// TC-35: the default model is env-driven, not a hard-coded retired id (BUG-13).
describe("defaultBedrockModel", () => {
  it("reads BEDROCK_DEFAULT_MODEL when set", () => {
    withEnv(
      { BEDROCK_DEFAULT_MODEL: "us.anthropic.claude-haiku-4-5-20251001-v1:0" },
      () => {
        assert.equal(
          defaultBedrockModel(),
          "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        );
        assert.ok(!defaultBedrockModel().includes("claude-3-sonnet"));
      },
    );
  });

  it("keeps the legacy default when unset (behaviour preserved)", () => {
    withEnv({}, () => {
      assert.equal(
        defaultBedrockModel(),
        "us.anthropic.claude-3-sonnet-20240229-v1:0:200k",
      );
    });
  });
});

// TC-34: an EU deployment never routes to a US-only model (opt-in) (BUG-12).
describe("assertModelRegionCompatible", () => {
  it("is off by default — a us.* model on an EU region does not throw", () => {
    // Prod may run an EU region with a saved us.* model; a deploy must not halt.
    withEnv({ AWS_REGION: "eu-west-1" }, () => {
      assert.equal(
        assertModelRegionCompatible("us.deepseek.r1-v1:0"),
        "us.deepseek.r1-v1:0",
      );
      assert.equal(
        resolveBedrockInvokeModelId("us.deepseek.r1-v1:0"),
        "us.deepseek.r1-v1:0",
      );
    });
  });

  it("throws on a mismatch when enforcement is on", () => {
    withEnv(
      { BEDROCK_ENFORCE_REGION: "true", AWS_REGION: "eu-west-1" },
      () => {
        assert.throws(
          () => assertModelRegionCompatible("us.deepseek.r1-v1:0"),
          /eu\.[\s\S]*us\.deepseek\.r1-v1:0/,
        );
      },
    );
  });

  it("throws on the reverse mismatch (eu model, us region)", () => {
    withEnv(
      { BEDROCK_ENFORCE_REGION: "1", BEDROCK_PROFILE_PREFIX: "us" },
      () => {
        assert.throws(() =>
          assertModelRegionCompatible("eu.anthropic.claude-x-v1:0"),
        );
      },
    );
  });

  it("allows a matching region when enforcement is on", () => {
    withEnv(
      { BEDROCK_ENFORCE_REGION: "true", AWS_REGION: "eu-west-1" },
      () => {
        assert.equal(
          assertModelRegionCompatible("eu.anthropic.claude-x-v1:0"),
          "eu.anthropic.claude-x-v1:0",
        );
      },
    );
  });

  it("allows an unprefixed or global model when enforcement is on", () => {
    withEnv(
      { BEDROCK_ENFORCE_REGION: "true", AWS_REGION: "eu-west-1" },
      () => {
        assert.equal(
          assertModelRegionCompatible("anthropic.claude-x-v1:0"),
          "anthropic.claude-x-v1:0",
        );
        assert.equal(
          assertModelRegionCompatible("global.anthropic.claude-x-v1:0"),
          "global.anthropic.claude-x-v1:0",
        );
      },
    );
  });
});
