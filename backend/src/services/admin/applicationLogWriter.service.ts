import type { NewApplicationLog } from "../../schema/observability/applicationLogs.js";
import { buildTableLogRow } from "../../logger/tableFormat.js";

const KNOWN_META_KEYS = new Set([
  "timestamp",
  "level",
  "message",
  "label",
  "stack",
  "splat",
  "ipAddress",
  "userAgent",
  "browser",
  "browserVersion",
  "os",
  "osVersion",
  "device",
  "deviceType",
]);

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

export function mapWinstonInfoToLogRow(
  info: Record<string, unknown>,
): NewApplicationLog {
  const meta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(info)) {
    if (!KNOWN_META_KEYS.has(key) && value !== undefined) {
      meta[key] = value;
    }
  }

  if (typeof info.stack === "string") {
    meta.stack = info.stack;
  }

  const tableRow = buildTableLogRow(info);

  return {
    level: stripAnsi(tableRow.level).toLowerCase(),
    label: tableRow.label || null,
    message: tableRow.message,
    ipAddress: tableRow.ipAddress || null,
    userAgent: typeof info.userAgent === "string" ? info.userAgent : null,
    browser: typeof info.browser === "string" ? info.browser : null,
    browserVersion:
      typeof info.browserVersion === "string" ? info.browserVersion : null,
    os: typeof info.os === "string" ? info.os : null,
    osVersion: typeof info.osVersion === "string" ? info.osVersion : null,
    device: typeof info.device === "string" ? info.device : null,
    deviceType: tableRow.deviceType || null,
    meta,
    createdAt:
      typeof info.timestamp === "string"
        ? new Date(info.timestamp)
        : new Date(),
  };
}

export async function persistApplicationLog(
  info: Record<string, unknown>,
): Promise<void> {
  const row = mapWinstonInfoToLogRow(info);

  const { db } = await import("../../database/db.js");
  const { applicationLogs } = await import(
    "../../schema/observability/applicationLogs.js"
  );

  await db.insert(applicationLogs).values(row);
}
