import fs from "node:fs";
import path from "node:path";
import { and, desc, eq, inArray, like } from "drizzle-orm";
import { z } from "zod";
import {
  cronTimezoneSchema,
  REPEAT_UNITS,
  type CronScheduleConfig,
  type RepeatUnit,
  type SaveCronScheduleInput,
} from "../../config/cronScheduleConfig.js";
import {
  DEFAULT_CRON_TIMEZONE,
  getZonedDateTimeParts,
  normalizeTimezone,
} from "../../utils/cronTimezone.js";
import { db } from "../../db/index.js";
import {
  cronJobScheduleFeeds,
  cronJobSchedules,
} from "../../schema/cronJobs/cronJobSchedules.js";
import { ingestLinks } from "../../schema/ingestLinks/ingestLinks.js";
import { filterActiveIngestLinksByIds } from "./ingestLinks.service.js";
import { backendRoot } from "./spawnBackendScript.js";

/** API / service identifier (PUT route param). Not a stored schedule row id. */
export const RSS_CRON_SERVICE_ID = "rss-discovery";

/** Placeholder id for unsaved schedule state in the UI. */
export const RSS_CRON_PLACEHOLDER_ID = "rss-0";

const RSS_CRON_ID_PATTERN = /^rss-(\d+)$/;
const legacyConfigPath = path.join(backendRoot, "config", "cron-schedule.json");

const scheduleSchema = z.object({
  id: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  timezone: cronTimezoneSchema,
  repeat: z.boolean(),
  repeatInterval: z.number().int().positive().max(365),
  repeatUnit: z.enum(REPEAT_UNITS),
  repeatDays: z.array(z.number().int().min(0).max(6)),
  ingestLinkIds: z.array(z.number().int().positive()),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  active: z.boolean(),
});

function defaultSchedule(): CronScheduleConfig {
  const timezone = DEFAULT_CRON_TIMEZONE;
  const today = getZonedDateTimeParts(new Date(), timezone).date;
  return {
    id: RSS_CRON_PLACEHOLDER_ID,
    startDate: today,
    startTime: "10:30",
    timezone: DEFAULT_CRON_TIMEZONE,
    repeat: true,
    repeatInterval: 1,
    repeatUnit: "day",
    repeatDays: [],
    ingestLinkIds: [],
    endsOn: null,
    active: false,
  };
}

function normalizeLegacySchedule(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  delete raw.endTime;
  if (raw.repeatInterval == null) raw.repeatInterval = 1;
  if (raw.repeatUnit == null) raw.repeatUnit = "day";
  if (raw.timezone == null) raw.timezone = DEFAULT_CRON_TIMEZONE;
  return raw;
}

function rowToConfig(
  row: typeof cronJobSchedules.$inferSelect,
  ingestLinkIds: number[],
): CronScheduleConfig {
  return scheduleSchema.parse({
    id: row.id,
    startDate: row.startDate,
    startTime: row.startTime,
    timezone: normalizeTimezone(row.timezone),
    repeat: row.repeat,
    repeatInterval: row.repeatInterval,
    repeatUnit: row.repeatUnit,
    repeatDays: row.repeatDays ?? [],
    ingestLinkIds,
    endsOn: row.endsOn ?? null,
    active: row.active,
  });
}

function parseRssCronSequence(id: string): number | null {
  const match = RSS_CRON_ID_PATTERN.exec(id);
  if (!match) return null;
  return Number.parseInt(match[1], 10);
}

async function loadActiveFeedIds(scheduleId: string): Promise<number[]> {
  const rows = await db
    .select({ ingestLinkId: cronJobScheduleFeeds.ingestLinkId })
    .from(cronJobScheduleFeeds)
    .innerJoin(
      ingestLinks,
      eq(cronJobScheduleFeeds.ingestLinkId, ingestLinks.id),
    )
    .where(
      and(
        eq(cronJobScheduleFeeds.scheduleId, scheduleId),
        eq(ingestLinks.archived, false),
      ),
    );

  return rows.map((row) => row.ingestLinkId);
}

async function listRssCronScheduleIds(): Promise<string[]> {
  const rows = await db
    .select({ id: cronJobSchedules.id })
    .from(cronJobSchedules)
    .where(like(cronJobSchedules.id, "rss-%"));

  return rows.map((row) => row.id);
}

export async function nextRssCronJobId(): Promise<string> {
  const ids = await listRssCronScheduleIds();
  let maxSequence = 0;
  for (const id of ids) {
    const sequence = parseRssCronSequence(id);
    if (sequence != null) {
      maxSequence = Math.max(maxSequence, sequence);
    }
  }
  return `rss-${maxSequence + 1}`;
}

export async function deactivateAllRssCronSchedules(): Promise<void> {
  const now = new Date();
  await db
    .update(cronJobSchedules)
    .set({ active: false, updatedAt: now })
    .where(like(cronJobSchedules.id, "rss-%"));
}

async function loadScheduleRowById(
  scheduleId: string,
): Promise<typeof cronJobSchedules.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(cronJobSchedules)
    .where(eq(cronJobSchedules.id, scheduleId))
    .limit(1);
  return row ?? null;
}

async function loadActiveScheduleRowOnly(): Promise<
  typeof cronJobSchedules.$inferSelect | null
> {
  const [activeRow] = await db
    .select()
    .from(cronJobSchedules)
    .where(
      and(eq(cronJobSchedules.active, true), like(cronJobSchedules.id, "rss-%")),
    )
    .orderBy(desc(cronJobSchedules.createdAt))
    .limit(1);

  return activeRow ?? null;
}

export async function loadActiveCronScheduleConfig(): Promise<CronScheduleConfig | null> {
  const row = await loadActiveScheduleRowOnly();
  if (!row) return null;

  const ingestLinkIds = await loadActiveFeedIds(row.id);
  return rowToConfig(row, ingestLinkIds);
}

async function loadActiveScheduleRow(): Promise<
  typeof cronJobSchedules.$inferSelect | null
> {
  const [activeRow] = await db
    .select()
    .from(cronJobSchedules)
    .where(
      and(eq(cronJobSchedules.active, true), like(cronJobSchedules.id, "rss-%")),
    )
    .orderBy(desc(cronJobSchedules.createdAt))
    .limit(1);

  if (activeRow) return activeRow;

  const [latestRow] = await db
    .select()
    .from(cronJobSchedules)
    .where(like(cronJobSchedules.id, "rss-%"))
    .orderBy(desc(cronJobSchedules.createdAt))
    .limit(1);

  return latestRow ?? null;
}

async function importLegacyJsonSchedule(): Promise<CronScheduleConfig | null> {
  try {
    if (!fs.existsSync(legacyConfigPath)) return null;
    const raw = fs.readFileSync(legacyConfigPath, "utf8");
    const parsed = normalizeLegacySchedule(
      JSON.parse(raw) as Record<string, unknown>,
    );
    let schedule = scheduleSchema.parse({
      ...parsed,
      id: await nextRssCronJobId(),
    });
    const links = await filterActiveIngestLinksByIds(schedule.ingestLinkIds);
    schedule = {
      ...schedule,
      ingestLinkIds: links.map((link) => link.id),
      active: links.length > 0 && schedule.active,
    };
    return writeCronScheduleConfig(schedule);
  } catch {
    return null;
  }
}

async function replaceScheduleFeeds(
  scheduleId: string,
  ingestLinkIds: number[],
): Promise<void> {
  await db
    .delete(cronJobScheduleFeeds)
    .where(eq(cronJobScheduleFeeds.scheduleId, scheduleId));

  const uniqueIds = [...new Set(ingestLinkIds)];
  if (uniqueIds.length === 0) return;

  await db.insert(cronJobScheduleFeeds).values(
    uniqueIds.map((ingestLinkId) => ({
      scheduleId,
      ingestLinkId,
    })),
  );
}

export async function writeCronScheduleConfig(
  schedule: CronScheduleConfig,
): Promise<CronScheduleConfig> {
  const next = scheduleSchema.parse(schedule);
  const now = new Date();

  await db
    .insert(cronJobSchedules)
    .values({
      id: next.id,
      startDate: next.startDate,
      startTime: next.startTime,
      timezone: next.timezone,
      repeat: next.repeat,
      repeatInterval: next.repeatInterval,
      repeatUnit: next.repeatUnit as RepeatUnit,
      repeatDays: next.repeatDays,
      endsOn: next.endsOn,
      active: next.active,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: cronJobSchedules.id,
      set: {
        startDate: next.startDate,
        startTime: next.startTime,
        timezone: next.timezone,
        repeat: next.repeat,
        repeatInterval: next.repeatInterval,
        repeatUnit: next.repeatUnit as RepeatUnit,
        repeatDays: next.repeatDays,
        endsOn: next.endsOn,
        active: next.active,
        updatedAt: now,
      },
    });

  await replaceScheduleFeeds(next.id, next.ingestLinkIds);
  return next;
}

export async function loadCronScheduleConfig(
  jobId?: string,
): Promise<CronScheduleConfig> {
  if (jobId && jobId !== RSS_CRON_SERVICE_ID) {
    const row = await loadScheduleRowById(jobId);
    if (row) {
      const ingestLinkIds = await loadActiveFeedIds(row.id);
      return rowToConfig(row, ingestLinkIds);
    }
  }

  const row = await loadActiveScheduleRow();
  if (row) {
    const ingestLinkIds = await loadActiveFeedIds(row.id);
    return rowToConfig(row, ingestLinkIds);
  }

  const imported = await importLegacyJsonSchedule();
  if (imported) return imported;

  return defaultSchedule();
}

export async function loadActiveCronScheduleId(): Promise<string> {
  const schedule = await loadActiveCronScheduleConfig();
  if (!schedule) {
    return RSS_CRON_SERVICE_ID;
  }
  return schedule.id;
}

/** Deactivate the current active RSS cron schedule (if any). */
export async function deactivateActiveCronSchedule(): Promise<CronScheduleConfig | null> {
  const row = await loadActiveScheduleRow();
  if (!row?.active) return null;

  const now = new Date();
  await db
    .update(cronJobSchedules)
    .set({ active: false, updatedAt: now })
    .where(eq(cronJobSchedules.id, row.id));

  const ingestLinkIds = await loadActiveFeedIds(row.id);
  return rowToConfig({ ...row, active: false }, ingestLinkIds);
}

/** Update the active schedule in place when one exists; otherwise create a new rss-N row. */
export async function saveCronScheduleConfig(
  input: SaveCronScheduleInput,
): Promise<CronScheduleConfig> {
  const activeRow = await loadActiveScheduleRowOnly();
  const scheduleId =
    activeRow?.id && activeRow.id !== RSS_CRON_PLACEHOLDER_ID
      ? activeRow.id
      : await nextRssCronJobId();

  await deactivateAllRssCronSchedules();

  const schedule = scheduleSchema.parse({
    id: scheduleId,
    ...input,
    endsOn: null,
    active: true,
  });

  return writeCronScheduleConfig(schedule);
}

/** Remove junction rows for archived or missing feeds and deactivate when none remain. */
export async function sanitizeCronScheduleFeeds(
  jobId?: string,
): Promise<CronScheduleConfig> {
  const schedule = await loadCronScheduleConfig(jobId);
  if (schedule.id === RSS_CRON_PLACEHOLDER_ID) return schedule;
  if (schedule.ingestLinkIds.length === 0) return schedule;

  const scheduleId = schedule.id;
  const [allFeedRows, activeRows] = await Promise.all([
    db
      .select({ ingestLinkId: cronJobScheduleFeeds.ingestLinkId })
      .from(cronJobScheduleFeeds)
      .where(eq(cronJobScheduleFeeds.scheduleId, scheduleId)),
    db
      .select({ ingestLinkId: cronJobScheduleFeeds.ingestLinkId })
      .from(cronJobScheduleFeeds)
      .innerJoin(
        ingestLinks,
        eq(cronJobScheduleFeeds.ingestLinkId, ingestLinks.id),
      )
      .where(
        and(
          eq(cronJobScheduleFeeds.scheduleId, scheduleId),
          eq(ingestLinks.archived, false),
        ),
      ),
  ]);

  const activeIds = activeRows.map((row) => row.ingestLinkId);
  const staleIds = allFeedRows
    .map((row) => row.ingestLinkId)
    .filter((id) => !activeIds.includes(id));

  if (staleIds.length === 0) return schedule;

  await db
    .delete(cronJobScheduleFeeds)
    .where(
      and(
        eq(cronJobScheduleFeeds.scheduleId, scheduleId),
        inArray(cronJobScheduleFeeds.ingestLinkId, staleIds),
      ),
    );

  const next: CronScheduleConfig = {
    ...schedule,
    ingestLinkIds: activeIds,
    active: activeIds.length > 0 && schedule.active,
  };

  if (next.active !== schedule.active) {
    await db
      .update(cronJobSchedules)
      .set({ active: next.active, updatedAt: new Date() })
      .where(eq(cronJobSchedules.id, scheduleId));
  }

  return next;
}
