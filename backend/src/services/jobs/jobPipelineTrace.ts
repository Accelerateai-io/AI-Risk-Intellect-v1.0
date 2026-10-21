/**
 * In-flight progress for the one job the worker is running.
 * Printed when that URL is skipped for the execution-time limit.
 */

export type PipelineStep =
  | "idle"
  | "fetching_page"
  | "extracting_website"
  | "storing_feed"
  | "feed_stored"
  | "preparing_python"
  | "sending_python"
  | "python_responded"
  | "saving_risk"
  | "risk_saved";

export type JobPipelineTrace = {
  jobId: number;
  url: string;
  articleId: number;
  step: PipelineStep;
  detail: string;
  extractedChars: number | null;
  storedChars: number | null;
  riskId: string | null;
  reported: boolean;
};

export type ArticleFeedFacts = {
  articleChars: number;
};

const PREFIX = "[job-timeout]";

let active: JobPipelineTrace | null = null;

export function beginJobPipelineTrace(input: {
  jobId: number;
  url: string;
  articleId: number;
}): void {
  active = {
    jobId: input.jobId,
    url: input.url,
    articleId: input.articleId,
    step: "idle",
    detail: "The worker has not started fetching the page.",
    extractedChars: null,
    storedChars: null,
    riskId: null,
    reported: false,
  };
}

export function endJobPipelineTrace(): void {
  active = null;
}

export function currentJobPipelineTrace(): JobPipelineTrace | null {
  return active;
}

function note(step: PipelineStep, detail: string): void {
  if (!active) return;
  active.step = step;
  active.detail = detail;
  // The worker is a child process. Write and flush so the API terminal
  // shows the line while the job is still running, not after it exits.
  const line = `[job] jobId=${active.jobId} url=${active.url} ${detail}\n`;
  process.stdout.write(line);
}

export function noteWebsiteFetchStarted(): void {
  note("fetching_page", "The worker is fetching the page.");
}

export function noteWebsiteExtractStarted(): void {
  note(
    "extracting_website",
    "Python ingest is extracting article text from the page.",
  );
}

export function noteWebsiteExtractCompleted(chars: number): void {
  if (!active) return;
  active.extractedChars = chars;
  note(
    "extracting_website",
    `Python ingest returned ${chars} characters of article text.`,
  );
}

export function noteFeedStoreStarted(): void {
  note("storing_feed", "The worker is saving the extracted article text.");
}

export function noteFeedStored(chars: number): void {
  if (!active) return;
  active.storedChars = chars;
  note(
    "feed_stored",
    `Article text is saved (${chars} characters).`,
  );
}

export function notePreparingPython(): void {
  note(
    "preparing_python",
    "The feed is stored. The worker is resolving the model before the Python risk call.",
  );
}

export function notePythonSendStarted(): void {
  note(
    "sending_python",
    "The stored article text was sent to Python risk extraction.",
  );
}

export function notePythonResponded(): void {
  note("python_responded", "Python returned a risk extraction.");
}

export function noteRiskSaveStarted(): void {
  note("saving_risk", "The worker is saving the Python risk result.");
}

export function noteRiskSaved(riskId: string): void {
  if (!active) return;
  active.riskId = riskId;
  note("risk_saved", `Risk ${riskId} is saved.`);
}

/** Snapshot the active trace once so the timeout report is printed a single time. */
export function claimExecutionTimeReport(jobId: number): JobPipelineTrace | null {
  if (!active || active.jobId !== jobId || active.reported) return null;
  active.reported = true;
  return { ...active };
}

function chars(value: number | null, facts: ArticleFeedFacts): number {
  if (value != null && value > 0) return value;
  return facts.articleChars;
}

function websiteLine(trace: JobPipelineTrace, facts: ArticleFeedFacts): string {
  if (trace.step === "idle") {
    return `${PREFIX} 1. Website extraction: not started. ${trace.detail}`;
  }
  if (trace.step === "fetching_page") {
    return `${PREFIX} 1. Website extraction: still running. ${trace.detail} Python ingest has not started.`;
  }
  if (trace.step === "extracting_website" && trace.extractedChars == null) {
    return `${PREFIX} 1. Website extraction: still running. ${trace.detail}`;
  }
  const n = chars(trace.extractedChars, facts);
  return `${PREFIX} 1. Website extraction: completed (${n} characters).`;
}

function feedLine(trace: JobPipelineTrace, facts: ArticleFeedFacts): string {
  const storedThisRun =
    trace.step === "feed_stored" ||
    trace.step === "preparing_python" ||
    trace.step === "sending_python" ||
    trace.step === "python_responded" ||
    trace.step === "saving_risk" ||
    trace.step === "risk_saved" ||
    trace.storedChars != null;

  if (trace.step === "storing_feed") {
    return `${PREFIX} 2. Extracted feed stored: still saving. ${trace.detail}`;
  }
  if (storedThisRun) {
    const n = chars(trace.storedChars ?? trace.extractedChars, facts);
    return `${PREFIX} 2. Extracted feed stored: yes (article ${trace.articleId}, ${n} characters).`;
  }
  if (facts.articleChars > 0) {
    return `${PREFIX} 2. Extracted feed stored: no on this run. Article ${trace.articleId} already has ${facts.articleChars} characters from an earlier attempt.`;
  }
  return `${PREFIX} 2. Extracted feed stored: no. ${trace.detail}`;
}

function pythonLine(trace: JobPipelineTrace): string {
  if (trace.step === "sending_python") {
    return `${PREFIX} 3. Sent to Python: yes. The risk-extraction request was in flight when the time limit was reached.`;
  }
  if (
    trace.step === "python_responded" ||
    trace.step === "saving_risk" ||
    trace.step === "risk_saved"
  ) {
    return `${PREFIX} 3. Sent to Python: yes. Python returned a risk extraction.`;
  }
  return `${PREFIX} 3. Sent to Python: no. The risk call had not started. The job was still here: ${trace.detail}`;
}

function whyLine(trace: JobPipelineTrace): string {
  switch (trace.step) {
    case "idle":
    case "fetching_page":
      return `${PREFIX} 4. Expected risk result: none. The feed did not reach Python because the execution-time limit stopped the job during website extraction. ${trace.detail}`;
    case "extracting_website":
      if (trace.extractedChars != null) {
        return `${PREFIX} 4. Expected risk result: none. Website extraction finished, and the feed was not stored before the execution-time limit stopped the job. ${trace.detail}`;
      }
      return `${PREFIX} 4. Expected risk result: none. The feed did not reach Python because the execution-time limit stopped the job during website extraction. ${trace.detail}`;
    case "storing_feed":
      return `${PREFIX} 4. Expected risk result: none. The feed did not reach Python because the execution-time limit stopped the job while the extracted text was being saved.`;
    case "feed_stored":
    case "preparing_python":
      return `${PREFIX} 4. Expected risk result: none. The feed is stored, and the Python risk call had not started. ${trace.detail}`;
    case "sending_python":
      return `${PREFIX} 4. Expected risk result: none. The feed was sent to Python, and the execution-time limit aborted that request before Python returned a result, so no risk row was written.`;
    case "python_responded":
    case "saving_risk":
      return `${PREFIX} 4. Expected risk result: Python returned a result, and it had not been saved when the job was skipped. ${trace.detail}`;
    case "risk_saved":
      return `${PREFIX} 4. Expected risk result: saved${trace.riskId ? ` as risk ${trace.riskId}` : ""}. The job was still marked skipped because the execution-time limit was reached before the job could be marked done.`;
    default:
      return `${PREFIX} 4. Expected risk result: none. ${trace.detail}`;
  }
}

export function formatExecutionTimeSkipReport(
  trace: JobPipelineTrace,
  facts: ArticleFeedFacts,
): string[] {
  return [
    `${PREFIX} jobId=${trace.jobId} articleId=${trace.articleId} url=${trace.url}`,
    `${PREFIX} Skipped because the execution-time limit was reached.`,
    websiteLine(trace, facts),
    feedLine(trace, facts),
    pythonLine(trace),
    whyLine(trace),
  ];
}

export function formatOrphanExecutionTimeSkipReport(input: {
  jobId: number;
  url: string;
  articleId: number;
  articleChars: number;
  riskId: string | null;
  riskTouchedDuringRun: boolean;
}): string[] {
  const header = `${PREFIX} jobId=${input.jobId} articleId=${input.articleId} url=${input.url}`;
  const skipped = `${PREFIX} Skipped because the execution-time limit was reached. The worker found this URL still running and had no in-flight step recorded.`;
  if (input.articleChars <= 0) {
    return [
      header,
      skipped,
      `${PREFIX} 1. Website extraction: no text is stored on the article, so extraction did not finish.`,
      `${PREFIX} 2. Extracted feed stored: no.`,
      `${PREFIX} 3. Sent to Python: no.`,
      `${PREFIX} 4. Expected risk result: none. The feed did not reach Python because no extracted text was stored before the job was skipped.`,
    ];
  }
  if (!input.riskTouchedDuringRun) {
    return [
      header,
      skipped,
      `${PREFIX} 1. Website extraction: completed. The article has stored text.`,
      `${PREFIX} 2. Extracted feed stored: yes (article ${input.articleId}, ${input.articleChars} characters).`,
      `${PREFIX} 3. Sent to Python: no risk row was written during this run, so a Python result did not come back.`,
      `${PREFIX} 4. Expected risk result: none. The feed was stored, and this run ended before a Python risk result was saved.`,
    ];
  }
  return [
    header,
    skipped,
    `${PREFIX} 1. Website extraction: completed. The article has stored text.`,
    `${PREFIX} 2. Extracted feed stored: yes (article ${input.articleId}, ${input.articleChars} characters).`,
    `${PREFIX} 3. Sent to Python: yes. A risk row was written during this run.`,
    `${PREFIX} 4. Expected risk result: saved${input.riskId ? ` as risk ${input.riskId}` : ""}. The job was still marked skipped because it passed the execution-time limit.`,
  ];
}
