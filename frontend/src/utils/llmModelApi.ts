import { authFetch } from "./authFetch";

export type LlmModelOption = {
  id: string;
  label: string;
  backend: string;
};

export type LlmModelConfig = {
  modelId: string;
  modelLabel: string;
  backend: string;
  options: LlmModelOption[];
  requiresPythonRestart?: boolean;
  pythonSynced?: boolean;
};

export type LlmModelValidationResponse = {
  success: boolean;
  message: string;
  modelId?: string;
  response?: string;
  fulfillmentResponse?: {
    status: "success" | "error";
    fulfillmentText: string;
    fulfillmentMessages: Array<{ text: { text: string[] } }>;
    outputContexts: Array<{
      name: string;
      lifespanCount: number;
      parameters: Record<string, unknown>;
    }>;
    endInteraction: boolean;
  };
};

type ApiErrorBody = {
  error?: { message?: string };
  message?: string;
};

function errorMessage(data: ApiErrorBody, fallback: string): string {
  return data.error?.message ?? data.message ?? fallback;
}

export async function fetchLlmModelConfig(): Promise<
  | { ok: true; config: LlmModelConfig }
  | { ok: false; message: string }
> {
  try {
    const res = await authFetch("/admin/services/llm-model");
    const data = (await res.json().catch(() => ({}))) as ApiErrorBody &
      LlmModelConfig;

    if (!res.ok) {
      return {
        ok: false,
        message: errorMessage(data, "Could not load LLM models."),
      };
    }

    return { ok: true, config: data };
  } catch {
    return { ok: false, message: "Network error while loading LLM models." };
  }
}

export async function testLlmModel(
  modelId: string,
): Promise<
  | { ok: true; result: LlmModelValidationResponse }
  | { ok: false; message: string }
> {
  try {
    const res = await authFetch("/admin/services/llm-model/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId }),
    });
    const data = (await res.json().catch(() => ({}))) as ApiErrorBody &
      LlmModelValidationResponse;

    if (!res.ok) {
      return {
        ok: false,
        message: data.message ?? errorMessage(data, "This model is not supported"),
      };
    }

    return {
      ok: true,
      result: {
        success: data.success,
        message: data.message,
        modelId: data.modelId,
        response: data.response,
        fulfillmentResponse: data.fulfillmentResponse,
      },
    };
  } catch {
    return {
      ok: false,
      message: "Network error while validating the model.",
    };
  }
}

export async function applyLlmModel(
  modelId: string,
): Promise<
  | { ok: true; config: LlmModelConfig; message: string }
  | { ok: false; message: string }
> {
  try {
    const res = await authFetch("/admin/services/llm-model", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId }),
    });
    const data = (await res.json().catch(() => ({}))) as ApiErrorBody &
      LlmModelConfig;

    if (!res.ok) {
      return {
        ok: false,
        message: errorMessage(data, "Could not update LLM model."),
      };
    }

    return {
      ok: true,
      config: data,
      message: data.message ?? "LLM model updated.",
    };
  } catch {
    return {
      ok: false,
      message: "Network error while updating LLM model.",
    };
  }
}
