import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildRiskFieldEdit,
  RiskFieldValidationError,
  EDITABLE_RISK_FIELDS,
  type EditableCurrentState,
} from "./reviewEditableFields.js";

function base(overrides: Partial<EditableCurrentState> = {}): EditableCurrentState {
  return {
    riskTitle: "Old title",
    articleTitle: "Old article title",
    domains: "Privacy and Security",
    primaryRisk: "Technical Risks",
    secondaryRisk: null,
    sector: null,
    industry: null,
    intent: null,
    qualityScore: 40,
    likelihood: 2,
    impact: 2,
    aiProductName: null,
    aiProductVendor: null,
    extractionJson: { risk: { description: "model desc", risk_title: "Old title" } },
    ...overrides,
  };
}

describe("buildRiskFieldEdit", () => {
  it("rejects fields outside the allow-list (immutable/system)", () => {
    for (const bad of ["id", "articleId", "severityScore", "severityBand", "assignedTo", "modelName", "createdAt", "extractionJson"]) {
      assert.throws(
        () => buildRiskFieldEdit(base(), { [bad]: "x" }),
        (e: unknown) => e instanceof RiskFieldValidationError && (e as RiskFieldValidationError).field === bad,
        `expected ${bad} to be rejected`,
      );
    }
  });

  it("edits title and makes it authoritative for the DTO title-resolver", () => {
    const r = buildRiskFieldEdit(base(), { riskTitle: "Corrected title" });
    assert.equal(r.columnUpdates.riskTitle, "Corrected title");
    assert.equal((r.extractionJson as any).english_risk_title, "Corrected title");
    assert.equal(r.extractionJsonChanged, true);
    assert.deepEqual(r.changes.riskTitle, { from: "Old title", to: "Corrected title" });
    // model original preserved for provenance
    assert.equal(((r.extractionJson as any).risk as any).risk_title, "Old title");
  });

  it("rejects empty title", () => {
    assert.throws(() => buildRiskFieldEdit(base(), { riskTitle: "   " }), RiskFieldValidationError);
  });

  it("validates domain against the taxonomy", () => {
    assert.throws(
      () => buildRiskFieldEdit(base(), { domains: "Totally Made Up Domain" }),
      (e: unknown) => e instanceof RiskFieldValidationError && (e as RiskFieldValidationError).field === "domains",
    );
    const ok = buildRiskFieldEdit(base(), { domains: "Malicious Actors and Misuse" });
    assert.equal(ok.columnUpdates.domains, "Malicious Actors and Misuse");
  });

  it("recomputes severity from likelihood × impact and never trusts a client severity", () => {
    const r = buildRiskFieldEdit(base({ likelihood: 2, impact: 2 }), { likelihood: 4, impact: 3 });
    assert.equal(r.columnUpdates.likelihood, 4);
    assert.equal(r.columnUpdates.impact, 3);
    assert.equal(r.columnUpdates.severityScore, 12);
    assert.equal(r.columnUpdates.severityBand, "High");
    assert.equal(r.changes.severityScore?.to, 12);
  });

  it("rejects out-of-range likelihood/impact", () => {
    assert.throws(() => buildRiskFieldEdit(base(), { likelihood: 9 }), RiskFieldValidationError);
    assert.throws(() => buildRiskFieldEdit(base(), { impact: 0 }), RiskFieldValidationError);
    assert.throws(() => buildRiskFieldEdit(base(), { likelihood: 2.5 }), RiskFieldValidationError);
  });

  it("rejects qualityScore — Scores stay read-only", () => {
    assert.throws(
      () => buildRiskFieldEdit(base(), { qualityScore: 80 }),
      (e: unknown) => e instanceof RiskFieldValidationError && (e as RiskFieldValidationError).field === "qualityScore",
    );
  });

  it("edits description in extraction_json", () => {
    const r = buildRiskFieldEdit(base(), { description: "human-corrected description" });
    assert.equal(((r.extractionJson as any).risk as any).description, "human-corrected description");
    assert.equal(r.extractionJsonChanged, true);
    assert.equal(r.changes.description?.from, "model desc");
  });

  it("accepts classification text longer than the old varchar limits", () => {
    const longPrimary = "x".repeat(400);
    const r = buildRiskFieldEdit(base(), { primaryRisk: longPrimary });
    assert.equal(r.columnUpdates.primaryRisk, longPrimary);
  });

  it("treats unchanged values as a no-op (no spurious audit rows)", () => {
    const r = buildRiskFieldEdit(base({ primaryRisk: "Technical Risks" }), { primaryRisk: "Technical Risks" });
    assert.equal(r.changedFields.length, 0);
    assert.deepEqual(r.columnUpdates, {});
  });

  it("allow-list matches the documented editable set", () => {
    assert.deepEqual(
      [...EDITABLE_RISK_FIELDS].sort(),
      ["aiProductName","aiProductVendor","articleTitle","attackVector","description","domains","impact","industry","intent","likelihood","observableIndicators","primaryRisk","riskTitle","sector","secondaryRisk","timing"].sort(),
    );
  });
});
