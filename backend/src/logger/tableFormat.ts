export type TableLogRow = {
  timestamp: string;
  level: string;
  label: string;
  ipAddress: string;
  browser: string;
  os: string;
  deviceType: string;
  message: string;
  details: string;
};

const TABLE_COLUMNS: { key: keyof TableLogRow; header: string; width: number }[] =
  [
    { key: "timestamp", header: "Timestamp", width: 24 },
    { key: "level", header: "Level", width: 5 },
    { key: "label", header: "Label", width: 18 },
    { key: "ipAddress", header: "IP Address", width: 18 },
    { key: "browser", header: "Browser", width: 14 },
    { key: "os", header: "OS", width: 12 },
    { key: "deviceType", header: "Device", width: 8 },
    { key: "message", header: "Message", width: 48 },
    { key: "details", header: "Details", width: 40 },
  ];

function padCell(value: string, width: number): string {
  if (value.length <= width) {
    return value.padEnd(width, " ");
  }
  return `${value.slice(0, Math.max(0, width - 1))}…`;
}

export function formatTableHeader(): string {
  return TABLE_COLUMNS.map((column) => padCell(column.header, column.width)).join(
    " | ",
  );
}

export function formatTableSeparator(): string {
  return TABLE_COLUMNS.map((column) => "-".repeat(column.width)).join("-+-");
}

export function formatTableRow(row: TableLogRow): string {
  return TABLE_COLUMNS.map((column) =>
    padCell(row[column.key] ?? "", column.width),
  ).join(" | ");
}

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

export function buildTableLogRow(
  info: Record<string, unknown>,
): TableLogRow {
  const timestamp =
    typeof info.timestamp === "string"
      ? info.timestamp
      : new Date().toISOString();

  const level =
    typeof info.level === "string"
      ? info.level.replace(/\u001b\[[0-9;]*m/g, "")
      : "info";

  const message =
    typeof info.message === "string" ? info.message : String(info.message ?? "");

  const meta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(info)) {
    if (!KNOWN_META_KEYS.has(key) && value !== undefined) {
      meta[key] = value;
    }
  }

  if (typeof info.stack === "string") {
    meta.stack = info.stack;
  }

  const browser =
    typeof info.browser === "string" ? info.browser : "";
  const browserVersion =
    typeof info.browserVersion === "string" ? info.browserVersion : "";
  const browserLabel = [browser, browserVersion].filter(Boolean).join(" ");

  const os = typeof info.os === "string" ? info.os : "";
  const osVersion = typeof info.osVersion === "string" ? info.osVersion : "";
  const osLabel = [os, osVersion].filter(Boolean).join(" ");

  let details = "";
  if (Object.keys(meta).length > 0) {
    try {
      details = JSON.stringify(meta);
    } catch {
      details = String(meta);
    }
  }

  return {
    timestamp,
    level,
    label: typeof info.label === "string" ? info.label : "",
    ipAddress: typeof info.ipAddress === "string" ? info.ipAddress : "",
    browser: browserLabel,
    os: osLabel,
    deviceType: typeof info.deviceType === "string" ? info.deviceType : "",
    message,
    details,
  };
}
