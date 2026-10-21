import { useEffect, useState } from "react";
import { Timer } from "lucide-react";
import { toast } from "react-toastify";
import { authFetch } from "../../../utils/authFetch";
import { readApiErrorMessage } from "../../../utils/readApiErrorMessage";

const EXECUTION_MINUTE_OPTIONS = [
  5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60,
] as const;

export function ExecutionTimeSection() {
  const [minutes, setMinutes] = useState<number>(5);
  const [savedMinutes, setSavedMinutes] = useState<number>(5);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await authFetch("/jobs/execution-time");
        const data = (await res.json().catch(() => ({}))) as { minutes?: number };
        if (!res.ok || cancelled) return;
        if (
          typeof data.minutes === "number" &&
          (EXECUTION_MINUTE_OPTIONS as readonly number[]).includes(data.minutes)
        ) {
          setMinutes(data.minutes);
          setSavedMinutes(data.minutes);
        }
      } catch {
        if (!cancelled) {
          toast.error("Could not load the execution time.", { autoClose: 3000 });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (window.location.hash !== "#execution-time") return;
    document.getElementById("execution-time")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, []);

  const save = async () => {
    if (saving || minutes === savedMinutes) return;
    setSaving(true);
    try {
      const res = await authFetch("/admin/execution-time", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minutes }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        minutes?: number;
        message?: string;
        error?: { message?: string };
      };
      if (!res.ok) {
        toast.error(
          readApiErrorMessage(data, "Could not save the execution time."),
          { autoClose: 3500 },
        );
        return;
      }
      const next =
        typeof data.minutes === "number" ? data.minutes : minutes;
      setMinutes(next);
      setSavedMinutes(next);
      toast.success(data.message ?? `Execution time set to ${next} minutes.`, {
        autoClose: 2500,
      });
    } catch {
      toast.error("Network error while saving the execution time.", {
        autoClose: 3000,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      id="execution-time"
      className="settingsPage__card"
      aria-labelledby="execution-time-title"
    >
      <div className="settingsPage__cardHead">
        <span className="settingsPage__cardIconWrap" aria-hidden>
          <Timer size={20} strokeWidth={2} />
        </span>
        <div className="settingsPage__cardHeadText">
          <h2 id="execution-time-title" className="settingsPage__sectionTitle">
            Execution time
          </h2>
          <p className="settingsPage__sectionHint">
            The first try is 5 minutes. If the URL does not finish, the next
            try is 10 minutes, then 15, and so on by 5 minutes up to 60. It
            does not start at 1 minute. A URL that finishes on any try is
            marked done. A URL that still has not finished after 60 minutes is
            skipped.
          </p>
        </div>
      </div>
      <div className="adminPage__executionTimeRow">
        <label className="adminPage__executionTimeLabel" htmlFor="execution-time-minutes">
          Limit
        </label>
        <select
          id="execution-time-minutes"
          className="adminPage__executionTimeSelect"
          value={minutes}
          disabled={loading || saving}
          onChange={(e) => setMinutes(Number(e.target.value))}
        >
          {EXECUTION_MINUTE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option} minutes
            </option>
          ))}
        </select>
        <button
          type="button"
          className="adminPage__executionTimeSave"
          disabled={loading || saving || minutes === savedMinutes}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </section>
  );
}
