import { useCallback, useEffect, useId, useState } from "react";
import { toast } from "react-toastify";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Cpu,
  Database,
  Download,
  RotateCw,
  Rss,
  Settings2,
  Trash2,
  Upload,
  Workflow,
} from "lucide-react";
import { authFetch } from "../../../utils/authFetch";
import { startEtlReportsRun } from "../../../utils/etlReportsApi";
import { setDocumentPageTitle } from "../../../utils/pageTitle";
import { PageHeader } from "../../Layout/PageHeader";
import {
  SettingsAboutSection,
  SettingsApiSection,
  SettingsSections,
} from "../Settings/SettingsSections";
import "../Users/usersPage.css";
import "../Settings/settingsPage.css";
import { AdminCronJobsSection } from "./AdminCronJobsSection";
import { AdminRssFeedsSection } from "./AdminRssFeedsSection";
import { EtlSection } from "./etl/EtlSection";
import { AdminServiceRow } from "./AdminServiceRow";
import {
  DEFAULT_API_STATUS,
  displayServiceStatus,
  readServiceApiStatus,
  waitForWorkerRunning,
  waitForDiscoveryAndWorkerRunning,
  waitForServiceApiState,
  type ApiServiceState,
  type PendingAction,
  type ServiceKey,
} from "./adminServices";
import { ModelCompatibilityChecker } from "./ModelCompatibilityChecker";
import "./adminPage.css";

type AdminTab = "controls" | "rss" | "etl";
type RssSubTab = "links" | "logs";

const ADMIN_TABS: { key: AdminTab; label: string; icon: LucideIcon }[] = [
  { key: "controls", label: "Controls", icon: Settings2 },
  { key: "rss", label: "RSS Feeds", icon: Rss },
  { key: "etl", label: "ETL", icon: Workflow },
];

export function AdminPage() {
  const baseId = useId();
  const [tab, setTab] = useState<AdminTab>("controls");
  const [rssTab, setRssTab] = useState<RssSubTab>("links");
  const [apiStatus, setApiStatus] =
    useState<Record<ServiceKey, ApiServiceState>>(DEFAULT_API_STATUS);
  const [pendingAction, setPendingAction] = useState<
    Partial<Record<ServiceKey, PendingAction>>
  >({});
  // const [incidentsFile, setIncidentsFile] = useState<File | null>(null);
  // const [reportsFile, setReportsFile] = useState<File | null>(null);
  // const [dryRun, setDryRun] = useState(false);
  const [backupFile, setBackupFile] = useState<File | null>(null);
  const [resetConfirm, setResetConfirm] = useState("");
  useEffect(() => {
    const activeTab = ADMIN_TABS.find((item) => item.key === tab);
    setDocumentPageTitle(activeTab?.label ?? "Controls");
  }, [tab]);

  const loadServiceStatus = useCallback(async () => {
    const token = sessionStorage.getItem("accessToken");
    if (!token) return;

    try {
      const status = await readServiceApiStatus();
      if (status) {
        setApiStatus(status);
      }
    } catch {
      // ignore polling errors
    }
  }, []);

  useEffect(() => {
    void loadServiceStatus();
    const timer = window.setInterval(() => void loadServiceStatus(), 10_000);
    return () => window.clearInterval(timer);
  }, [loadServiceStatus]);

  const fid = (name: string) => `${baseId}-${name}`;

  const stub = useCallback((action: string) => {
    toast.info(`${action} is not connected to the API yet.`, {
      autoClose: 3200,
    });
  }, []);

  const clearPending = useCallback((key: ServiceKey) => {
    setPendingAction((pending) => {
      if (!pending[key]) return pending;
      const next = { ...pending };
      delete next[key];
      return next;
    });
  }, []);

  const handleReportsStart = async (selection: {
    uploadIds: number[];
    reportIds: number[];
  }) => {
    setPendingAction((pending) => ({ ...pending, worker: "starting" }));

    try {
      const result = await startEtlReportsRun(selection);
      if (!result.ok) {
        clearPending("worker");
        toast.error(result.message, { autoClose: 3500 });
        void loadServiceStatus();
        return;
      }

      const started = await waitForServiceApiState("worker", true);
      clearPending("worker");
      void loadServiceStatus();

      if (!started) {
        toast.warning(
          "Jobs enqueued, but the worker has not reported running yet.",
          { autoClose: 4000 },
        );
        return;
      }

      toast.success(result.message, { autoClose: 3000 });
    } catch {
      clearPending("worker");
      void loadServiceStatus();
      toast.error("Network error while starting reports worker.", {
        autoClose: 3000,
      });
    }
  };

  const handleStart = async (
    key: ServiceKey,
    options?: { ingestLinkIds?: number[]; ingestLinkItemIds?: number[] },
  ) => {
    const path =
      key === "worker"
        ? "/admin/services/worker/start"
        : "/admin/services/discovery/start";

    setPendingAction((pending) =>
      key === "discovery"
        ? { ...pending, discovery: "starting", worker: "starting" }
        : { ...pending, [key]: "starting" },
    );

    try {
      const discoveryPayload =
        key === "discovery" &&
        options &&
        ((options.ingestLinkIds?.length ?? 0) > 0 ||
          (options.ingestLinkItemIds?.length ?? 0) > 0)
          ? {
              ingestLinkIds: options.ingestLinkIds,
              ingestLinkItemIds: options.ingestLinkItemIds,
            }
          : null;

      const res = await authFetch(path, {
        method: "POST",
        ...(discoveryPayload
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(discoveryPayload),
            }
          : {}),
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        error?: { message?: string };
      };
      if (!res.ok) {
        if (key === "discovery") {
          clearPending("discovery");
          clearPending("worker");
        } else {
          clearPending(key);
        }
        toast.error(
          data.error?.message ??
            `Could not start ${key === "worker" ? "worker" : "discovery"} service.`,
          { autoClose: 3500 },
        );
        void loadServiceStatus();
        return;
      }

      if (key === "discovery") {
        const { discovery, worker } = await waitForDiscoveryAndWorkerRunning();
        clearPending("discovery");
        clearPending("worker");
        void loadServiceStatus();

        if (!discovery || !worker) {
          toast.warning(
            discovery && !worker
              ? "Discovery started, but the worker has not reported running yet."
              : worker && !discovery
                ? "Worker started, but discovery has not reported running yet."
                : "Start requested, but discovery and worker have not reported running yet.",
            { autoClose: 4000 },
          );
          return;
        }
      } else {
        const started = await waitForServiceApiState(key, true);
        clearPending(key);
        void loadServiceStatus();

        if (!started) {
          toast.warning(
            "Start requested, but the service has not reported running yet.",
            { autoClose: 4000 },
          );
          return;
        }
      }

      toast.success(data.message ?? "Service started.", {
        autoClose: 2500,
      });
    } catch {
      if (key === "discovery") {
        clearPending("discovery");
        clearPending("worker");
      } else {
        clearPending(key);
      }
      void loadServiceStatus();
      toast.error("Network error while starting service.", { autoClose: 3000 });
    }
  };

  const handleStop = async (key: ServiceKey) => {
    const path =
      key === "worker"
        ? "/admin/services/worker/stop"
        : "/admin/services/discovery/stop";

    setPendingAction((pending) => ({ ...pending, [key]: "stopping" }));

    try {
      const res = await authFetch(path, {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!res.ok) {
        clearPending(key);
        toast.error(
          data.error?.message ??
            `Could not stop ${key === "worker" ? "worker" : "discovery"} service.`,
          { autoClose: 3500 },
        );
        void loadServiceStatus();
        return;
      }

      const stopped = await waitForServiceApiState(key, false);
      clearPending(key);
      void loadServiceStatus();

      if (!stopped) {
        toast.warning(
          "Stop requested, but the service has not reported stopped yet.",
          { autoClose: 4000 },
        );
        return;
      }

      toast.success("Stopped successfully.", { autoClose: 2500 });
    } catch {
      clearPending(key);
      void loadServiceStatus();
      toast.error("Network error while stopping service.", { autoClose: 3000 });
    }
  };

  // const handleAiidImport = () => {
  //   if (!incidentsFile && !reportsFile) {
  //     toast.error("Select at least one CSV file.", { autoClose: 2500 });
  //     return;
  //   }
  //   stub(
  //     dryRun
  //       ? "AIID import (dry run)"
  //       : "AIID import",
  //   );
  // };

  const handleExportExcel = () => stub("Export risks to Excel");

  const handleRestore = () => {
    if (!backupFile) {
      toast.error("Select a backup file to restore.", { autoClose: 2500 });
      return;
    }
    stub("Restore backup");
  };

  const handleResetDatabase = () => {
    if (resetConfirm !== "RESET") return;
    stub("Reset database");
    setResetConfirm("");
  };

  const resetEnabled = resetConfirm === "RESET";

  return (
    <main className="mainLayout__content adminPage">
      <PageHeader
        title="Controls"
        subtitle="System controls, settings, and data management"
      />

      <div className="adminPage__tabs" role="tablist" aria-label="Controls sections">
        {ADMIN_TABS.map(({ key, label, icon: TabIcon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`adminPage__tab${tab === key ? " adminPage__tab--selected" : ""}`}
            onClick={() => setTab(key)}
          >
            <TabIcon size={15} strokeWidth={2} className="adminPage__tabIcon" aria-hidden />
            <span className="adminPage__tabLabel">{label}</span>
          </button>
        ))}
      </div>

      {tab === "controls" && (
        <>
      <div className="adminPage__topRow">
        <section className="adminPage__card adminPage__topRowCell" aria-labelledby={fid("services-title")}>
        <div className="adminPage__cardHead">
          <span className="settingsPage__cardIconWrap" aria-hidden>
            <Cpu size={20} strokeWidth={2} />
          </span>
          <div className="adminPage__cardHeadText">
            <h2 id={fid("services-title")} className="adminPage__cardTitle">
              System services
            </h2>
            <p className="adminPage__cardHint">
              Start and stop the worker service and choose the LLM for risk extraction.
            </p>
          </div>
        </div>
        <ul className="adminPage__serviceList">
          <AdminServiceRow
            label="Worker Service"
            status={displayServiceStatus("worker", apiStatus, pendingAction)}
            apiRunning={apiStatus.worker === "running"}
            onStart={() => void handleStart("worker")}
            onStop={() => void handleStop("worker")}
          />
        </ul>

        <ModelCompatibilityChecker idPrefix={fid("llm-model")} />
      </section>

        <div className="settingsPage adminPage__topRowCell">
          <SettingsApiSection />
        </div>
      </div>

      <AdminCronJobsSection
        idPrefix={baseId}
        discoveryStatus={displayServiceStatus(
          "discovery",
          apiStatus,
          pendingAction,
        )}
        onScheduleSaved={async (job) => {
          void loadServiceStatus();
          if (!job.running) {
            return;
          }
          setPendingAction((pending) => ({
            ...pending,
            worker: "starting",
          }));
          const workerUp = await waitForWorkerRunning(15_000);
          clearPending("worker");
          void loadServiceStatus();
          if (!workerUp) {
            toast.warning(
              "Discovery started, but the worker has not reported running yet. It may still be starting, or Python ingest may be unavailable.",
              { autoClose: 5000 },
            );
          }
        }}
        onScheduleStopped={async () => {
          setPendingAction((pending) => ({
            ...pending,
            discovery: "stopping",
          }));
          const stopped = await waitForServiceApiState("discovery", false);
          clearPending("discovery");
          void loadServiceStatus();
          if (!stopped) {
            toast.warning(
              "CRON job stop requested, but discovery has not reported stopped yet.",
              { autoClose: 4000 },
            );
          }
        }}
      />

      <div className="settingsPage adminPage__settings">
        <SettingsSections />
      </div>

      {/* AIID import — disabled until API is connected
      <section className="adminPage__card" aria-labelledby={fid("aiid-title")}>
          <div className="adminPage__cardHead">
            <span className="adminPage__cardIconWrap" aria-hidden>
              <Upload size={20} strokeWidth={2} />
            </span>
            <div className="adminPage__cardHeadText">
              <h2 id={fid("aiid-title")} className="adminPage__cardTitle">
                AIID import
              </h2>
              <p className="adminPage__cardHint">
                Import AI Incident Database CSV files.
              </p>
            </div>
          </div>
          <div className="adminPage__fileFields">
            <div className="adminPage__fileField">
              <label className="adminPage__fileLabel" htmlFor={fid("incidents")}>
                incidents.csv
              </label>
              <input
                id={fid("incidents")}
                type="file"
                accept=".csv,text/csv"
                className="adminPage__fileInput"
                onChange={(e) =>
                  setIncidentsFile(e.target.files?.[0] ?? null)
                }
              />
            </div>
            <div className="adminPage__fileField">
              <label className="adminPage__fileLabel" htmlFor={fid("reports")}>
                reports.csv
              </label>
              <input
                id={fid("reports")}
                type="file"
                accept=".csv,text/csv"
                className="adminPage__fileInput"
                onChange={(e) => setReportsFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <label className="adminPage__check">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
              />
              <span>Dry run (preview only)</span>
            </label>
          </div>
          <div className="adminPage__cardFoot">
            <button
              type="button"
              className="usersPage__inviteBtn"
              onClick={handleAiidImport}
            >
              <Upload size={18} strokeWidth={2} aria-hidden />
              Import
            </button>
          </div>
      </section>
      */}

      <section className="adminPage__card" aria-labelledby={fid("data-title")}>
        <div className="adminPage__cardHead">
          <span className="settingsPage__cardIconWrap" aria-hidden>
            <Database size={20} strokeWidth={2} />
          </span>
          <div className="adminPage__cardHeadText">
            <h2 id={fid("data-title")} className="adminPage__cardTitle">
              Data management
            </h2>
            <p className="adminPage__cardHint">
              Export, backup, restore, or reset the database.
            </p>
          </div>
        </div>
        <div className="adminPage__dataGrid">
          <div className="adminPage__dataCol">
            <h3 className="adminPage__dataColTitle">
              <Download size={16} strokeWidth={2} aria-hidden />
              Export risks
            </h3>
            <p className="adminPage__dataColDesc">
              Download all risks as an Excel spreadsheet with Risks, Articles, and
              Tags sheets.
            </p>
            <button
              type="button"
              className="adminPage__ghostBtn"
              onClick={handleExportExcel}
            >
              <Download size={18} strokeWidth={2} aria-hidden />
              Export to Excel
            </button>
          </div>
          <div className="adminPage__dataCol">
            <h3 className="adminPage__dataColTitle">
              <RotateCw size={16} strokeWidth={2} aria-hidden />
              Restore backup
            </h3>
            <div className="adminPage__fileField adminPage__fileField--tight">
              <label className="adminPage__visuallyHidden" htmlFor={fid("backup")}>
                Backup file
              </label>
              <input
                id={fid("backup")}
                type="file"
                className="adminPage__fileInput"
                onChange={(e) => setBackupFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <button
              type="button"
              className="adminPage__ghostBtn"
              onClick={handleRestore}
            >
              <Upload size={18} strokeWidth={2} aria-hidden />
              Restore
            </button>
          </div>
          <div className="adminPage__dataCol adminPage__dataCol--danger">
            <h3 className="adminPage__dataColTitle">
              <Trash2 size={16} strokeWidth={2} aria-hidden />
              Reset database
            </h3>
            <p className="adminPage__dataColDesc">
              Permanently deletes all articles, risks, and jobs. This cannot be
              undone.
            </p>
            <input
              type="text"
              className="adminPage__dangerInput"
              placeholder='Type "RESET" to confirm'
              value={resetConfirm}
              onChange={(e) => setResetConfirm(e.target.value)}
              autoComplete="off"
              aria-label="Type RESET to confirm database reset"
            />
            <button
              type="button"
              className="adminPage__dangerBtn"
              disabled={!resetEnabled}
              onClick={handleResetDatabase}
            >
              <AlertTriangle size={18} strokeWidth={2} aria-hidden />
              Reset Database
            </button>
          </div>
        </div>
      </section>

      <div className="settingsPage settingsPage__sections adminPage__settingsAbout">
        <SettingsAboutSection />
      </div>
        </>
      )}

      {tab === "rss" && (
        <AdminRssFeedsSection
          idPrefix={baseId}
          discoveryStatus={displayServiceStatus(
            "discovery",
            apiStatus,
            pendingAction,
          )}
          discoveryApiRunning={apiStatus.discovery === "running"}
          rssTab={rssTab}
          onRssTabChange={setRssTab}
          onDiscoveryStart={(selection) =>
            void handleStart("discovery", {
              ingestLinkIds: selection.ingestLinkIds,
              ingestLinkItemIds: selection.ingestLinkItemIds,
            })
          }
          onDiscoveryStop={() => void handleStop("discovery")}
        />
      )}

      {tab === "etl" && (
        <EtlSection
          idPrefix={baseId}
          workerStatus={displayServiceStatus(
            "worker",
            apiStatus,
            pendingAction,
          )}
          workerApiRunning={apiStatus.worker === "running"}
          onReportsStart={(selection) => void handleReportsStart(selection)}
          onWorkerStop={() => void handleStop("worker")}
        />
      )}
    </main>
  );
}
