type JobSource = "manual" | "rss" | "api" | "etl_reports";

/**
 * Legacy ingest pipeline selector. All job sources now share the same rules;
 * kept for worker imports that still call this helper.
 */
export function resolveIngestSource(_source: JobSource): "manual" | "rss" {
  return "manual";
}

export type { JobSource };
