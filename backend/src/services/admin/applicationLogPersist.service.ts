import type { NormalizedLogRecord } from "../../logger/logRecord.js";

let persistQueue: Promise<void> = Promise.resolve();

export function queuePersistApplicationLog(record: NormalizedLogRecord): void {
  persistQueue = persistQueue
    .then(() => persistApplicationLog(record))
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[application-log] DB persist failed: ${message}\n`);
    });
}

async function persistApplicationLog(record: NormalizedLogRecord): Promise<void> {
  const { db } = await import("../../database/db.js");
  const { applicationLogs } = await import(
    "../../schema/observability/applicationLogs.js"
  );

  await db.insert(applicationLogs).values({
    level: record.level,
    label: record.label,
    message: record.message,
    ipAddress: record.ipAddress,
    userAgent: record.userAgent,
    browser: record.browser,
    browserVersion: record.browserVersion,
    os: record.os,
    osVersion: record.osVersion,
    device: record.device,
    deviceType: record.deviceType,
    meta: record.meta,
    createdAt: new Date(record.timestamp),
  });
}
