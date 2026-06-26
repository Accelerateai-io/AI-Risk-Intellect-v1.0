import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getLlmModelConfig,
  invokeLlmModel,
} from "../services/admin/llmModelConfig.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const pythonRoot = path.join(repoRoot, "python");

function pythonCommand(): string {
  return (
    process.env.PYTHON_BIN?.trim() ||
    (process.platform === "win32" ? "python" : "python3")
  );
}

function cleanTranslationResponse(raw: string): string {
  let text = raw.trim();
  text = text.replace(/^(english translation|translation):\s*/i, "");
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1).trim();
  }
  return text;
}

async function translateViaPython(text: string): Promise<string | null> {
  const py = pythonCommand();
  const script =
    "import sys; from app.translation.translate_text import translate_text_to_english; " +
    "result = translate_text_to_english(sys.stdin.read()); print(result or '')";

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
      const translated = cleanTranslationResponse(stdout);
      resolve(translated.length > 0 ? translated : null);
    });

    child.stdin.write(text);
    child.stdin.end();
  });
}

async function translateViaBedrock(
  text: string,
  preferredModelId?: string,
): Promise<string | null> {
  const { modelId: configuredModelId } = getLlmModelConfig();
  const modelId = preferredModelId?.trim() || configuredModelId;
  if (!modelId) return null;

  const result = await invokeLlmModel({
    modelId,
    prompt:
      "Translate the following text into English. " +
      "Return only the English translation with no quotes, labels, markdown, or explanation.\n\n" +
      text,
    maxTokens: 256,
    temperature: 0,
  });

  if (!result.success || !result.response?.trim()) return null;

  const translated = cleanTranslationResponse(result.response);
  return translated.length > 0 ? translated : null;
}

/** Translate short text (e.g. risk or article title) to English. */
export async function translateTextToEnglish(
  text: string,
  preferredModelId?: string,
): Promise<string | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const viaBedrock = await translateViaBedrock(trimmed, preferredModelId);
  if (viaBedrock && viaBedrock !== trimmed) return viaBedrock;

  const viaPython = await translateViaPython(trimmed);
  if (viaPython && viaPython !== trimmed) return viaPython;

  return null;
}
