import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { HttpError } from "../../utils/httpError.js";

const backendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

const STORAGE_SUBDIR = "etl-reports";

function getStorageRoot(): string {
  const configured = process.env.ETL_REPORTS_STORAGE_DIR?.trim();
  if (configured) return path.resolve(configured);
  return path.join(backendRoot, "storage", STORAGE_SUBDIR);
}

function sanitizeFileStem(name: string): string {
  const stem = path.basename(name, path.extname(name));
  const cleaned = stem
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return cleaned.slice(0, 120) || "report";
}

export function resolveReportUploadAbsolutePath(reportFilePath: string): string {
  const normalized = reportFilePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..")) {
    throw HttpError.internal("Invalid stored report file path.");
  }

  const absolute = path.resolve(getStorageRoot(), normalized);
  const rootWithSep = `${getStorageRoot()}${path.sep}`;
  if (absolute !== getStorageRoot() && !absolute.startsWith(rootWithSep)) {
    throw HttpError.internal("Report file path escapes storage directory.");
  }

  return absolute;
}

export function getReportUploadDisplayName(reportFilePath: string): string {
  return path.basename(reportFilePath);
}

export async function ensureReportUploadStorageDir(): Promise<string> {
  const root = getStorageRoot();
  await fs.mkdir(root, { recursive: true });
  return root;
}

export function hashReportUploadBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function persistReportUploadFile(
  buffer: Buffer,
  originalName: string,
): Promise<string> {
  if (!buffer.length) {
    throw HttpError.badRequest("Uploaded file is empty.");
  }

  await ensureReportUploadStorageDir();

  const ext = path.extname(originalName).toLowerCase();
  const stem = sanitizeFileStem(originalName);
  const relativePath = path.posix.join(
    `${randomUUID()}_${stem}${ext}`,
  );

  const absolutePath = resolveReportUploadAbsolutePath(relativePath);
  await fs.writeFile(absolutePath, buffer);

  return relativePath.replace(/\\/g, "/");
}

export async function readReportUploadFile(reportFilePath: string): Promise<Buffer> {
  const absolutePath = resolveReportUploadAbsolutePath(reportFilePath);

  try {
    return await fs.readFile(absolutePath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw HttpError.notFound("Stored report file was not found.");
    }
    throw err;
  }
}

export async function deleteReportUploadFile(reportFilePath: string): Promise<void> {
  const absolutePath = resolveReportUploadAbsolutePath(reportFilePath);

  try {
    await fs.unlink(absolutePath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return;
    throw err;
  }
}
