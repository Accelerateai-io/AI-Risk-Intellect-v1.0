export type ReportRefLike = {
  id: number;
  uploadId: number;
};

/** Combine fully selected uploads with extra URLs, minus explicit exclusions. */
export function mergeReportRefSelection<T extends ReportRefLike>(input: {
  uploadRefs: T[];
  reportRefs: T[];
  excludeReportIds?: number[];
}): T[] {
  const excluded = new Set(input.excludeReportIds ?? []);
  const byId = new Map<number, T>();

  for (const ref of input.uploadRefs) {
    if (!excluded.has(ref.id)) byId.set(ref.id, ref);
  }
  for (const ref of input.reportRefs) {
    if (!excluded.has(ref.id)) byId.set(ref.id, ref);
  }

  return [...byId.values()];
}
