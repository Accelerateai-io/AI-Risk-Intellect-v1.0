import type winston from "winston";

const RESERVED_KEYS = new Set([
  "level",
  "message",
  "label",
  "timestamp",
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

export type NormalizedLogRecord = {
  timestamp: string;
  level: string;
  label: string | null;
  message: string;
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

function asNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function extractMeta(info: winston.Logform.TransformableInfo): Record<string, unknown> {
  const meta: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(info)) {
    if (RESERVED_KEYS.has(key) || value === undefined) continue;
    meta[key] = value;
  }

  if (typeof info.stack === "string") {
    meta.stack = info.stack;
  }

  return meta;
}

export function normalizeWinstonInfo(
  info: winston.Logform.TransformableInfo,
): NormalizedLogRecord {
  const timestamp =
    typeof info.timestamp === "string"
      ? info.timestamp
      : new Date().toISOString();

  return {
    timestamp,
    level: String(info.level ?? "info"),
    label: asNullableString(info.label),
    message: String(info.message ?? ""),
    ipAddress: asNullableString(info.ipAddress),
    userAgent: asNullableString(info.userAgent),
    browser: asNullableString(info.browser),
    browserVersion: asNullableString(info.browserVersion),
    os: asNullableString(info.os),
    osVersion: asNullableString(info.osVersion),
    device: asNullableString(info.device),
    deviceType: asNullableString(info.deviceType),
    meta: extractMeta(info),
  };
}

export function formatBrowserLabel(record: NormalizedLogRecord): string {
  return [record.browser, record.browserVersion].filter(Boolean).join(" ");
}

export function formatOsLabel(record: NormalizedLogRecord): string {
  return [record.os, record.osVersion].filter(Boolean).join(" ");
}

function pad(value: string, width: number): string {
  if (value.length > width) {
    return `${value.slice(0, Math.max(0, width - 1))}…`;
  }
  return value.padEnd(width, " ");
}

const TABLE_COLUMNS = [
  { key: "timestamp", header: "timestamp", width: 28 },
  { key: "level", header: "level", width: 7 },
  { key: "label", header: "label", width: 16 },
  { key: "ipAddress", header: "ip_address", width: 16 },
  { key: "browser", header: "browser", width: 18 },
  { key: "os", header: "os", width: 14 },
  { key: "deviceType", header: "device_type", width: 12 },
  { key: "message", header: "message", width: 48 },
] as const;

function tableBorder(): string {
  const inner = TABLE_COLUMNS.map((col) => "-".repeat(col.width + 2)).join("+");
  return `+${inner}+`;
}

function tableRow(values: string[]): string {
  const cells = values.map((value, index) => ` ${pad(value, TABLE_COLUMNS[index]!.width)} `);
  return `|${cells.join("|")}|`;
}

export function formatTableHeader(): string {
  return [
    tableBorder(),
    tableRow(TABLE_COLUMNS.map((col) => col.header)),
    tableBorder(),
  ].join("\n");
}

export function formatTableDataRow(record: NormalizedLogRecord): string {
  const values = [
    record.timestamp,
    record.level,
    record.label ?? "",
    record.ipAddress ?? "",
    formatBrowserLabel(record),
    formatOsLabel(record),
    record.deviceType ?? "",
    record.message,
  ];

  return tableRow(values);
}

export const APPLICATION_LOG_TABLE_HEADER = formatTableHeader();
