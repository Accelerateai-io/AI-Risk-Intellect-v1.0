import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const pythonRoot = path.join(repoRoot, "python");

const MIN_SAMPLE_CHARS = 50;

function pythonCommand(): string {
  return (
    process.env.PYTHON_BIN?.trim() ||
    (process.platform === "win32" ? "python" : "python3")
  );
}

/** ISO 639-1 codes treated as English for review routing. */
export function isEnglishLanguageCode(code: string | null | undefined): boolean {
  if (!code) return true;
  const normalized = code.trim().toLowerCase();
  return normalized === "en" || normalized.startsWith("en-");
}

/**
 * Detect article language via Python langdetect (same as ingest pipeline).
 * Returns null when sample is too short or detection fails.
 */
export async function detectTextLanguage(text: string): Promise<string | null> {
  const sample = text.trim();
  if (sample.length < MIN_SAMPLE_CHARS) return null;

  const py = pythonCommand();
  const script =
    "import sys; from app.ingestion.language_detect import detect_text_language; " +
    "lang = detect_text_language(sys.stdin.read()); print(lang or '')";

  return new Promise((resolve) => {
    const child = spawn(py, ["-c", script], {
      cwd: pythonRoot,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONPATH: pythonRoot },
    });

    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.on("error", () => resolve(null));
    child.on("close", () => {
      const lang = stdout.trim().toLowerCase();
      resolve(lang.length > 0 ? lang : null);
    });

    child.stdin.write(sample.slice(0, 8000));
    child.stdin.end();
  });
}
