import { and, desc, eq, sql } from "drizzle-orm";
import path from "node:path";
import { db } from "../../database/db.js";
import { applicationLogPath } from "../../logger/logger.js";
import { applicationLogs } from "../../schema/observability/applicationLogs.js";

export type ApplicationLogEntry = {
  id: string;
  level: string;
  message: string;
  label: string | null;
  timestamp: string;
  ipAddress: string | null;
  userAgent: string | null;
  browser: string | null;
  browserVersion: string | null;
  os: string | null;
  osVersion: string | null;
  device: string | null;
  deviceType: string | null;
  meta: Record<string, unknown>;
};

export type ListApplicationLogsOptions = {
  limit?: number;
  level?: string;
  label?: string;
  source?: "application" | "error";
};

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 200;

function mapDbRow(row: typeof applicationLogs.$inferSelect): ApplicationLogEntry {
  return {
    id: String(row.id),
    level: row.level,
    message: row.message,
    label: row.label,
    timestamp: row.createdAt.toISOString(),
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    browser: row.browser,
    browserVersion: row.browserVersion,
    os: row.os,
    osVersion: row.osVersion,
    device: row.device,
    deviceType: row.deviceType,
    meta: row.meta ?? {},
  };
}

export async function listApplicationLogs(
  options: ListApplicationLogsOptions = {},
): Promise<{
  logs: ApplicationLogEntry[];
  logDir: string;
  sources: { application: string; error: string };
  storage: "database";
}> {
  const limit = Math.min(
    Math.max(options.limit ?? DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );
  const levelFilter = options.level?.trim().toLowerCase();
  const labelFilter = options.label?.trim().toLowerCase();
  const source = options.source ?? "application";

  const conditions = [];
  if (levelFilter) {
    conditions.push(eq(applicationLogs.level, levelFilter));
  }
  if (labelFilter) {
    conditions.push(sql`lower(${applicationLogs.label}) = ${labelFilter}`);
  }
  if (source === "error") {
    conditions.push(eq(applicationLogs.level, "error"));
  }

  const rows = await db
    .select()
    .from(applicationLogs)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(applicationLogs.createdAt))
    .limit(limit);

  return {
    logs: rows.map(mapDbRow),
    logDir: path.dirname(applicationLogPath),
    sources: {
      application: applicationLogPath,
      error: path.join(path.dirname(applicationLogPath), "error.log"),
    },
    storage: "database",
  };
}
