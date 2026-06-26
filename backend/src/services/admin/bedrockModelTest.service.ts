import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import {
  getCatalogModel,
  resolveBedrockModelId,
} from "../../config/modelsCatalog.js";
import { resolveBedrockInvokeModelId } from "../../utils/bedrockModelId.js";
import {
  buildModelFulfillmentResponse,
  printModelFulfillmentToTerminal,
  type ModelFulfillmentResponse,
} from "../../utils/modelFulfillmentResponse.js";

const TEST_PROMPT = "Reply with the single word OK.";
const TEST_TIMEOUT_MS = 45_000;
const INVOKE_TIMEOUT_MS = 120_000;
const DEFAULT_INVOKE_MAX_TOKENS = 512;

function bedrockRegion(): string {
  return (
    process.env.AWS_REGION?.trim() ||
    process.env.AWS_DEFAULT_REGION?.trim() ||
    "us-east-1"
  );
}

function isTextGenerationModel(modelId: string): boolean {
  const catalog = getCatalogModel(modelId);
  if (!catalog) return false;

  const outputs = catalog.outputModalities.map((m) => m.toUpperCase());
  const inputs = catalog.inputModalities.map((m) => m.toUpperCase());
  return outputs.includes("TEXT") && inputs.includes("TEXT");
}

export function formatBedrockTestError(err: unknown): string {
  const awsErr = err as {
    name?: string;
    message?: string;
    Code?: string;
    $metadata?: { httpStatusCode?: number };
  };

  const code = awsErr.name ?? awsErr.Code ?? "";
  const detail = awsErr.message?.trim() ?? "";

  if (code === "AccessDeniedException") {
    return "Model is not enabled in your AWS account.";
  }
  if (code === "ValidationException") {
    return detail || "This model is not supported for inference.";
  }
  if (code === "ResourceNotFoundException") {
    return "Model was not found in Bedrock.";
  }
  if (code === "ThrottlingException" || code === "TooManyRequestsException") {
    return "Bedrock rate limit reached. Try again in a moment.";
  }
  if (code === "TimeoutError" || awsErr.name === "AbortError") {
    return "Model test timed out.";
  }
  if (detail) return detail;
  return "Model test failed.";
}

export type BedrockModelInvokeResult = {
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

export async function invokeBedrockModelPrompt(input: {
  modelId: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<BedrockModelInvokeResult> {
  const trimmed = input.modelId.trim();
  const prompt = input.prompt.trim();

  if (!trimmed) {
    return { success: false, message: "This model is not supported" };
  }
  if (!prompt) {
    return { success: false, message: "Prompt is required." };
  }
  if (!isTextGenerationModel(trimmed)) {
    return { success: false, message: "This model is not supported" };
  }

  const invokeId = resolveBedrockInvokeModelId(resolveBedrockModelId(trimmed));
  const client = new BedrockRuntimeClient({ region: bedrockRegion() });
  const maxTokens = input.maxTokens ?? DEFAULT_INVOKE_MAX_TOKENS;
  const temperature = input.temperature ?? 0.7;
  const startedAt = Date.now();

  try {
    const response = await client.send(
      new ConverseCommand({
        modelId: invokeId,
        messages: [
          {
            role: "user",
            content: [{ text: prompt }],
          },
        ],
        inferenceConfig: {
          maxTokens,
          temperature,
        },
      }),
      { abortSignal: AbortSignal.timeout(INVOKE_TIMEOUT_MS) },
    );

    const textBlock = response.output?.message?.content?.find(
      (block) => "text" in block && typeof block.text === "string",
    );
    const responseText =
      textBlock && "text" in textBlock ? textBlock.text?.trim() ?? "" : "";

    if (!responseText) {
      const fulfillmentResponse = buildModelFulfillmentResponse({
        success: false,
        text: "Model responded without text output.",
        modelId: trimmed,
        invokeModelId: invokeId,
        prompt,
        latencyMs: Date.now() - startedAt,
      });
      printModelFulfillmentToTerminal("LLM model invoke", fulfillmentResponse);
      return {
        success: false,
        message: "Model responded without text output.",
        modelId: trimmed,
        invokeModelId: invokeId,
        prompt,
        latencyMs: Date.now() - startedAt,
        fulfillmentResponse,
      };
    }

    const usage = {
      inputTokens: response.usage?.inputTokens,
      outputTokens: response.usage?.outputTokens,
      totalTokens: response.usage?.totalTokens,
    };
    const latencyMs = Date.now() - startedAt;
    const fulfillmentResponse = buildModelFulfillmentResponse({
      success: true,
      text: responseText,
      modelId: trimmed,
      invokeModelId: invokeId,
      prompt,
      latencyMs,
      usage,
    });
    printModelFulfillmentToTerminal("LLM model invoke", fulfillmentResponse);

    return {
      success: true,
      message: "Model response received.",
      modelId: trimmed,
      invokeModelId: invokeId,
      prompt,
      response: responseText,
      usage,
      latencyMs,
      fulfillmentResponse,
    };
  } catch (err) {
    const message = formatBedrockTestError(err);
    const latencyMs = Date.now() - startedAt;
    const fulfillmentResponse = buildModelFulfillmentResponse({
      success: false,
      text: message,
      modelId: trimmed,
      invokeModelId: invokeId,
      prompt,
      latencyMs,
    });
    printModelFulfillmentToTerminal("LLM model invoke", fulfillmentResponse);
    return {
      success: false,
      message,
      modelId: trimmed,
      invokeModelId: invokeId,
      prompt,
      latencyMs,
      fulfillmentResponse,
    };
  }
}

export async function invokeBedrockModelTest(modelId: string): Promise<{
  success: boolean;
  message: string;
  modelId?: string;
  invokeModelId?: string;
  response?: string;
  latencyMs?: number;
  fulfillmentResponse?: ModelFulfillmentResponse;
}> {
  const trimmed = modelId.trim();
  if (!trimmed) {
    return { success: false, message: "This model is not supported" };
  }

  if (!isTextGenerationModel(trimmed)) {
    return { success: false, message: "This model is not supported" };
  }

  const invokeId = resolveBedrockInvokeModelId(resolveBedrockModelId(trimmed));
  const client = new BedrockRuntimeClient({ region: bedrockRegion() });

  try {
    const response = await client.send(
      new ConverseCommand({
        modelId: invokeId,
        messages: [
          {
            role: "user",
            content: [{ text: TEST_PROMPT }],
          },
        ],
        inferenceConfig: {
          maxTokens: 16,
          temperature: 0,
        },
      }),
      { abortSignal: AbortSignal.timeout(TEST_TIMEOUT_MS) },
    );

    const textBlock = response.output?.message?.content?.find(
      (block) => "text" in block && typeof block.text === "string",
    );
    if (!textBlock || !("text" in textBlock) || !textBlock.text?.trim()) {
      const fulfillmentResponse = buildModelFulfillmentResponse({
        success: false,
        text: "Model responded without text output.",
        modelId: trimmed,
        invokeModelId: invokeId,
        prompt: TEST_PROMPT,
      });
      printModelFulfillmentToTerminal("LLM model test", fulfillmentResponse);
      return {
        success: false,
        message: "Model responded without text output.",
        modelId: trimmed,
        invokeModelId: invokeId,
        fulfillmentResponse,
      };
    }

    const responseText = textBlock.text.trim();
    const fulfillmentResponse = buildModelFulfillmentResponse({
      success: true,
      text: responseText,
      modelId: trimmed,
      invokeModelId: invokeId,
      prompt: TEST_PROMPT,
    });
    printModelFulfillmentToTerminal("LLM model test", fulfillmentResponse);

    return {
      success: true,
      message: "Model works",
      modelId: trimmed,
      invokeModelId: invokeId,
      response: responseText,
      fulfillmentResponse,
    };
  } catch (err) {
    const message = formatBedrockTestError(err);
    const fulfillmentResponse = buildModelFulfillmentResponse({
      success: false,
      text: message,
      modelId: trimmed,
      invokeModelId: invokeId,
      prompt: TEST_PROMPT,
    });
    printModelFulfillmentToTerminal("LLM model test", fulfillmentResponse);
    return {
      success: false,
      message,
      modelId: trimmed,
      invokeModelId: invokeId,
      fulfillmentResponse,
    };
  }
}
