/**
 * A processing failure still has to leave a reviewable record.
 * The row is held, with the reason stored where reviewers already look.
 */

import { FACTS_V2_PIPELINE_VERSION } from "./workflowDecision.js";

export const PROCESSING_FAILED_REASON = "PROCESSING_FAILED";

export function isProcessingFailureMessage(message: string): boolean {
  return /empty response|no text content|no content in bedrock|could not be reached|timed out|timeout|ECONN|socket|throttl|stub\/fallback|invalid python extract json/i.test(
    message,
  );
}

/** True when this error is the job interval ending, which the worker retries. */
export function isExecutionIntervalAbort(message: string): boolean {
  return /did not finish|execution-time|without finishing|took more than \d+ minutes/i.test(
    message,
  );
}

/** Retry a blank HTTP body or a dead extraction service. Model-empty retries happen in Python. */
export function shouldRetryEmptyTransport(message: string): boolean {
  if (isExecutionIntervalAbort(message)) return false;
  return /invalid python extract json|produced no output|could not be reached/i.test(
    message,
  );
}

export function buildProcessingFailureExtraction(
  reason: string,
): Record<string, unknown> {
  const detail = reason.trim() || "Processing failed after retries.";
  return {
    pipeline_version: FACTS_V2_PIPELINE_VERSION,
    publication_status: "held",
    publication_decision: "hold",
    review_status: "pending",
    published_automatically: false,
    decision_reason: PROCESSING_FAILED_REASON,
    review_reason: detail,
    processing_failure: true,
    risk: {
      risk_title: "Processing failed",
      description: detail,
      domains: "",
    },
  };
}
