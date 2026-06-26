import fs from "node:fs";

/**
 * Update or append KEY=value lines in a dotenv file, preserving comments and order.
 */
export function upsertEnvFile(
  filePath: string,
  updates: Record<string, string>,
): void {
  const keys = Object.keys(updates);
  if (keys.length === 0) return;

  let lines: string[] = [];
  if (fs.existsSync(filePath)) {
    lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  }

  const touched = new Set<string>();

  const nextLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;

    const eq = line.indexOf("=");
    if (eq === -1) return line;

    const key = line.slice(0, eq).trim();
    if (!(key in updates)) return line;

    touched.add(key);
    return `${key}=${updates[key]}`;
  });

  for (const key of keys) {
    if (!touched.has(key)) {
      nextLines.push(`${key}=${updates[key]}`);
    }
  }

  const body = nextLines.join("\n");
  fs.writeFileSync(filePath, body.endsWith("\n") ? body : `${body}\n`, "utf8");
}
