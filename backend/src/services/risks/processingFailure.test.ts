import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildProcessingFailureExtraction,
  isExecutionIntervalAbort,
  isProcessingFailureMessage,
} from "./processingFailure.js";
import {
  isRiskInReviewQueue,
  isRiskVisibleInMainList,
} from "./risks.service.js";

describe("processing failure records", () => {
  it("holds the record with the failure reason and keeps it off the published list", () => {
    const extractionJson = buildProcessingFailureExtraction(
      "Model returned an empty response after 3 attempts",
    );
    const row = {
      domains: null,
      qualityScore: null,
      extractionJson,
    };

    assert.equal(extractionJson.publication_status, "held");
    assert.equal(extractionJson.review_status, "pending");
    assert.equal(extractionJson.decision_reason, "PROCESSING_FAILED");
    assert.equal(
      extractionJson.review_reason,
      "Model returned an empty response after 3 attempts",
    );
    assert.equal(isRiskVisibleInMainList(row), false);
    assert.equal(isRiskInReviewQueue(row), true);
  });

  it("retries empty model responses and timeouts, and leaves interval aborts to the job ladder", () => {
    assert.equal(
      isProcessingFailureMessage("Model returned an empty response after 3 attempts"),
      true,
    );
    assert.equal(
      isProcessingFailureMessage("The operation was aborted due to timeout"),
      true,
    );
    assert.equal(
      isExecutionIntervalAbort(
        "Skipped because this URL did not finish after 12 execution-time intervals.",
      ),
      true,
    );
    assert.equal(
      isExecutionIntervalAbort("Model returned an empty response after 3 attempts"),
      false,
    );
  });
});
