import { authFetch } from "./authFetch";

type ApiErrorBody = {
  error?: { message?: string };
  message?: string;
};

function errorMessage(data: ApiErrorBody, fallback: string): string {
  return data.error?.message ?? data.message ?? fallback;
}

function exportFileNameFallback(prefix: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const monthName = now.toLocaleString("en-US", { month: "short" });
  return `${prefix}-${now.getFullYear()}-${monthName}-${pad(now.getDate())}.xlsx`;
}

function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim());
    } catch {
      return utf8Match[1].trim();
    }
  }
  const quoted = /filename="([^"]+)"/i.exec(header);
  if (quoted?.[1]) return quoted[1].trim();
  const plain = /filename=([^;]+)/i.exec(header);
  return plain?.[1]?.trim().replace(/^"|"$/g, "") ?? null;
}

async function downloadExcelExport(input: {
  path: string;
  fallbackFileName: string;
  errorMessage: string;
}): Promise<{ ok: true; fileName: string } | { ok: false; message: string }> {
  try {
    const res = await authFetch(input.path);

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as ApiErrorBody;
      return {
        ok: false,
        message: errorMessage(data, input.errorMessage),
      };
    }

    const blob = await res.blob();
    const fileName =
      parseContentDispositionFilename(
        res.headers.get("Content-Disposition"),
      ) ?? input.fallbackFileName;

    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);

    return { ok: true, fileName };
  } catch {
    return {
      ok: false,
      message: "Network error while exporting data.",
    };
  }
}

export function exportRisksToExcel(): Promise<
  { ok: true; fileName: string } | { ok: false; message: string }
> {
  return downloadExcelExport({
    path: "/admin/risks/export",
    fallbackFileName: exportFileNameFallback("risks-export"),
    errorMessage: "Could not export risks.",
  });
}

export function exportArticlesToExcel(): Promise<
  { ok: true; fileName: string } | { ok: false; message: string }
> {
  return downloadExcelExport({
    path: "/admin/articles/export",
    fallbackFileName: exportFileNameFallback("articles-export"),
    errorMessage: "Could not export articles.",
  });
}

export function exportReviewToExcel(): Promise<
  { ok: true; fileName: string } | { ok: false; message: string }
> {
  return downloadExcelExport({
    path: "/admin/review/export",
    fallbackFileName: exportFileNameFallback("review-export"),
    errorMessage: "Could not export review queue.",
  });
}
