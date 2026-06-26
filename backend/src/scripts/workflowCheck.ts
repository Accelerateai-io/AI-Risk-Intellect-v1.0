/**
 * Quick workflow diagnostics: API, Python, Bedrock extract, DB jobs.
 *   npm run workflow:check
 */
import "../bootstrap.js";

const API = `http://localhost:${process.env.PORT ?? process.env.BACKEND_PORT ?? "5005"}`;
const PY = (process.env.PYTHON_INGEST_URL ?? "http://localhost:5006").replace(
  /\/$/,
  "",
);

let apiOk = false;
let pyOk = false;

function formatFetchError(err: unknown, target: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  const refused =
    msg.includes("fetch failed") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("Failed to fetch");
  if (refused) {
    return `cannot connect to ${target} — is the service running?`;
  }
  return `${msg} (${target})`;
}

console.log(`Checking API at ${API}/api/v1/health`);
console.log(`Checking Python at ${PY}/health\n`);

async function check(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`✗ ${name}: ${msg}`);
  }
}

await check("API health", async () => {
  let res: Response;
  try {
    res = await fetch(`${API}/api/v1/health`, {
      signal: AbortSignal.timeout(8_000),
    });
  } catch (err) {
    throw new Error(formatFetchError(err, API));
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${API}`);
  apiOk = true;
});

await check("Python health", async () => {
  const targets = [PY, PY.replace("localhost", "127.0.0.1")];
  let lastErr: unknown;
  for (const base of [...new Set(targets)]) {
    try {
      const res = await fetch(`${base}/health`, {
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${base}`);
      pyOk = true;
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(formatFetchError(lastErr, PY));
});

await check("Bedrock risk extract", async () => {
  if (!pyOk) {
    throw new Error("skipped — start Python first (npm run dev:all)");
  }
  let res: Response;
  try {
    res = await fetch(`${PY}/extract/risk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: "Enterprise LLM deployment with prompt injection and data leakage risks in AI systems.",
      title: "Workflow check",
      url: "https://example.com/check",
    }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    throw new Error(formatFetchError(err, PY));
  }
  const data = (await res.json()) as { ok?: boolean; error?: string; message?: string };
  if (!data.ok) {
    throw new Error(data.message ?? data.error ?? "extract failed");
  }
});

await check("Database jobs", async () => {
  const { db } = await import("../db/index.js");
  const { jobs } = await import("../schema/jobs/jobs.js");
  const { sql } = await import("drizzle-orm");
  const [row] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${jobs.status} = 'pending')::int`,
      skipped: sql<number>`count(*) filter (where ${jobs.status} = 'skipped')::int`,
      done: sql<number>`count(*) filter (where ${jobs.status} = 'done')::int`,
    })
    .from(jobs);
  console.log(
    `  jobs: pending=${row?.pending ?? 0} done=${row?.done ?? 0} skipped=${row?.skipped ?? 0}`,
  );
  if ((row?.skipped ?? 0) > 0) {
    const { desc, eq } = await import("drizzle-orm");
    const recent = await db
      .select({
        id: jobs.id,
        status: jobs.status,
        errorMessage: jobs.errorMessage,
      })
      .from(jobs)
      .where(eq(jobs.status, "skipped"))
      .orderBy(desc(jobs.updatedAt))
      .limit(3);
    for (const j of recent) {
      console.log(`  skipped #${j.id}: ${j.errorMessage ?? "(no message)"}`);
    }
  }
});

console.log("");
if (!apiOk || !pyOk) {
  console.log("--- Services are not running ---");
  if (apiOk && !pyOk) {
    console.log("API is up but Python is NOT. The job worker needs Python for scrape + LLM.");
    console.log("");
    console.log("Option A — second terminal (while API keeps running):");
    console.log("  cd backend");
    console.log("  npm run py:dev");
    console.log("");
    console.log("Option B — one terminal (API + Python + worker):");
    console.log("  npm run dev:all");
  } else {
    console.log("In the backend folder, start everything:");
    console.log("  npm run dev:all");
  }
  console.log("");
  console.log("Wait until you see:");
  console.log("  Server listening on port 5005");
  console.log("  Uvicorn running on http://127.0.0.1:5006");
  console.log("  [JOB-WORKER] worker loop starting");
  console.log("");
  console.log("If Python says port 5006 already in use:");
  console.log("  netstat -ano | findstr :5006");
  console.log("  taskkill /PID <pid> /F");
  console.log("");
  console.log("Then run:  npm run workflow:check");
} else {
  console.log("--- Next steps ---");
  console.log("1. Jobs → Enqueue a public URL (e.g. nist.gov AI risk framework page)");
  console.log("2. Wait for job status DONE (worker must be running)");
  console.log("3. Open Risks to see extracted data");
  console.log("");
  console.log("If jobs are SKIPPED, click the INFO icon on the row for the reason.");
  console.log("Avoid paywalled sites (WSJ, openai.com homepage) — they block fetch.");
}
