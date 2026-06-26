import type { ParsedEtlRecord } from "../../etl/etlImport.types.js";

const NULL_BYTE_PATTERN = /\0/g;

export function sanitizeOptionalString(
  value: string | null | undefined,
  maxLength?: number,
): string | null {
  if (value == null) return null;

  const cleaned = value.replace(NULL_BYTE_PATTERN, "").trim();
  if (!cleaned || cleaned.toLowerCase() === "nan") return null;

  if (maxLength != null && cleaned.length > maxLength) {
    return cleaned.slice(0, maxLength);
  }

  return cleaned;
}

export function sanitizeRequiredString(
  value: string,
  maxLength?: number,
): string {
  const cleaned = sanitizeOptionalString(value, maxLength);
  if (!cleaned) {
    throw new Error("Required string field is empty after sanitization.");
  }
  return cleaned;
}

export function normalizeTags(
  value: ParsedEtlRecord["tags"] | string | undefined,
): string[] | null {
  if (value == null) return null;

  if (typeof value === "string") {
    const trimmed = sanitizeOptionalString(value);
    if (!trimmed || trimmed === "[]") return null;

    const inner =
      trimmed.startsWith("[") && trimmed.endsWith("]")
        ? trimmed.slice(1, -1)
        : trimmed;

    const tags = inner
      .split(/[,;|]/)
      .map((part) => sanitizeOptionalString(part))
      .filter((part): part is string => Boolean(part));

    return tags.length ? tags : null;
  }

  if (!Array.isArray(value)) return null;

  const tags = value
    .map((tag) => sanitizeOptionalString(String(tag)))
    .filter((tag): tag is string => Boolean(tag));

  return tags.length ? tags : null;
}

export function mapRecordToRow(record: ParsedEtlRecord) {
  return {
    objectId: sanitizeRequiredString(record.id, 24),
    datePublished: parseOptionalDate(record.date_published),
    reportNumber: sanitizeOptionalString(record.report_number ?? null, 128),
    sourceDomain: sanitizeOptionalString(record.source_domain ?? null, 512),
    description: sanitizeOptionalString(record.description ?? null),
    title: sanitizeRequiredString(record.title),
    url: sanitizeRequiredString(record.url, 2048),
    tags: normalizeTags(record.tags),
    createdDate: parseOptionalDate(record.created_date),
  };
}

function parseOptionalDate(value?: string | null): Date | null {
  if (!value) return null;
  const cleaned = sanitizeOptionalString(value);
  if (!cleaned) return null;
  const parsed = new Date(cleaned);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export function formatDbError(err: unknown): string {
  if (!err || typeof err !== "object") return String(err);

  const nested = err as {
    message?: string;
    cause?: { message?: string; code?: string };
  };

  const pgMessage = nested.cause?.message ?? nested.message ?? String(err);
  const pgCode = nested.cause?.code ? ` [${nested.cause.code}]` : "";
  return `${pgMessage}${pgCode}`;
}
