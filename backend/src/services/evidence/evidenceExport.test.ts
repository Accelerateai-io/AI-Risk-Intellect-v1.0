import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { RiskDto } from "../risks/riskDto.js";
import { canonicalize, contentHash } from "./canonicalJson.js";
import {
  crossingDecision,
  evidenceKind,
  RETRACTION_REASON_REPROCESSED,
  toEvidenceRecord,
  type EvidenceRecordV1,
} from "./evidenceRecord.js";
import { buildChains, planRecord, type LatestRow } from "./evidenceExportPlan.js";
import { parseCheckpointParam } from "../../controllers/evidence/evidence.controller.js";
import { evidenceExportEnabled, evidenceExportIntervalMs } from "./evidenceExportScheduler.js";

// R-174 from AIRI dev (24 Nov) as the GET /risks/:id DTO, and the record the
// sample file (AIRI_Evidence_Sample_v1.3.zip, checkpoint 1002) holds for it.
const FIXTURE = JSON.parse(
  readFileSync(new URL("./evidenceParity.fixture.json", import.meta.url), "utf8"),
) as { dto: RiskDto; expected: EvidenceRecordV1 & { checkpoint: number } };

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const T0 = "2026-11-24T20:00:00Z";
const T1 = "2026-11-25T20:00:00Z";

function latest(dto: RiskDto = FIXTURE.dto): LatestRow {
  return {
    dto,
    documentHash: FIXTURE.expected.document_hash,
    retrievedAt: FIXTURE.expected.retrieved_at,
  };
}

const NO_REVIEW = { status: null, reviewedBy: null, reviewedByUsername: null, reviewedAt: null, feedback: null, classification: null };

function withAssessment(
  patch: Partial<NonNullable<RiskDto["assessment"]>>,
  extra: Partial<RiskDto> = {},
): RiskDto {
  const dto = clone(FIXTURE.dto);
  dto.humanReview = { ...NO_REVIEW } as RiskDto["humanReview"];
  dto.assessment = { ...dto.assessment!, ...patch };
  return { ...dto, ...extra };
}

test("canonical JSON sorts keys and drops undefined", () => {
  assert.equal(canonicalize({ b: 1, a: [true, null, "x"], c: undefined }), '{"a":[true,null,"x"],"b":1}');
});

test("content_hash matches the sample file", () => {
  const { checkpoint: _c, ...rec } = FIXTURE.expected;
  assert.equal(contentHash(rec), FIXTURE.expected.content_hash);
});

test("live mapping produces exactly the sample record", () => {
  const rec = toEvidenceRecord(FIXTURE.dto, {
    recordId: FIXTURE.expected.record_id,
    version: 1,
    publishedAt: T0,
    documentHash: FIXTURE.expected.document_hash,
    retrievedAt: FIXTURE.expected.retrieved_at,
  });
  const { checkpoint: _c, ...expected } = FIXTURE.expected;
  assert.deepEqual(JSON.parse(JSON.stringify(rec)), expected);
});

test("crossing rules follow spec section 4", () => {
  assert.equal(crossingDecision(withAssessment({ decisionReason: "VERIFIED", publicationStatus: "published" })).crosses, true);
  assert.equal(crossingDecision(withAssessment({ decisionReason: "CATALOG_SUGGESTED", publicationStatus: "published" })).crosses, true);
  for (const r of ["REPAIRED", "PUBLISHED_LABELLED", "PUBLISHED_WITH_NOTES"]) {
    assert.equal(crossingDecision(withAssessment({ decisionReason: r, publicationStatus: "published" })).crosses, false, r);
  }
  assert.equal(crossingDecision(withAssessment({ decisionReason: "RATIONALE_UNSUPPORTED", publicationStatus: "held" })).crosses, false);
  const approved = withAssessment(
    { decisionReason: "RATIONALE_UNSUPPORTED", publicationStatus: "held" },
    {
      humanReview: {
        ...NO_REVIEW,
        status: "approved",
        reviewedByUsername: "ghassan",
        reviewedAt: "2026-11-25T10:00:00.000Z",
        feedback: "Rationale checked against the source.",
      } as RiskDto["humanReview"],
    },
  );
  assert.equal(crossingDecision(approved).crosses, true);
  const rec = toEvidenceRecord(approved, { recordId: "r", version: 1, publishedAt: T0, documentHash: null, retrievedAt: null });
  assert.deepEqual([rec.approved_by, rec.approval_reason, rec.approved_at], ["ghassan", "Rationale checked against the source.", "2026-11-25T10:00:00Z"]);
  // A legacy approval with no reviewer, time or reason is held back (AI-Q would quarantine it).
  const legacy = withAssessment(
    { decisionReason: "RATIONALE_UNSUPPORTED", publicationStatus: "held" },
    { humanReview: { ...NO_REVIEW, status: "approved" } as RiskDto["humanReview"] },
  );
  assert.equal(crossingDecision(legacy).crosses, false);
  assert.equal(crossingDecision({ ...clone(FIXTURE.dto), assessment: null }).crosses, false);
});

test("evidence_kind comes from source_type", () => {
  assert.equal(evidenceKind("empirical_study"), "research_result");
  assert.equal(evidenceKind("news"), "reported_incident");
  assert.equal(evidenceKind("position_paper"), null);
});

test("chains: record_id is the first row, the export follows the newest row", () => {
  const d = (s: string) => new Date(`2026-11-2${s}T00:00:00Z`);
  const chains = buildChains([
    { id: "a", supersedesId: null, createdAt: d("0") },
    { id: "b", supersedesId: "a", createdAt: d("1") },
    { id: "c", supersedesId: "b", createdAt: d("2") },
    { id: "x", supersedesId: "gone", createdAt: d("0") },
    { id: "p", supersedesId: "q", createdAt: d("0") },
    { id: "q", supersedesId: "p", createdAt: d("1") },
  ]);
  const by = new Map(chains.map((c) => [c.rootId, c]));
  assert.equal(by.get("a")?.latestId, "c");
  assert.deepEqual(by.get("a")?.rowIds.sort(), ["a", "b", "c"]);
  assert.equal(by.get("x")?.latestId, "x");
  assert.equal(chains.reduce((n, c) => n + c.rowIds.length, 0), 6);
});

test("plan: first export is version 1; re-running changes nothing", () => {
  const rid = FIXTURE.expected.record_id;
  const first = planRecord(rid, latest(), null, T0);
  assert.equal(first.kind, "write");
  const v1 = (first as { record: EvidenceRecordV1 }).record;
  assert.equal(v1.version, 1);
  assert.equal(v1.supersedes_version, null);
  assert.equal(planRecord(rid, latest(), v1, T1).kind, "none");
});

test("plan: a display id change alone is not a new version", () => {
  const rid = FIXTURE.expected.record_id;
  const v1 = (planRecord(rid, latest(), null, T0) as { record: EvidenceRecordV1 }).record;
  const renumbered = { ...clone(FIXTURE.dto), displayId: "R-999" };
  assert.equal(planRecord(rid, latest(renumbered), v1, T1).kind, "none");
});

test("plan: changed content becomes the next version", () => {
  const rid = FIXTURE.expected.record_id;
  const v1 = (planRecord(rid, latest(), null, T0) as { record: EvidenceRecordV1 }).record;
  const edited = clone(FIXTURE.dto);
  edited.riskScoring = { ...edited.riskScoring, impact: edited.riskScoring.impact === 5 ? 4 : 5 };
  const step = planRecord(rid, latest(edited), v1, T1);
  assert.equal(step.kind, "write");
  const v2 = (step as { record: EvidenceRecordV1 }).record;
  assert.equal(v2.version, 2);
  assert.equal(v2.supersedes_version, 1);
  assert.equal(v2.published_at, T1);
  assert.notEqual(v2.content_hash, v1.content_hash);
});

test("plan: re-processed into a held row sends a retraction for the old row", () => {
  const rid = FIXTURE.expected.record_id;
  const v1 = (planRecord(rid, latest(), null, T0) as { record: EvidenceRecordV1 }).record;
  const newer = withAssessment(
    { publicationStatus: "held", decisionReason: "SEVERITY_UNSUPPORTED" },
    { id: "11111111-1111-4111-8111-111111111111" },
  );
  const step = planRecord(rid, latest(newer), v1, T1);
  assert.equal(step.kind, "write");
  const r = (step as { record: EvidenceRecordV1 }).record;
  assert.equal(r.status, "retracted");
  assert.equal(r.retraction_reason, RETRACTION_REASON_REPROCESSED);
  assert.equal(r.airi_row_id, v1.airi_row_id);
  assert.equal(r.version, 2);
  assert.equal(r.supersedes_version, 1);
  assert.equal(r.risk_title, v1.risk_title, "not a legal removal: text kept");
  assert.equal(r.decision_reason, "SEVERITY_UNSUPPORTED", "carries AIRI's current reason");
});

test("plan: same row that stops qualifying, or is retired, is retracted with the reason", () => {
  const rid = FIXTURE.expected.record_id;
  const v1 = (planRecord(rid, latest(), null, T0) as { record: EvidenceRecordV1 }).record;
  const notes = withAssessment({ publicationStatus: "published", decisionReason: "PUBLISHED_WITH_NOTES" });
  const r1 = (planRecord(rid, latest(notes), v1, T1) as { record: EvidenceRecordV1 }).record;
  assert.match(r1.retraction_reason ?? "", /no longer meets the bridge criteria/);
  const retired = withAssessment({ publicationStatus: "retired" });
  const r2 = (planRecord(rid, latest(retired), v1, T1) as { record: EvidenceRecordV1 }).record;
  assert.equal(r2.retraction_reason, "retired in AIRI");
});

test("plan: a retracted record that qualifies again gets a new verified version", () => {
  const rid = FIXTURE.expected.record_id;
  const v1 = (planRecord(rid, latest(), null, T0) as { record: EvidenceRecordV1 }).record;
  const retired = withAssessment({ publicationStatus: "retired" });
  const v2 = (planRecord(rid, latest(retired), v1, T1) as { record: EvidenceRecordV1 }).record;
  assert.equal(planRecord(rid, latest(retired), v2, T1).kind, "none", "already retracted");
  const v3 = (planRecord(rid, latest(), v2, T1) as { record: EvidenceRecordV1 }).record;
  assert.equal(v3.status, "verified");
  assert.equal(v3.version, 3);
});

test("plan: never-exported records that don't qualify are not sent", () => {
  const notes = withAssessment({ publicationStatus: "published", decisionReason: "REPAIRED" });
  assert.equal(planRecord("r", latest(notes), null, T0).kind, "none");
});

test("query params: non-negative integers only", () => {
  assert.equal(parseCheckpointParam(undefined, "x", 0), 0);
  assert.equal(parseCheckpointParam("12", "x"), 12);
  assert.throws(() => parseCheckpointParam("-1", "x"));
  assert.throws(() => parseCheckpointParam("1.5", "x"));
});

test("scheduler is off unless enabled; interval defaults to 15 minutes", () => {
  assert.equal(evidenceExportEnabled({}), false);
  assert.equal(evidenceExportEnabled({ EVIDENCE_EXPORT_ENABLED: "1" }), true);
  assert.equal(evidenceExportIntervalMs({}), 15 * 60_000);
  assert.equal(evidenceExportIntervalMs({ EVIDENCE_EXPORT_INTERVAL_MINUTES: "5" }), 5 * 60_000);
});
