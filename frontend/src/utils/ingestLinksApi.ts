import { authFetch } from "./authFetch";

export type IngestLinkRow = {
  id: number;
  url: string;
  suggestedName: string | null;
  archived: boolean;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
};

export type IngestLinkItemRow = {
  id: number;
  ingestLinkId: number;
  url: string;
  createdAt: string;
};

type ApiErrorBody = {
  error?: { message?: string };
  message?: string;
};

function errorMessage(data: ApiErrorBody, fallback: string): string {
  return data.error?.message ?? data.message ?? fallback;
}

export async function fetchIngestLinks(): Promise<
  | { ok: true; links: IngestLinkRow[] }
  | { ok: false; message: string }
> {
  try {
    const res = await authFetch("/admin/ingest-links");
    const data = (await res.json().catch(() => ({}))) as ApiErrorBody & {
      links?: IngestLinkRow[];
    };
    if (!res.ok) {
      return {
        ok: false,
        message: errorMessage(data, "Could not load ingest links."),
      };
    }
    return { ok: true, links: data.links ?? [] };
  } catch {
    return { ok: false, message: "Network error while loading ingest links." };
  }
}

export async function enqueueIngestUrl(
  url: string,
  suggestedName?: string,
): Promise<
  | { status: "created"; message: string; link?: IngestLinkRow }
  | { status: "conflict"; message: string }
  | { status: "error"; message: string }
  | { status: "network" }
> {
  const trimmed = url.trim();
  try {
    const res = await authFetch("/admin/enqueue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: trimmed,
        suggestedName: suggestedName?.trim() || undefined,
      }),
    });

    const data = (await res.json().catch(() => ({}))) as ApiErrorBody & {
      link?: IngestLinkRow;
    };

    if (res.status === 201) {
      return {
        status: "created",
        message:
          data.message ??
          "Feed URL saved. Use Extract to parse item links from the XML feed.",
        link: data.link,
      };
    }

    if (res.status === 409) {
      return {
        status: "conflict",
        message: data.error?.message ?? "This URL is already present.",
      };
    }

    return {
      status: "error",
      message:
        data.error?.message ?? "Could not add this URL. Please try again.",
    };
  } catch {
    return { status: "network" };
  }
}

export async function updateIngestLink(
  id: number,
  url: string,
  suggestedName?: string,
): Promise<
  | { ok: true; message: string; link: IngestLinkRow }
  | { ok: false; message: string }
> {
  try {
    const res = await authFetch(`/admin/ingest-links/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: url.trim(),
        suggestedName: suggestedName?.trim() || undefined,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as ApiErrorBody & {
      link?: IngestLinkRow;
    };
    if (!res.ok) {
      return {
        ok: false,
        message: errorMessage(data, "Could not update this link."),
      };
    }
    if (!data.link) {
      return { ok: false, message: "Could not update this link." };
    }
    return {
      ok: true,
      message: data.message ?? "Ingest link updated.",
      link: data.link,
    };
  } catch {
    return { ok: false, message: "Network error while updating link." };
  }
}

export async function fetchIngestLinkItems(
  ingestLinkId: number,
): Promise<
  | { ok: true; items: IngestLinkItemRow[] }
  | { ok: false; message: string }
> {
  try {
    const res = await authFetch(`/admin/ingest-links/${ingestLinkId}/items`);
    const data = (await res.json().catch(() => ({}))) as ApiErrorBody & {
      items?: IngestLinkItemRow[];
    };
    if (!res.ok) {
      return {
        ok: false,
        message: errorMessage(data, "Could not load feed item links."),
      };
    }
    return { ok: true, items: data.items ?? [] };
  } catch {
    return {
      ok: false,
      message: "Network error while loading feed item links.",
    };
  }
}

export async function extractIngestLink(
  id: number,
): Promise<
  | { ok: true; message: string; link?: IngestLinkRow }
  | { ok: false; message: string }
> {
  try {
    const res = await authFetch(`/admin/ingest-links/${id}/extract`, {
      method: "POST",
    });
    const data = (await res.json().catch(() => ({}))) as ApiErrorBody & {
      link?: IngestLinkRow;
    };
    if (!res.ok) {
      return {
        ok: false,
        message: errorMessage(data, "Could not extract links from this feed."),
      };
    }
    return {
      ok: true,
      message: data.message ?? "Feed links extracted.",
      link: data.link,
    };
  } catch {
    return {
      ok: false,
      message: "Network error while extracting feed links.",
    };
  }
}

export async function restoreIngestLink(
  id: number,
): Promise<
  | { ok: true; message: string; link: IngestLinkRow }
  | { ok: false; message: string }
> {
  try {
    const res = await authFetch(`/admin/ingest-links/${id}/restore`, {
      method: "POST",
    });
    const data = (await res.json().catch(() => ({}))) as ApiErrorBody & {
      link?: IngestLinkRow;
    };
    if (!res.ok) {
      return {
        ok: false,
        message: errorMessage(data, "Could not restore this link."),
      };
    }
    if (!data.link) {
      return { ok: false, message: "Could not restore this link." };
    }
    return {
      ok: true,
      message: data.message ?? "Ingest link restored.",
      link: data.link,
    };
  } catch {
    return { ok: false, message: "Network error while restoring link." };
  }
}

export async function archiveIngestLink(
  id: number,
): Promise<
  | { ok: true; message: string; link: IngestLinkRow }
  | { ok: false; message: string }
> {
  try {
    const res = await authFetch(`/admin/ingest-links/${id}/archive`, {
      method: "POST",
    });
    const data = (await res.json().catch(() => ({}))) as ApiErrorBody & {
      link?: IngestLinkRow;
    };
    if (!res.ok) {
      return {
        ok: false,
        message: errorMessage(data, "Could not archive this link."),
      };
    }
    if (!data.link) {
      return { ok: false, message: "Could not archive this link." };
    }
    return {
      ok: true,
      message: data.message ?? "Ingest link archived.",
      link: data.link,
    };
  } catch {
    return { ok: false, message: "Network error while archiving link." };
  }
}

export function canExportIngestLink(_row: IngestLinkRow): boolean {
  return true;
}

function parseContentDispositionFilename(
  header: string | null,
): string | null {
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

export async function exportIngestLinkItems(
  ingestLinkId: number,
): Promise<{ ok: true; fileName: string } | { ok: false; message: string }> {
  try {
    const res = await authFetch(`/admin/ingest-links/${ingestLinkId}/export`);

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as ApiErrorBody;
      return {
        ok: false,
        message: errorMessage(data, "Could not export feed URLs."),
      };
    }

    const blob = await res.blob();
    const fileName =
      parseContentDispositionFilename(
        res.headers.get("Content-Disposition"),
      ) ?? `feed-urls-${ingestLinkId}.xlsx`;

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
      message: "Network error while exporting feed URLs.",
    };
  }
}
