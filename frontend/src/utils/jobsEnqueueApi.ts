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
