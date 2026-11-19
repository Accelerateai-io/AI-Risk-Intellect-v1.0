import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isRiskInReviewQueue,
  isRiskVisibleInMainList,
} from "./risks.service.js";
import {
  isRetiredRisk,
  retireExtractionForReprocess,
} from "./riskRetirement.js";

const DOMAIN = "7. AI System Safety, Failures, & Limitations";
const RETIRED_AT = "2026-11-19T04:00:00.000Z";
const SUCCESSOR = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function publishedExtraction(): Record<string, unknown> {
  return {
    publication_status: "published",
    publication_decision: "publish",
    review_status: "approved",
    published_automatically: true,
    risk_title: "Earlier finding",
    risk: { domains: DOMAIN },
  };
}

describe("retireExtractionForReprocess", () => {
  it("removes published status and keeps the row contents for audit", () => {
    const retired = retireExtractionForReprocess(
      publishedExtraction(),
      SUCCESSOR,
      RETIRED_AT,
    );

    assert.equal(retired.publication_status, "retired");
    assert.equal(retired.previous_publication_status, "published");
    assert.equal(retired.published_automatically, false);
    assert.equal(retired.retired_at, RETIRED_AT);
    assert.equal(retired.retired_reason, "Superseded by article reprocessing");
    assert.equal(retired.superseded_by_risk_id, SUCCESSOR);
    assert.equal(retired.review_status, "approved");
    assert.equal(retired.risk_title, "Earlier finding");
    assert.equal(isRetiredRisk(retired), true);
  });

  it("does not replace the original publication status on a second retirement", () => {
    const once = retireExtractionForReprocess(
      publishedExtraction(),
      SUCCESSOR,
      RETIRED_AT,
    );
    const twice = retireExtractionForReprocess(
      once,
      "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      "2026-11-19T05:00:00.000Z",
    );

    assert.equal(twice.previous_publication_status, "published");
    assert.equal(twice.publication_status, "retired");
    assert.equal(
      twice.superseded_by_risk_id,
      "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    );
  });

  it("drops a retired record from the published list and the review queue", () => {
    const retired = retireExtractionForReprocess(
      publishedExtraction(),
      SUCCESSOR,
      RETIRED_AT,
    );
    const approved = {
      domains: DOMAIN,
      qualityScore: 95,
      extractionJson: retired,
    };
    const stillPending = {
      domains: DOMAIN,
      qualityScore: 40,
      extractionJson: {
        ...retired,
        review_status: "pending",
        publication_status: "retired",
      },
    };

    assert.equal(isRiskVisibleInMainList(approved), false);
    assert.equal(isRiskInReviewQueue(approved), false);
    assert.equal(isRiskInReviewQueue(stillPending), false);
    assert.equal(isRiskVisibleInMainList(stillPending), false);
  });

  it("keeps the newest published record on the list", () => {
    const current = publishedExtraction();
    assert.equal(
      isRiskVisibleInMainList({
        domains: DOMAIN,
        qualityScore: 95,
        extractionJson: current,
      }),
      true,
    );
    assert.equal(isRetiredRisk(current), false);
  });
});
