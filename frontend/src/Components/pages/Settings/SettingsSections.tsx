import { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import { Bell, RefreshCw, Server, Shield } from "lucide-react";
import { getApiBaseUrl, apiUrl } from "../../../utils/apiBase";
import "./settingsPage.css";

const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? "1.0.0";
const BACKEND_LABEL = "Express API";
/** Full API root for Settings connection test (no trailing slash). */
const SETTINGS_API_BASE_DEFAULT = "http://localhost:5005/api/v1";

function resolveSettingsApiBase(): string {
  const fromEnv = getApiBaseUrl().trim();
  if (fromEnv) return fromEnv;
  return SETTINGS_API_BASE_DEFAULT;
}

type ConnState = "checking" | "connected" | "disconnected";

function healthUrlForBase(baseTrimmed: string): string {
  return apiUrl("/health", { base: baseTrimmed });
}

async function pingHealth(url: string): Promise<boolean> {
  const res = await fetch(url, { method: "GET", credentials: "omit" });
  return res.ok;
}

type PrefToggleProps = {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
};

function PrefToggle({ id, label, description, checked, onChange }: PrefToggleProps) {
  return (
    <li className="settingsPage__prefRow">
      <div className="settingsPage__prefText">
        <div className="settingsPage__prefLabel" id={`${id}-label`}>
          {label}
        </div>
        <p className="settingsPage__prefDesc" id={`${id}-desc`}>
          {description}
        </p>
      </div>
      <button
        type="button"
        id={id}
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-desc`}
        className={`settingsPage__switch${checked ? " settingsPage__switch--on" : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span className="settingsPage__switchThumb" aria-hidden />
      </button>
    </li>
  );
}

export function SettingsApiSection() {
  const [apiBase, setApiBase] = useState("");
  const [conn, setConn] = useState<ConnState>("checking");
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    const initial = resolveSettingsApiBase();
    setApiBase(initial);
    void (async () => {
      setConn("checking");
      try {
        const ok = await pingHealth(healthUrlForBase(initial.trim()));
        setConn(ok ? "connected" : "disconnected");
      } catch {
        setConn("disconnected");
      }
    })();
  }, []);

  const handleTestConnection = useCallback(async () => {
    setTesting(true);
    setConn("checking");
    const url = healthUrlForBase(apiBase.trim());
    try {
      const ok = await pingHealth(url);
      setConn(ok ? "connected" : "disconnected");
      if (ok) {
        toast.success("Connection successful.", { autoClose: 2200 });
      } else {
        toast.error("Server did not return OK.", { autoClose: 2800 });
      }
    } catch {
      setConn("disconnected");
      toast.error("Could not reach the backend.", { autoClose: 2800 });
    } finally {
      setTesting(false);
    }
  }, [apiBase]);

  return (
    <section
      className="settingsPage__card settingsPage__card--api"
      aria-labelledby="settings-api-title"
    >
      <div className="settingsPage__cardHead settingsPage__cardHead--split">
        <div className="settingsPage__cardHeadMain">
          <span className="settingsPage__cardIconWrap" aria-hidden>
            <Server size={20} strokeWidth={2} />
          </span>
          <div className="settingsPage__cardHeadText">
            <h2 id="settings-api-title" className="settingsPage__sectionTitle">
              API configuration
            </h2>
            <p className="settingsPage__sectionHint">
              Backend server connection settings
            </p>
          </div>
        </div>
        <div className="settingsPage__cardHeadActions">
          <button
            type="button"
            className="usersPage__inviteBtn"
            onClick={() => void handleTestConnection()}
            disabled={testing}
            aria-busy={testing}
          >
            <RefreshCw
              size={18}
              strokeWidth={2}
              className={testing ? "settingsPage__btnIcon--spin" : undefined}
              aria-hidden
            />
            Test connection
          </button>
        </div>
      </div>

      <div className="settingsPage__field">
        <label className="settingsPage__label" htmlFor="settings-api-base">
          API Base URL
        </label>
        <input
          id="settings-api-base"
          type="url"
          className="settingsPage__input"
          placeholder="http://localhost:5005/api/v1"
          value={apiBase}
          onChange={(e) => setApiBase(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className="settingsPage__statusBlock">
        <div className="settingsPage__statusLabelRow">
          <div>
            <p className="settingsPage__statusTitle">Connection status</p>
            <p className="settingsPage__statusSub">Backend server connectivity</p>
          </div>
          <div
            className={`settingsPage__pill${conn === "connected" ? " settingsPage__pill--ok" : ""}${conn === "disconnected" ? " settingsPage__pill--bad" : ""}${conn === "checking" ? " settingsPage__pill--pending" : ""}`}
            role="status"
          >
            <span className="settingsPage__pillDot" aria-hidden />
            {conn === "checking"
              ? "Checking…"
              : conn === "connected"
                ? "Connected"
                : "Disconnected"}
          </div>
        </div>
      </div>
    </section>
  );
}

export function SettingsSections() {
  const [autoRefreshDashboard, setAutoRefreshDashboard] = useState(true);
  const [realtimeNotifications, setRealtimeNotifications] = useState(true);
  const [criticalRiskAlerts, setCriticalRiskAlerts] = useState(true);
  const [jobFailureAlerts, setJobFailureAlerts] = useState(true);
  const [dailyDigest, setDailyDigest] = useState(false);

  return (
    <div className="settingsPage__sections">
      <section className="settingsPage__card" aria-labelledby="settings-refresh-title">
        <div className="settingsPage__cardHead">
          <span className="settingsPage__cardIconWrap" aria-hidden>
            <RefreshCw size={20} strokeWidth={2} />
          </span>
          <div className="settingsPage__cardHeadText">
            <h2 id="settings-refresh-title" className="settingsPage__sectionTitle">
              Data Refresh
            </h2>
            <p className="settingsPage__sectionHint">Configure automatic data updates</p>
          </div>
        </div>
        <ul className="settingsPage__prefList">
          <PrefToggle
            id="settings-pref-auto-refresh"
            label="Auto-Refresh Dashboard"
            description="Refresh data every 30 seconds"
            checked={autoRefreshDashboard}
            onChange={setAutoRefreshDashboard}
          />
          <PrefToggle
            id="settings-pref-realtime"
            label="Real-time Notifications"
            description="Receive alerts for critical risks"
            checked={realtimeNotifications}
            onChange={setRealtimeNotifications}
          />
        </ul>
      </section>

      <section className="settingsPage__card" aria-labelledby="settings-notify-title">
        <div className="settingsPage__cardHead">
          <span className="settingsPage__cardIconWrap" aria-hidden>
            <Bell size={20} strokeWidth={2} />
          </span>
          <div className="settingsPage__cardHeadText">
            <h2 id="settings-notify-title" className="settingsPage__sectionTitle">
              Notifications
            </h2>
            <p className="settingsPage__sectionHint">Alert preferences</p>
          </div>
        </div>
        <ul className="settingsPage__prefList">
          <PrefToggle
            id="settings-pref-critical"
            label="Critical Risk Alerts"
            description="Notify on severity 5 risks"
            checked={criticalRiskAlerts}
            onChange={setCriticalRiskAlerts}
          />
          <PrefToggle
            id="settings-pref-job-fail"
            label="Job Failure Alerts"
            description="Notify on crawler errors"
            checked={jobFailureAlerts}
            onChange={setJobFailureAlerts}
          />
          <PrefToggle
            id="settings-pref-digest"
            label="Daily Digest"
            description="Summary of daily activity"
            checked={dailyDigest}
            onChange={setDailyDigest}
          />
        </ul>
      </section>
    </div>
  );
}

export function SettingsAboutSection() {
  return (
    <section
      className="settingsPage__card settingsPage__card--about"
      aria-labelledby="settings-about-title"
    >
      <div className="settingsPage__cardHead">
        <span className="settingsPage__cardIconWrap" aria-hidden>
          <Shield size={20} strokeWidth={2} />
        </span>
        <div className="settingsPage__cardHeadText">
          <h2 id="settings-about-title" className="settingsPage__sectionTitle">
            About
          </h2>
          <p className="settingsPage__sectionHint">System information</p>
        </div>
      </div>
      <dl className="settingsPage__metaList">
        <div className="settingsPage__metaRow">
          <dt className="settingsPage__metaLabel">Version</dt>
          <dd className="settingsPage__metaValue">{APP_VERSION}</dd>
        </div>
        <div className="settingsPage__metaRow">
          <dt className="settingsPage__metaLabel">Environment</dt>
          <dd className="settingsPage__metaValue">
            {import.meta.env.PROD ? "Production" : "Development"}
          </dd>
        </div>
        <div className="settingsPage__metaRow">
          <dt className="settingsPage__metaLabel">Backend</dt>
          <dd className="settingsPage__metaValue">{BACKEND_LABEL}</dd>
        </div>
      </dl>
    </section>
  );
}
