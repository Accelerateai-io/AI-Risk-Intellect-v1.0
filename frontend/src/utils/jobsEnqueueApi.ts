import { authFetch } from "./authFetch";

type ApiErrorBody = {
  error?: { message?: string };
  message?: string;
};

function errorMessage(data: ApiErrorBody, fallback: string): string {
  return data.error?.message ?? data.message ?? fallback;
}

export async function enqueueJobUrl(url: string): Promise<
  | { status: "created"; message: string }
  | { status: "conflict"; message: string }
  | { status: "error"; message: string }
  | { status: "network" }
> {
  const trimmed = url.trim();
  try {
    const res = await authFetch("/admin/jobs/enqueue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: trimmed }),
    });
    const data = (await res.json().catch(() => ({}))) as ApiErrorBody;

    if (res.status === 201) {
      return {
        status: "created",
        message: data.message ?? "URL enqueued for ingestion.",
      };
    }

    if (res.status === 409) {
      return {
        status: "conflict",
        message: errorMessage(data, "A job for this URL is already queued."),
      };
    }

    return {
      status: "error",
      message: errorMessage(data, "Could not enqueue this URL. Please try again."),
    };
  } catch {
    return { status: "network" };
  }
}

export async function executeJob(input: {
  jobId: number;
  modelName?: string;
  modelLabel?: string;
}): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  try {
    const body: { modelName?: string; modelLabel?: string } = {};
    if (input.modelName?.trim()) body.modelName = input.modelName.trim();
    if (input.modelLabel?.trim()) body.modelLabel = input.modelLabel.trim();

    const res = await authFetch(`/jobs/${input.jobId}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as ApiErrorBody;

    if (!res.ok) {
      return {
        ok: false,
        message: errorMessage(data, "Could not execute this URL."),
      };
    }

    return {
      ok: true,
      message: data.message ?? "URL requeued. The worker will run it.",
    };
  } catch {
    return { ok: false, message: "Network error while executing this URL." };
  }
}
