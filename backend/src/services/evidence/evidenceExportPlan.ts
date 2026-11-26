/**
 * Decides what the AIRI export writes on each run (spec v1.3, sections 4 and 5).
 * Pure functions: no DB, so every lifecycle rule has a unit test.
 *
 * - record_id is the first row of a supersedes_id chain; the chain's newest row
 *   is the one whose content is exported.
 * - A new version is written only when the content differs from the last
 *   exported version. Nothing is ever re-sent with different content under an
 *   existing version.
 * - A record that was exported and no longer qualifies gets a retraction version.
 */
import type { RiskDto } from "../risks/riskDto.js";
import {
  crossingDecision,
  RETRACTION_REASON_REPROCESSED,
  sameContent,
  toEvidenceRecord,
  toRetraction,
  type EvidenceRecordV1,
} from "./evidenceRecord.js";

export type ChainRow = { id: string; supersedesId: string | null; createdAt: Date };

export type Chain = {
  /** record_id: the first row in the chain. */
  rootId: string;
  /** The newest row, i.e. the one nothing supersedes. */
  latestId: string;
  rowIds: string[];
};

/**
 * Groups rows into supersedes_id chains. A cycle or a dangling supersedes_id
 * (row deleted) is treated as the start of a chain. If a row is superseded by
 * more than one row, the newest one wins.
 */
export function buildChains(rows: ChainRow[]): Chain[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const rootOf = (id: string): string => {
    const seen = new Set<string>();
    let cur = id;
    for (;;) {
      seen.add(cur);
      const parent = byId.get(cur)?.supersedesId;
      if (!parent || !byId.has(parent) || seen.has(parent)) return cur;
      cur = parent;
    }
  };
  const supersededIds = new Set(
    rows.map((r) => r.supersedesId).filter((x): x is string => !!x && byId.has(x)),
  );
  const chains = new Map<string, Chain>();
  for (const r of rows) {
    const root = rootOf(r.id);
    let c = chains.get(root);
    if (!c) {
      c = { rootId: root, latestId: root, rowIds: [] };
      chains.set(root, c);
    }
    c.rowIds.push(r.id);
  }
  for (const c of chains.values()) {
    const heads = c.rowIds.filter((id) => !supersededIds.has(id));
    const pool = heads.length ? heads : c.rowIds;
    pool.sort((a, b) => {
      const d = byId.get(b)!.createdAt.getTime() - byId.get(a)!.createdAt.getTime();
      return d !== 0 ? d : b.localeCompare(a);
    });
    c.latestId = pool[0]!;
  }
  return [...chains.values()];
}

export type LatestRow = {
  dto: RiskDto;
  documentHash: string | null;
  retrievedAt: string | null;
};

export type PlanStep =
  | { kind: "none"; reason: string }
  | { kind: "write"; record: EvidenceRecordV1; reason: string };

/** What to write for one record, given its newest AIRI row and the last exported version. */
export function planRecord(
  recordId: string,
  latest: LatestRow,
  last: EvidenceRecordV1 | null,
  publishedAt: string,
): PlanStep {
  const decision = crossingDecision(latest.dto);
  const version = last ? last.version + 1 : 1;

  if (decision.crosses) {
    const record = toEvidenceRecord(latest.dto, {
      recordId,
      version,
      publishedAt,
      documentHash: latest.documentHash,
      retrievedAt: latest.retrievedAt,
    });
    if (last && sameContent(record, last)) {
      return { kind: "none", reason: "unchanged since the last exported version" };
    }
    return {
      kind: "write",
      record,
      reason: last
        ? last.status === "retracted"
          ? "qualifies again after a retraction"
          : "content changed"
        : decision.reason,
    };
  }

  if (!last) return { kind: "none", reason: `never exported: ${decision.reason}` };
  if (last.status === "retracted") {
    return { kind: "none", reason: "already retracted" };
  }
  const reason =
    latest.dto.id !== last.airi_row_id
      ? RETRACTION_REASON_REPROCESSED
      : decision.reason === "retired"
        ? "retired in AIRI"
        : `no longer meets the bridge criteria (${decision.reason})`;
  return {
    kind: "write",
    record: toRetraction(last, {
      version,
      publishedAt,
      reason,
      decisionReason: latest.dto.assessment?.decisionReason ?? null,
    }),
    reason: `retraction: ${reason}`,
  };
}
