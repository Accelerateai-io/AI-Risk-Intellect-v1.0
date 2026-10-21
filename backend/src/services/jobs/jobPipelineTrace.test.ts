import assert from "node:assert/strict";
import { test } from "node:test";
import {
  beginJobPipelineTrace,
  claimExecutionTimeReport,
  endJobPipelineTrace,
  formatExecutionTimeSkipReport,
  formatOrphanExecutionTimeSkipReport,
  notePythonSendStarted,
  noteWebsiteExtractStarted,
  noteWebsiteFetchStarted,
  type JobPipelineTrace,
} from "./jobPipelineTrace.js";

function trace(step: JobPipelineTrace["step"], detail: string): JobPipelineTrace {
  return {
    jobId: 7,
    url: "https://example.com/story",
    articleId: 3,
    step,
    detail,
    extractedChars: step === "fetching_page" || step === "idle" ? null : 1200,
    storedChars:
      step === "feed_stored" ||
      step === "preparing_python" ||
      step === "sending_python" ||
      step === "risk_saved"
        ? 1200
        : null,
    riskId: step === "risk_saved" ? "risk-1" : null,
    reported: false,
  };
}

test("timeout during page fetch explains that Python was never called", () => {
  const lines = formatExecutionTimeSkipReport(
    trace("fetching_page", "The worker is fetching the page."),
    { articleChars: 0 },
  );
  assert.match(lines[2]!, /Website extraction: still running/);
  assert.match(lines[3]!, /Extracted feed stored: no/);
  assert.match(lines[4]!, /Sent to Python: no/);
  assert.match(lines[5]!, /did not reach Python/);
});

test("timeout while Python risk extraction is in flight", () => {
  const lines = formatExecutionTimeSkipReport(
    trace("sending_python", "sent"),
    { articleChars: 1200 },
  );
  assert.match(lines[2]!, /Website extraction: completed/);
  assert.match(lines[3]!, /Extracted feed stored: yes/);
  assert.match(lines[4]!, /Sent to Python: yes/);
  assert.match(lines[5]!, /aborted that request before Python returned/);
});

test("orphan skip with no stored text", () => {
  const lines = formatOrphanExecutionTimeSkipReport({
    jobId: 9,
    url: "https://example.com/a",
    articleId: 4,
    articleChars: 0,
    riskId: null,
    riskTouchedDuringRun: false,
  });
  assert.match(lines[4]!, /Sent to Python: no/);
  assert.match(lines[5]!, /no extracted text was stored/);
});

test("claim prints the execution-time report once", () => {
  beginJobPipelineTrace({
    jobId: 1,
    url: "https://example.com",
    articleId: 2,
  });
  noteWebsiteFetchStarted();
  noteWebsiteExtractStarted();
  notePythonSendStarted();
  const first = claimExecutionTimeReport(1);
  const second = claimExecutionTimeReport(1);
  assert.equal(first?.step, "sending_python");
  assert.equal(second, null);
  endJobPipelineTrace();
});
