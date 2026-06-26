import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "react-toastify";
import {
  Calendar,
  ChevronDown,
  Clock,
  Infinity,
  RefreshCw,
  Rss,
  Save,
  Search,
  Square,
  X,
} from "lucide-react";
import {
  fetchCronJobs,
  saveCronJobSchedule,
  stopCronJobSchedule,
  type CronJobRow,
  type RepeatUnit,
  type SaveCronScheduleInput,
} from "../../../utils/cronJobsApi";
import {
  fetchCronJobLogs,
  type CronFeedLogSummary,
} from "../../../utils/cronLogsApi";
import { formatCronSaveToastMessage, formatCronScheduleSummary } from "../../../utils/cronScheduleSummary";
import {
  buildCronTimeSelectOptions,
  normalizeCronTime,
} from "../../../utils/cronTimeOptions";
import {
  browserTimezone,
  clampStartDateForTimezone,
  CRON_SCHEDULE_TIMEZONE,
  formatTimezoneOption,
  todayInTimezone,
  toUserSchedule,
  weekdayInTimezone,
} from "../../../utils/cronTimezones";
import {
  toastCronJobScheduled,
  toastCronJobStopped,
} from "../../../notifications/notificationToasts";
import { requestNotificationsReload } from "../../../notifications/notificationsReload";
import { formatJobExecutedAt } from "../../../utils/formatDate";
import {
  fetchIngestLinks,
  type IngestLinkRow,
} from "../../../utils/ingestLinksApi";
import { AdminDataTable } from "./AdminDataTable";
import {
  serviceStatusLabel,
  serviceStatusPillClass,
  type ServiceState,
} from "./adminServices";
import "./adminRssFeeds.css";
import "../Users/usersPage.css";

type AdminCronJobsSectionProps = {
  idPrefix: string;
  discoveryStatus: ServiceState;
  onScheduleSaved?: (job: CronJobRow) => void | Promise<void>;
  onScheduleStopped?: () => void | Promise<void>;
};

type CronSubTab = "schedule" | "logs";

function feedSummaryMatchesSearch(
  feed: CronFeedLogSummary,
  search: string,
): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    feed.ingestLinkId,
    feed.feedName ?? "",
    feed.feedUrl,
    feed.extractedCount,
    feed.pendingCount,
    feed.runningCount,
    feed.executedCount,
    feed.failedCount,
    feed.skippedCount,
    feed.lastActivityAt ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

const WEEKDAY_OPTIONS = [
  { value: 1, label: "M", full: "Monday" },
  { value: 2, label: "T", full: "Tuesday" },
  { value: 3, label: "W", full: "Wednesday" },
  { value: 4, label: "T", full: "Thursday" },
  { value: 5, label: "F", full: "Friday" },
  { value: 6, label: "S", full: "Saturday" },
  { value: 0, label: "S", full: "Sunday" },
] as const;

const REPEAT_UNIT_OPTIONS: { value: RepeatUnit; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
];

function unitLabel(unit: RepeatUnit, interval: number): string {
  const base =
    REPEAT_UNIT_OPTIONS.find((option) => option.value === unit)?.label.toLowerCase() ??
    unit;
  return interval === 1 ? base : `${base}s`;
}

function openNativeDatePicker(input: HTMLInputElement | null) {
  if (!input) return;
  if (typeof input.showPicker === "function") {
    try {
      input.showPicker();
      return;
    } catch {
      // showPicker may throw outside a user gesture
    }
  }
  input.focus();
  input.click();
}

function feedMatchesSearch(feed: IngestLinkRow, search: string): boolean {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  const haystack = [
    feed.id,
    feed.url,
    feed.suggestedName ?? "",
    feed.itemCount,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function scheduleFromJob(job: CronJobRow | null): SaveCronScheduleInput {
  const schedule = job?.schedule;
  const userTimezone = browserTimezone();
  const base: SaveCronScheduleInput = {
    startDate: todayInTimezone(userTimezone),
    startTime: normalizeCronTime("10:30"),
    timezone: userTimezone,
    repeat: schedule?.repeat ?? true,
    repeatInterval: schedule?.repeatInterval ?? 1,
    repeatUnit: schedule?.repeatUnit ?? "day",
    repeatDays: schedule?.repeatDays?.length ? [...schedule.repeatDays] : [],
    ingestLinkIds: schedule?.ingestLinkIds?.length
      ? [...schedule.ingestLinkIds]
      : [],
  };

  const savedStartDate = schedule?.startDate?.trim();
  const savedStartTime = schedule?.startTime?.trim();
  if (!savedStartDate || !savedStartTime) {
    return base;
  }

  return toUserSchedule(
    {
      ...base,
      startDate: savedStartDate,
      startTime: normalizeCronTime(savedStartTime),
      timezone: schedule?.timezone?.trim() || CRON_SCHEDULE_TIMEZONE,
    },
    userTimezone,
  );
}

function normalizeScheduleForCompare(
  input: SaveCronScheduleInput,
): SaveCronScheduleInput {
  return {
    ...input,
    repeatDays: [...input.repeatDays].sort((a, b) => a - b),
    ingestLinkIds: [...input.ingestLinkIds].sort((a, b) => a - b),
  };
}

function schedulesEqual(
  left: SaveCronScheduleInput,
  right: SaveCronScheduleInput,
): boolean {
  const a = normalizeScheduleForCompare(left);
  const b = normalizeScheduleForCompare(right);
  return (
    a.startDate === b.startDate &&
    a.startTime === b.startTime &&
    a.timezone === b.timezone &&
    a.repeat === b.repeat &&
    a.repeatInterval === b.repeatInterval &&
    a.repeatUnit === b.repeatUnit &&
    a.repeatDays.join(",") === b.repeatDays.join(",") &&
    a.ingestLinkIds.join(",") === b.ingestLinkIds.join(",")
  );
}

export function AdminCronJobsSection({
  idPrefix,
  discoveryStatus,
  onScheduleSaved,
  onScheduleStopped,
}: AdminCronJobsSectionProps) {
  const [job, setJob] = useState<CronJobRow | null>(null);
  const [form, setForm] = useState<SaveCronScheduleInput>(scheduleFromJob(null));
  const [savedForm, setSavedForm] = useState<SaveCronScheduleInput>(
    scheduleFromJob(null),
  );
  const [rssFeeds, setRssFeeds] = useState<IngestLinkRow[]>([]);
  const [feedSearchQuery, setFeedSearchQuery] = useState("");
  const [feedsLoading, setFeedsLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cronTab, setCronTab] = useState<CronSubTab>("schedule");
  const [feedSummaries, setFeedSummaries] = useState<CronFeedLogSummary[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsRefreshing, setLogsRefreshing] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [feedSummarySearch, setFeedSummarySearch] = useState("");
  const [startTimeListOpen, setStartTimeListOpen] = useState(false);
  const [startTimeListPosition, setStartTimeListPosition] = useState({
    top: 0,
    left: 0,
    width: 0,
  });
  const startTimeComboRef = useRef<HTMLDivElement>(null);
  const startTimeListRef = useRef<HTMLUListElement>(null);
  const startDateRef = useRef<HTMLInputElement>(null);

  const activeFeeds = useMemo(
    () => rssFeeds.filter((feed) => !feed.archived),
    [rssFeeds],
  );

  const filteredFeeds = useMemo(
    () => activeFeeds.filter((feed) => feedMatchesSearch(feed, feedSearchQuery)),
    [activeFeeds, feedSearchQuery],
  );

  const selectedFeedIds = useMemo(
    () => new Set(form.ingestLinkIds),
    [form.ingestLinkIds],
  );

  const allFilteredSelected =
    filteredFeeds.length > 0 &&
    filteredFeeds.every((feed) => selectedFeedIds.has(feed.id));

  const scheduleSummary = useMemo(
    () => formatCronScheduleSummary(form),
    [form],
  );

  const isFormDirty = useMemo(
    () => !schedulesEqual(form, savedForm),
    [form, savedForm],
  );

  const scheduleActive = job?.schedule?.active ?? false;
  const cronLoopRunning = job?.running ?? false;

  const canSaveCron = useMemo(() => {
    if (form.ingestLinkIds.length === 0) return false;
    if (!scheduleActive) return true;
    if (!cronLoopRunning) return true;
    return isFormDirty;
  }, [
    form.ingestLinkIds.length,
    cronLoopRunning,
    isFormDirty,
    scheduleActive,
  ]);

  const scheduleTimezone = browserTimezone();

  const cronStatusLabel = useMemo(() => {
    if (!scheduleActive) {
      return discoveryStatus === "running"
        ? "Discovery running (no schedule)"
        : "Not scheduled";
    }
    const runState =
      cronLoopRunning || discoveryStatus === "running"
        ? serviceStatusLabel(discoveryStatus)
        : "Waiting";
    return `Scheduled · ${runState}`;
  }, [cronLoopRunning, discoveryStatus, scheduleActive]);

  const cronStatusPill = useMemo(() => {
    if (!scheduleActive) {
      return serviceStatusPillClass(discoveryStatus);
    }
    if (cronLoopRunning || discoveryStatus === "running") {
      return serviceStatusPillClass(discoveryStatus);
    }
    return serviceStatusPillClass("stopped");
  }, [cronLoopRunning, discoveryStatus, scheduleActive]);

  const canStopCron = useMemo(() => {
    const discoveryUp =
      discoveryStatus === "running" ||
      discoveryStatus === "starting" ||
      discoveryStatus === "stopping";
    return scheduleActive || discoveryUp;
  }, [discoveryStatus, scheduleActive]);

  const maxStartDate = useMemo(
    () => todayInTimezone(scheduleTimezone),
    [scheduleTimezone],
  );

  const startTimeOptions = useMemo(
    () => buildCronTimeSelectOptions(form.startTime),
    [form.startTime],
  );

  const setStartTime = useCallback((value: string) => {
    const normalized = normalizeCronTime(value);
    setForm((current) => ({ ...current, startTime: normalized }));
  }, []);

  const updateStartTimeListPosition = useCallback(() => {
    const anchor = startTimeComboRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    setStartTimeListPosition({
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    });
  }, []);

  useLayoutEffect(() => {
    if (!startTimeListOpen) return;
    updateStartTimeListPosition();
  }, [startTimeListOpen, updateStartTimeListPosition]);

  useEffect(() => {
    if (!startTimeListOpen) return;

    const onDocMouse = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        startTimeComboRef.current?.contains(target) ||
        startTimeListRef.current?.contains(target)
      ) {
        return;
      }
      setStartTimeListOpen(false);
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setStartTimeListOpen(false);
    };

    const onLayout = () => updateStartTimeListPosition();

    document.addEventListener("mousedown", onDocMouse);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onLayout);
    window.addEventListener("scroll", onLayout, true);
    return () => {
      document.removeEventListener("mousedown", onDocMouse);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onLayout);
      window.removeEventListener("scroll", onLayout, true);
    };
  }, [startTimeListOpen, updateStartTimeListPosition]);

  const loadFeeds = useCallback(async () => {
    const result = await fetchIngestLinks();
    if (!result.ok) {
      setRssFeeds([]);
      return;
    }
    setRssFeeds(result.links);
  }, []);

  const loadJobs = useCallback(async (options?: { preserveForm?: boolean }) => {
    const result = await fetchCronJobs();
    if (!result.ok) {
      setError(result.message);
      setJob(null);
      return;
    }
    setError(null);
    const nextJob = result.jobs[0] ?? null;
    const nextForm = scheduleFromJob(nextJob);
    setJob(nextJob);
    if (options?.preserveForm) {
      setSavedForm(nextForm);
      return;
    }
    setForm(nextForm);
    setSavedForm(nextForm);
  }, []);

  const loadCronLogs = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) setLogsLoading(true);
    else setLogsRefreshing(true);
    setLogsError(null);
    try {
      const result = await fetchCronJobLogs();
      if (!result.ok) {
        setFeedSummaries([]);
        setLogsError(result.message);
        return;
      }
      setFeedSummaries(result.feeds);
    } catch {
      setFeedSummaries([]);
      if (!silent) {
        toast.error("Network error while loading CRON job logs.", {
          autoClose: 3000,
        });
      }
    } finally {
      setLogsLoading(false);
      setLogsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setFeedsLoading(true);
      await Promise.all([loadJobs(), loadFeeds()]);
      if (!cancelled) {
        setLoading(false);
        setFeedsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadFeeds, loadJobs]);

  useEffect(() => {
    if (loading || feedsLoading) return;
    const activeIds = new Set(activeFeeds.map((feed) => feed.id));
    const stripInactiveFeedIds = (current: SaveCronScheduleInput) => {
      const filtered = current.ingestLinkIds.filter((id) => activeIds.has(id));
      if (filtered.length === current.ingestLinkIds.length) return current;
      return { ...current, ingestLinkIds: filtered };
    };
    setForm(stripInactiveFeedIds);
    setSavedForm(stripInactiveFeedIds);
  }, [activeFeeds, feedsLoading, loading]);

  useEffect(() => {
    if (cronTab !== "logs" || loading) return;
    void loadCronLogs();
  }, [cronTab, loadCronLogs, loading]);

  useEffect(() => {
    if (cronTab !== "logs" || loading) return;
    void loadCronLogs({ silent: true });
  }, [discoveryStatus, cronTab, loadCronLogs, loading]);

  const scheduledFeedIds = useMemo(
    () => job?.schedule?.ingestLinkIds ?? [],
    [job?.schedule?.ingestLinkIds],
  );

  const filteredFeedSummaries = useMemo(
    () =>
      feedSummaries.filter((feed) =>
        feedSummaryMatchesSearch(feed, feedSummarySearch),
      ),
    [feedSummaries, feedSummarySearch],
  );

  const titleId = `${idPrefix}-cron-jobs-title`;
  const startDateId = `${idPrefix}-cron-start-date`;
  const startTimeId = `${idPrefix}-cron-start-time`;
  const repeatId = `${idPrefix}-cron-repeat`;
  const repeatIntervalId = `${idPrefix}-cron-repeat-interval`;
  const repeatUnitId = `${idPrefix}-cron-repeat-unit`;
  const feedSearchId = `${idPrefix}-cron-feed-search`;
  const feedsListId = `${idPrefix}-cron-feeds`;

  const hasFeedSearch = feedSearchQuery.trim().length > 0;

  const toggleDay = (day: number) => {
    setForm((current) => {
      const selected = new Set(current.repeatDays);
      if (selected.has(day)) {
        selected.delete(day);
      } else {
        selected.add(day);
      }
      return { ...current, repeatDays: [...selected].sort((a, b) => a - b) };
    });
  };

  const toggleFeed = (feedId: number, checked: boolean) => {
    setForm((current) => {
      const selected = new Set(current.ingestLinkIds);
      if (checked) {
        selected.add(feedId);
      } else {
        selected.delete(feedId);
      }
      return {
        ...current,
        ingestLinkIds: [...selected].sort((a, b) => a - b),
      };
    });
  };

  const toggleFilteredFeeds = (checked: boolean) => {
    setForm((current) => {
      const selected = new Set(current.ingestLinkIds);
      for (const feed of filteredFeeds) {
        if (checked) {
          selected.add(feed.id);
        } else {
          selected.delete(feed.id);
        }
      }
      return {
        ...current,
        ingestLinkIds: [...selected].sort((a, b) => a - b),
      };
    });
  };

  const handleSave = async () => {
    if (saving || !canSaveCron) return;
    if (form.ingestLinkIds.length === 0) {
      toast.error("Select at least one RSS feed.", { autoClose: 2800 });
      return;
    }
    const timezone = browserTimezone();
    const today = todayInTimezone(timezone);
    if (form.startDate > today) {
      toast.error(
        `Start date must be on or before today (${today}) in ${formatTimezoneOption(timezone)}.`,
        { autoClose: 3500 },
      );
      return;
    }
    const payload: SaveCronScheduleInput = {
      ...form,
      startDate: form.startDate,
      startTime: normalizeCronTime(form.startTime),
      timezone,
    };
    if (
      form.repeat &&
      form.repeatUnit === "week" &&
      form.repeatDays.length === 0
    ) {
      toast.error("Select at least one day for a weekly repeat.", {
        autoClose: 2800,
      });
      return;
    }
    if (form.repeatInterval < 1) {
      toast.error("Repeat interval must be at least 1.", { autoClose: 2800 });
      return;
    }
    setSaving(true);
    try {
      const result = await saveCronJobSchedule("rss-discovery", payload);
      if (!result.ok) {
        toast.error(result.message, { autoClose: 3500 });
        return;
      }
      const nextForm = scheduleFromJob(result.job);
      setJob(result.job);
      setForm(nextForm);
      setSavedForm(nextForm);
      await onScheduleSaved?.(result.job);
      if (cronTab === "logs") {
        void loadCronLogs({ silent: true });
      }
      toastCronJobScheduled(
        formatCronSaveToastMessage(
          payload.ingestLinkIds.length,
          payload,
          result.job,
        ),
      );
      void requestNotificationsReload({ silent: true });
    } catch {
      toast.error("Network error while saving CRON job.", { autoClose: 3000 });
    } finally {
      setSaving(false);
    }
  };

  const handleStop = async () => {
    if (stopping || !canStopCron) return;
    setStopping(true);
    try {
      const result = await stopCronJobSchedule("rss-discovery");
      if (!result.ok) {
        toast.error(result.message, { autoClose: 3500 });
        return;
      }
      const nextForm = scheduleFromJob(result.job);
      setJob(result.job);
      setForm(nextForm);
      setSavedForm(nextForm);
      await onScheduleStopped?.();
      toast.success(result.message, { autoClose: 3200 });
      toastCronJobStopped();
    } catch {
      toast.error("Network error while stopping CRON job.", { autoClose: 3000 });
    } finally {
      setStopping(false);
    }
  };

  return (
    <section className="adminPage__card adminPage__cronCard" aria-labelledby={titleId}>
      <div className="adminPage__cardHead adminPage__cardHead--split">
        <div className="adminPage__cardHeadMain">
          <span className="settingsPage__cardIconWrap" aria-hidden>
            <Clock size={20} strokeWidth={2} />
          </span>
          <div className="adminPage__cardHeadText">
            <h2 id={titleId} className="adminPage__cardTitle">
              CRON jobs
            </h2>
            <p className="adminPage__cardHint">
              Schedule automated RSS discovery for selected feeds. Discovery
              runs at the scheduled time; the worker starts when jobs are
              queued.
            </p>
          </div>
        </div>
        <span
          role="status"
          className={`adminPage__statusPill ${cronStatusPill}`}
          aria-live="polite"
        >
          <span className="adminPage__statusPillDot" aria-hidden />
          {cronStatusLabel}
        </span>
      </div>

      {!loading && !error ? (
        <div className="adminPage__cronTabsRow">
          <div
            className="adminPage__tabs adminPage__tabs--sub"
            role="tablist"
            aria-label="CRON job sections"
          >
            <button
              type="button"
              role="tab"
              aria-selected={cronTab === "schedule"}
              className={`adminPage__tab${cronTab === "schedule" ? " adminPage__tab--selected" : ""}`}
              onClick={() => setCronTab("schedule")}
            >
              Schedule
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={cronTab === "logs"}
              className={`adminPage__tab${cronTab === "logs" ? " adminPage__tab--selected" : ""}`}
              onClick={() => setCronTab("logs")}
            >
              Logs
            </button>
          </div>
          {cronTab === "logs" ? (
            <button
              type="button"
              className="usersPage__inviteBtn adminPage__rssRefreshBtn"
              onClick={() => void loadCronLogs({ silent: true })}
              disabled={logsLoading || logsRefreshing}
              aria-busy={logsLoading || logsRefreshing}
            >
              <RefreshCw
                size={16}
                strokeWidth={2}
                className={
                  logsRefreshing ? "pageHeader__refreshIcon--spin" : undefined
                }
                aria-hidden
              />
              Refresh
            </button>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <p className="adminPage__cronMeta">Loading schedule…</p>
      ) : error ? (
        <p className="adminPage__cronMeta adminPage__cronMeta--error" role="alert">
          {error}
        </p>
      ) : (
        cronTab === "logs" ? (
          <div className="adminPage__cronBody adminPage__cronBody--logs">
            {scheduledFeedIds.length === 0 ? (
              <div className="adminPage__cronEmpty">
                <p>No RSS feeds are scheduled yet.</p>
                <p>Select feeds on the Schedule tab and save to view run logs.</p>
              </div>
            ) : (
              <AdminDataTable
                ariaLabel="Scheduled feed run summary"
                wrapClassName="adminPage__tableWrap--cronFeeds"
                filters={
                  <section
                    className="adminPage__dataFilters"
                    aria-label="Filter scheduled feeds"
                  >
                    <div className="adminPage__logsSearchWrap">
                      <Search
                        className="adminPage__logsSearchIcon"
                        size={18}
                        strokeWidth={2}
                        aria-hidden
                      />
                      <input
                        id={`${idPrefix}-cron-feed-summary-search`}
                        type="search"
                        className="adminPage__logsSearchInput"
                        placeholder="Search feed ID, name, or URL…"
                        value={feedSummarySearch}
                        onChange={(e) => setFeedSummarySearch(e.target.value)}
                        autoComplete="off"
                        enterKeyHint="search"
                        aria-label="Search scheduled feeds"
                      />
                    </div>
                  </section>
                }
              >
                <table className="adminPage__table adminPage__table--cronFeeds">
                    <thead>
                      <tr>
                        <th scope="col" className="adminPage__th">
                          Feed
                        </th>
                        <th scope="col" className="adminPage__th">
                          URL
                        </th>
                        <th
                          scope="col"
                          className="adminPage__th adminPage__th--center"
                        >
                          Extracted
                        </th>
                        <th
                          scope="col"
                          className="adminPage__th adminPage__th--center"
                        >
                          Pending
                        </th>
                        <th
                          scope="col"
                          className="adminPage__th adminPage__th--center"
                        >
                          Running
                        </th>
                        <th
                          scope="col"
                          className="adminPage__th adminPage__th--center"
                        >
                          Executed
                        </th>
                        <th
                          scope="col"
                          className="adminPage__th adminPage__th--center"
                        >
                          Failed
                        </th>
                        <th scope="col" className="adminPage__th">
                          Last activity
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {logsLoading && filteredFeedSummaries.length === 0 ? (
                        <tr>
                          <td
                            className="adminPage__td adminPage__emptyCell"
                            colSpan={8}
                          >
                            Loading CRON job logs…
                          </td>
                        </tr>
                      ) : logsError ? (
                        <tr>
                          <td
                            className="adminPage__td adminPage__emptyCell adminPage__cronMeta--error"
                            colSpan={8}
                            role="alert"
                          >
                            {logsError}
                          </td>
                        </tr>
                      ) : filteredFeedSummaries.length === 0 ? (
                        <tr>
                          <td
                            className="adminPage__td adminPage__emptyCell"
                            colSpan={8}
                          >
                            {feedSummarySearch.trim()
                              ? "No scheduled feeds match your search."
                              : "No run activity yet for scheduled feeds."}
                          </td>
                        </tr>
                      ) : (
                        filteredFeedSummaries.map((feed) => (
                          <tr key={feed.ingestLinkId}>
                            <td className="adminPage__td">
                              <span className="adminPage__id">#{feed.ingestLinkId}</span>
                              <span className="adminPage__cronFeedName">
                                {feed.feedName || "Untitled feed"}
                              </span>
                            </td>
                            <td className="adminPage__td">
                              <span
                                className="adminPage__cellUrl adminPage__cronFeedUrl"
                                title={feed.feedUrl}
                              >
                                {feed.feedUrl || "—"}
                              </span>
                            </td>
                            <td className="adminPage__td adminPage__th--center">
                              {feed.extractedCount}
                            </td>
                            <td className="adminPage__td adminPage__th--center">
                              {feed.pendingCount}
                            </td>
                            <td className="adminPage__td adminPage__th--center">
                              {feed.runningCount}
                            </td>
                            <td className="adminPage__td adminPage__th--center">
                              {feed.executedCount}
                            </td>
                            <td className="adminPage__td adminPage__th--center">
                              {feed.failedCount}
                            </td>
                            <td className="adminPage__td adminPage__cellMuted">
                              {formatJobExecutedAt(feed.lastActivityAt)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
              </AdminDataTable>
            )}
          </div>
        ) : (
        <div className="adminPage__cronBody">
          <div className="adminPage__cronLayout">
            <div className="adminPage__cronPanel">
              <div className="adminPage__cronSectionHead">
                <div className="adminPage__cronSectionTitleWrap">
                  <Rss size={15} strokeWidth={2} aria-hidden />
                  <h3 className="adminPage__cronSectionTitle">RSS feeds</h3>
                </div>
                {activeFeeds.length > 0 ? (
                  <span className="adminPage__cronBadge">
                    {form.ingestLinkIds.length} selected
                  </span>
                ) : null}
              </div>

              {feedsLoading ? (
                <p className="adminPage__cronMeta">Loading RSS feeds…</p>
              ) : activeFeeds.length === 0 ? (
                <div className="adminPage__cronEmpty">
                  <p>No active RSS feeds yet.</p>
                  <p>Add feeds on the RSS Feeds tab, then return here to schedule them.</p>
                </div>
              ) : (
                <>
                  <div className="adminPage__cronFeedsToolbar">
                    <div className="adminPage__cronSearchWrap">
                      <Search
                        className="adminPage__cronSearchIcon"
                        size={16}
                        strokeWidth={2}
                        aria-hidden
                      />
                      <input
                        id={feedSearchId}
                        type="search"
                        className="adminPage__cronSearchInput"
                        placeholder="Search feed ID, name, or URL…"
                        value={feedSearchQuery}
                        onChange={(e) => setFeedSearchQuery(e.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                        enterKeyHint="search"
                        aria-label="Search RSS feeds"
                      />
                      {hasFeedSearch ? (
                        <button
                          type="button"
                          className="adminPage__cronSearchClear"
                          onClick={() => setFeedSearchQuery("")}
                          aria-label="Clear feed search"
                        >
                          <X size={15} strokeWidth={2} aria-hidden />
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <div className="adminPage__cronFeedsPanel">
                    <label className="adminPage__cronFeedRow adminPage__cronFeedRow--all">
                      <input
                        type="checkbox"
                        checked={allFilteredSelected}
                        onChange={(e) => toggleFilteredFeeds(e.target.checked)}
                        disabled={saving || filteredFeeds.length === 0}
                      />
                      <span className="adminPage__cronFeedAllLabel">
                        {hasFeedSearch
                          ? `Select visible (${filteredFeeds.length})`
                          : "Select all feeds"}
                      </span>
                    </label>

                    {filteredFeeds.length === 0 ? (
                      <p className="adminPage__cronFeedEmpty">
                        No feeds match your search.
                      </p>
                    ) : (
                      <ul
                        id={feedsListId}
                        className="adminPage__cronFeedList"
                        role="list"
                        aria-label="RSS feeds"
                      >
                        {filteredFeeds.map((feed) => {
                          const feedInputId = `${idPrefix}-cron-feed-${feed.id}`;
                          const checked = selectedFeedIds.has(feed.id);
                          return (
                            <li key={feed.id}>
                              <label
                                className={`adminPage__cronFeedRow${checked ? " adminPage__cronFeedRow--selected" : ""}`}
                                htmlFor={feedInputId}
                              >
                                <input
                                  id={feedInputId}
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) =>
                                    toggleFeed(feed.id, e.target.checked)
                                  }
                                  disabled={saving}
                                />
                                <span className="adminPage__cronFeedMain">
                                  <span className="adminPage__cronFeedName">
                                    {feed.suggestedName?.trim() || "Untitled feed"}
                                  </span>
                                  <span
                                    className="adminPage__cronFeedUrl"
                                    title={feed.url}
                                  >
                                    {feed.url}
                                  </span>
                                </span>
                                <span className="adminPage__cronFeedMeta">
                                  <span className="adminPage__cronFeedId">
                                    #{feed.id}
                                  </span>
                                  <span className="adminPage__cronFeedCount">
                                    {feed.itemCount}
                                  </span>
                                </span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="adminPage__cronPanel">
              <div className="adminPage__cronSectionHead">
                <div className="adminPage__cronSectionTitleWrap">
                  <Calendar
                    className="adminPage__cronFieldIcon"
                    size={15}
                    strokeWidth={2}
                    aria-hidden
                  />
                  <h3 className="adminPage__cronSectionTitle">Schedule</h3>
                </div>
              </div>

              <div className="adminPage__cronFormTop adminPage__cronFormTop--schedule">
                <div className="adminPage__cronDateTimeRow">
                  <div className="adminPage__cronField">
                    <label
                      className="adminPage__cronFieldLabel"
                      htmlFor={startDateId}
                    >
                      Start date
                    </label>
                    <div className="adminPage__cronInputWrap adminPage__cronInputWrap--native adminPage__cronInputWrap--date">
                      <Calendar
                        className="adminPage__cronFieldIcon"
                        size={15}
                        strokeWidth={2}
                        aria-hidden
                      />
                      <input
                        ref={startDateRef}
                        id={startDateId}
                        type="date"
                        className="adminPage__cronInput adminPage__cronInput--native"
                        value={form.startDate}
                        max={maxStartDate}
                        onChange={(e) =>
                          setForm((current) => ({
                            ...current,
                            startDate: clampStartDateForTimezone(
                              e.target.value,
                              browserTimezone(),
                            ),
                          }))
                        }
                      />
                      <button
                        type="button"
                        className="adminPage__cronFieldIconBtn"
                        onClick={() => openNativeDatePicker(startDateRef.current)}
                        aria-label="Open date picker"
                      >
                        <Calendar
                          className="adminPage__cronFieldIcon"
                          size={15}
                          strokeWidth={2}
                          aria-hidden
                        />
                      </button>
                    </div>
                    {/* <p className="adminPage__cronFieldHint">
                      Anchor date for repeat schedules. Saved value is kept when
                      you update feeds or recurrence.
                    </p> */}
                  </div>

                  <div className="adminPage__cronField">
                    <label
                      className="adminPage__cronFieldLabel"
                      htmlFor={startTimeId}
                    >
                      Start time
                    </label>
                    <div
                      ref={startTimeComboRef}
                      className={`adminPage__cronInputWrap adminPage__cronInputWrap--native adminPage__cronInputWrap--timeCombo${
                        startTimeListOpen
                          ? " adminPage__cronInputWrap--timeComboOpen"
                          : ""
                      }`}
                    >
                      <Clock
                        className="adminPage__cronFieldIcon"
                        size={15}
                        strokeWidth={2}
                        aria-hidden
                      />
                      <input
                        id={startTimeId}
                        type="time"
                        className="adminPage__cronInput adminPage__cronInput--native adminPage__cronTimeComboInput"
                        value={form.startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                        onClick={() => {
                          updateStartTimeListPosition();
                          setStartTimeListOpen(true);
                        }}
                        onFocus={() => {
                          updateStartTimeListPosition();
                          setStartTimeListOpen(true);
                        }}
                        aria-expanded={startTimeListOpen}
                        aria-haspopup="listbox"
                        aria-controls={`${startTimeId}-list`}
                      />
                      <button
                        type="button"
                        className="adminPage__cronTimeComboToggle"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          updateStartTimeListPosition();
                          setStartTimeListOpen((open) => !open);
                        }}
                        aria-label="Show start time presets"
                        aria-expanded={startTimeListOpen}
                        aria-controls={`${startTimeId}-list`}
                      >
                        <ChevronDown size={16} strokeWidth={2} aria-hidden />
                      </button>
                      {startTimeListOpen
                        ? createPortal(
                            <ul
                              ref={startTimeListRef}
                              id={`${startTimeId}-list`}
                              className="adminPage__cronTimeComboList adminPage__cronTimeComboList--portal"
                              role="listbox"
                              aria-label="Start time presets"
                              style={{
                                top: startTimeListPosition.top,
                                left: startTimeListPosition.left,
                                width: startTimeListPosition.width,
                              }}
                            >
                              {startTimeOptions.map((option) => (
                                <li key={option.value} role="none">
                                  <button
                                    type="button"
                                    role="option"
                                    aria-selected={
                                      option.value === form.startTime
                                    }
                                    className={`adminPage__cronTimeComboOption${
                                      option.value === form.startTime
                                        ? " adminPage__cronTimeComboOption--active"
                                        : ""
                                    }`}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => {
                                      setStartTime(option.value);
                                      setStartTimeListOpen(false);
                                    }}
                                  >
                                    {option.label}
                                  </button>
                                </li>
                              ))}
                            </ul>,
                            document.body,
                          )
                        : null}
                    </div>
                    {/* <p className="adminPage__cronFieldHint">
                      Shown in {formatTimezoneOption(scheduleTimezone)}. Saved and
                      run in {formatTimezoneOption(CRON_SCHEDULE_TIMEZONE)} at the
                      same moment you choose here.
                    </p> */}
                  </div>
                </div>
              </div>

              <div className="adminPage__cronRecurrence">
                <div className="adminPage__cronRecurrenceHead">
                  <p className="adminPage__cronRecurrenceTitle">Recurrence</p>
                  <div className="adminPage__cronRepeatRow">
                    <label className="adminPage__cronRepeatLabel" htmlFor={repeatId}>
                      Repeat
                    </label>
                    <button
                      id={repeatId}
                      type="button"
                      role="switch"
                      aria-checked={form.repeat}
                      className={`settingsPage__switch${form.repeat ? " settingsPage__switch--on" : ""}`}
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          repeat: !current.repeat,
                        }))
                      }
                    >
                      <span className="settingsPage__switchThumb" aria-hidden />
                    </button>
                  </div>
                </div>

                {form.repeat ? (
                  <div className="adminPage__cronRecurrenceBody">
                    <div className="adminPage__cronRepeatEvery">
                      <span className="adminPage__cronRepeatEveryLabel">
                        Repeat every
                      </span>
                      <input
                        id={repeatIntervalId}
                        type="number"
                        min={1}
                        max={365}
                        className="adminPage__cronRepeatInterval"
                        value={form.repeatInterval}
                        onChange={(e) => {
                          const next = Number.parseInt(e.target.value, 10);
                          setForm((current) => ({
                            ...current,
                            repeatInterval:
                              Number.isFinite(next) && next > 0 ? next : 1,
                          }));
                        }}
                      />
                      <span className="adminPage__cronRepeatUnitText">
                        {unitLabel(form.repeatUnit, form.repeatInterval)}
                      </span>
                    </div>

                    <div
                      id={repeatUnitId}
                      className="adminPage__cronUnitOptions"
                      role="group"
                      aria-label="Repeat unit"
                    >
                      {REPEAT_UNIT_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={`adminPage__cronUnitBtn${form.repeatUnit === option.value ? " adminPage__cronUnitBtn--selected" : ""}`}
                          aria-pressed={form.repeatUnit === option.value}
                          onClick={() =>
                            setForm((current) => {
                              const repeatUnit = option.value;
                              if (repeatUnit !== "week") {
                                return { ...current, repeatUnit };
                              }
                              const todayWeekday = weekdayInTimezone(
                                current.timezone,
                              );
                              return {
                                ...current,
                                repeatUnit,
                                repeatDays:
                                  current.repeatDays.length > 0
                                    ? current.repeatDays
                                    : [todayWeekday],
                              };
                            })
                          }
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>

                    {form.repeatUnit === "week" ? (
                      <div
                        className="adminPage__cronDayList"
                        role="group"
                        aria-label="Repeat on days"
                      >
                        {WEEKDAY_OPTIONS.map((day) => {
                          const selected = form.repeatDays.includes(day.value);
                          return (
                            <button
                              key={day.value}
                              type="button"
                              className={`adminPage__cronDayBtn${selected ? " adminPage__cronDayBtn--selected" : ""}`}
                              aria-pressed={selected}
                              aria-label={day.full}
                              onClick={() => toggleDay(day.value)}
                            >
                              {day.label}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}

                    {form.repeatUnit === "month" || form.repeatUnit === "year" ? (
                      <p className="adminPage__cronRecurrenceHint">
                        Choose the start date and start time above.
                      </p>
                    ) : null}

                    <div className="adminPage__cronSummary" role="status">
                      <RefreshCw size={15} strokeWidth={2} aria-hidden />
                      <span>{scheduleSummary}</span>
                    </div>
                  </div>
                ) : (
                  <p className="adminPage__cronRecurrenceHint">
                    Runs once on the start date at the start time.
                  </p>
                )}

                <p className="adminPage__cronNote">
                  <Infinity size={14} strokeWidth={2} aria-hidden />
                  <span>Runs indefinitely — no end date required.</span>
                </p>
              </div>
            </div>
          </div>

          <div className="adminPage__cronFooter">
            <p className="adminPage__cronFooterHint">
              {scheduleSummary}
            </p>
            <div className="adminPage__cronFooterActions">
              <button
                type="button"
                className="usersPage__btn usersPage__btn--logoutTone adminPage__cronStopBtn"
                onClick={() => void handleStop()}
                disabled={stopping || saving || !canStopCron}
                aria-busy={stopping}
              >
                <Square size={14} strokeWidth={2} aria-hidden />
                {stopping ? "Stopping…" : "Stop CRON job"}
              </button>
              <button
                type="button"
                className="usersPage__btn usersPage__btn--primary usersPage__btn--inviteSend adminPage__cronSaveBtn"
                onClick={() => void handleSave()}
                disabled={
                  saving || stopping || activeFeeds.length === 0 || !canSaveCron
                }
                aria-busy={saving}
              >
                <Save size={16} strokeWidth={2} aria-hidden />
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
        )
      )}
    </section>
  );
}
