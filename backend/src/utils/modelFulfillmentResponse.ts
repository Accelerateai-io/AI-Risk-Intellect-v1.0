export interface ModelFulfillmentResponse {
  status: "success" | "error";
  fulfillmentText: string;
  fulfillmentMessages: Array<{
    text: { text: string[] };
  }>;
  outputContexts: Array<{
    name: string;
    lifespanCount: number;
    parameters: Record<string, unknown>;
  }>;
  endInteraction: boolean;
}

export function buildModelFulfillmentResponse(input: {
  success: boolean;
  text: string;
  modelId?: string;
  invokeModelId?: string;
  prompt?: string;
  latencyMs?: number;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  sessionId?: string;
}): ModelFulfillmentResponse {
  const sessionId = input.sessionId ?? `llm-model-${Date.now()}`;
  const contextName = `projects/ai-risk-intellect/agent/sessions/${sessionId}/contexts/model_test_result`;

  return {
    status: input.success ? "success" : "error",
    fulfillmentText: input.text,
    fulfillmentMessages: [{ text: { text: [input.text] } }],
    outputContexts: [
      {
        name: contextName,
        lifespanCount: input.success ? 5 : 1,
        parameters: {
          model_id: input.modelId ?? "",
          invoke_model_id: input.invokeModelId ?? "",
          model_working: input.success,
          ...(input.prompt ? { prompt: input.prompt } : {}),
          ...(input.latencyMs !== undefined ? { latency_ms: input.latencyMs } : {}),
          ...(input.usage ? { usage: input.usage } : {}),
        },
      },
    ],
    endInteraction: !input.success,
  };
}

export function printModelFulfillmentToTerminal(
  label: string,
  fulfillment: ModelFulfillmentResponse,
): void {
  console.log(`\n[${label}]\n${JSON.stringify(fulfillment, null, 2)}\n`);
}
