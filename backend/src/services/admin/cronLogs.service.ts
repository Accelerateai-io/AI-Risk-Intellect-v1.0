import {
  listDiscoveryLogs,
  type DiscoveryLogDto,
  type DiscoveryLogStatus,
} from "./discoveryLogs.service.js";
import {
  RSS_CRON_SERVICE_ID,
  sanitizeCronScheduleFeeds,
} from "./cronSchedule.service.js";
import { filterActiveIngestLinksByIds } from "./ingestLinks.service.js";

export type CronFeedLogSummary = {
  ingestLinkId: number;
  feedName: string | null;
  feedUrl: string;
  extractedCount: number;
  pendingCount: number;
  runningCount: number;
  executedCount: number;
  failedCount: number;
  skippedCount: number;
  notProcessedCount: number;
  lastActivityAt: string | null;
};

export type CronJobLogsDto = {
  scheduledFeedIds: number[];
  feeds: CronFeedLogSummary[];
  logs: DiscoveryLogDto[];
};

function countByStatus(
  logs: DiscoveryLogDto[],
  status: DiscoveryLogStatus,
): number {
  return logs.filter((row) => row.status === status).length;
}

function latestActivityAt(logs: DiscoveryLogDto[]): string | null {
  let latest: string | null = null;
  for (const row of logs) {
    for (const ts of [row.executedAt, row.extractedAt]) {
      if (!ts) continue;
      if (!latest || ts > latest) latest = ts;
    }
  }
  return latest;
}

/** Per-feed summaries and item logs for RSS feeds in the cron schedule. */
export async function listCronJobLogs(
  jobId: string = RSS_CRON_SERVICE_ID,
): Promise<CronJobLogsDto> {
  const schedule = await sanitizeCronScheduleFeeds(jobId);
  const scheduledFeedIds = [...schedule.ingestLinkIds].sort((a, b) => a - b);
  const feedIdSet = new Set(scheduledFeedIds);

  const [links, allLogs] = await Promise.all([
    filterActiveIngestLinksByIds(scheduledFeedIds),
    listDiscoveryLogs(),
  ]);

  const linkById = new Map(links.map((link) => [link.id, link]));
  const cronLogs = allLogs.filter((row) => feedIdSet.has(row.ingestLinkId));

  const logsByFeed = new Map<number, DiscoveryLogDto[]>();
  for (const id of scheduledFeedIds) {
    logsByFeed.set(id, []);
  }
  for (const row of cronLogs) {
    logsByFeed.get(row.ingestLinkId)?.push(row);
  }

  const feeds: CronFeedLogSummary[] = scheduledFeedIds.map((ingestLinkId) => {
    const link = linkById.get(ingestLinkId);
    const feedLogs = logsByFeed.get(ingestLinkId) ?? [];
    const uniqueItems = new Set(
      feedLogs
        .map((row) => row.ingestLinkItemId)
        .filter((id) => id > 0),
    );

    return {
      ingestLinkId,
      feedName: link?.suggestedName?.trim() || null,
      feedUrl: link?.url ?? "",
      extractedCount: uniqueItems.size,
      pendingCount: countByStatus(feedLogs, "PENDING"),
      runningCount: countByStatus(feedLogs, "RUNNING"),
      executedCount: countByStatus(feedLogs, "EXECUTED"),
      failedCount: countByStatus(feedLogs, "FAILED"),
      skippedCount: countByStatus(feedLogs, "SKIPPED"),
      notProcessedCount: countByStatus(feedLogs, "NOT PROCESSED"),
      lastActivityAt: latestActivityAt(feedLogs),
    };
  });

  return {
    scheduledFeedIds,
    feeds,
    logs: cronLogs,
  };
}
