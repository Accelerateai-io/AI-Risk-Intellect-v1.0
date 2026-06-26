export function readApiErrorMessage(body: unknown, fallback: string): string {
  const data = body as {
    message?: string;
    error?: { message?: string };
  };
  return data.error?.message ?? data.message ?? fallback;
}
