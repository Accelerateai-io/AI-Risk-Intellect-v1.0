import { memo, useMemo, useState, type CSSProperties } from "react";
import { Save } from "lucide-react";
import type { RiskDetail } from "../Risk/riskData";

interface ReviewFieldsEditorProps {
  risk: RiskDetail;
  taxonomyDomains: string[];
  saving: boolean;
  onSave: (fields: Record<string, unknown>, reason: string) => void;
}

/** Treat the "—" placeholder as empty. */
function clean(v: string | null | undefined): string {
  const s = (v ?? "").trim();
  return s === "—" ? "" : s;
}

type FormState = {
  riskTitle: string;
  description: string;
  domains: string;
  primaryRisk: string;
  secondaryRisk: string;
  sector: string;
  industry: string;
  intent: string;
  likelihood: string; // "" | "1".."5"
  impact: string;
  aiProductName: string;
  aiProductVendor: string;
};

function initialFrom(risk: RiskDetail): FormState {
  return {
    riskTitle: clean(risk.title),
    description: clean(risk.description),
    domains: clean(risk.domain),
    primaryRisk: clean(risk.primaryRisk),
    secondaryRisk: clean(risk.secondaryRisk),
    sector: clean(risk.sector),
    industry: clean(risk.industry),
    intent: clean(risk.intent),
    likelihood: risk.riskScoring?.likelihood != null ? String(risk.riskScoring.likelihood) : "",
    impact: risk.riskScoring?.impact != null ? String(risk.riskScoring.impact) : "",
    aiProductName: clean(risk.product?.name ?? ""),
    aiProductVendor: clean(risk.product?.vendor ?? ""),
  };
}

const SCALE = ["1", "2", "3", "4", "5"];

export const ReviewFieldsEditor = memo(function ReviewFieldsEditor({
  risk,
  taxonomyDomains,
  saving,
  onSave,
}: ReviewFieldsEditorProps) {
  const initial = useMemo(() => initialFrom(risk), [risk]);
  const [form, setForm] = useState<FormState>(initial);
  const [reason, setReason] = useState("");

  const set = (key: keyof FormState, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // Only fields the reviewer actually changed are sent (backend also no-ops unchanged values).
  const changed = useMemo(() => {
    const out: Record<string, unknown> = {};
    (Object.keys(form) as (keyof FormState)[]).forEach((k) => {
      if (form[k] === initial[k]) return;
      if (k === "likelihood" || k === "impact") {
        if (form[k] === "") return; // don't clear scale values
        out[k] = Number(form[k]);
      } else {
        out[k] = form[k];
      }
    });
    return out;
  }, [form, initial]);

  const changedCount = Object.keys(changed).length;
  const emptyTitle = form.riskTitle.trim().length === 0;

  const grid: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "0.75rem 1rem",
    marginTop: "0.5rem",
  };
  const full: CSSProperties = { gridColumn: "1 / -1" };

  return (
    <section className="reviewFeedbackDialog__fieldsEditor" aria-label="Edit extracted fields">
      <p className="reviewFeedbackDialog__label" style={{ marginBottom: 2 }}>
        Correct extracted fields
      </p>
      <p className="reviewFeedbackDialog__moveDesc" style={{ marginTop: 0 }}>
        Only Overview fields are editable. Scores and Analysis stay read-only.
        Severity is recomputed from likelihood × impact. Every change is recorded with your name.
      </p>

      <div style={grid}>
        <label style={full}>
          <span className="reviewFeedbackDialog__label">Title</span>
          <input
            type="text"
            value={form.riskTitle}
            onChange={(e) => set("riskTitle", e.target.value)}
            disabled={saving}
          />
        </label>

        <label style={full}>
          <span className="reviewFeedbackDialog__label">Description</span>
          <textarea
            rows={3}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            disabled={saving}
          />
        </label>

        <label style={full}>
          <span className="reviewFeedbackDialog__label">Domain</span>
          <select
            value={form.domains}
            onChange={(e) => set("domains", e.target.value)}
            disabled={saving}
          >
            <option value="">{form.domains ? "Keep current" : "Select a taxonomy domain…"}</option>
            {taxonomyDomains.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
            {form.domains && !taxonomyDomains.includes(form.domains) ? (
              <option value={form.domains}>{form.domains} (current)</option>
            ) : null}
          </select>
        </label>

        <label>
          <span className="reviewFeedbackDialog__label">Likelihood (1–5)</span>
          <select value={form.likelihood} onChange={(e) => set("likelihood", e.target.value)} disabled={saving}>
            <option value="">—</option>
            {SCALE.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>

        <label>
          <span className="reviewFeedbackDialog__label">Impact (1–5)</span>
          <select value={form.impact} onChange={(e) => set("impact", e.target.value)} disabled={saving}>
            <option value="">—</option>
            {SCALE.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>

        <label>
          <span className="reviewFeedbackDialog__label">Intent</span>
          <input type="text" value={form.intent} onChange={(e) => set("intent", e.target.value)} disabled={saving} />
        </label>

        <label>
          <span className="reviewFeedbackDialog__label">Primary risk</span>
          <input type="text" value={form.primaryRisk} onChange={(e) => set("primaryRisk", e.target.value)} disabled={saving} />
        </label>

        <label>
          <span className="reviewFeedbackDialog__label">Secondary risk</span>
          <input type="text" value={form.secondaryRisk} onChange={(e) => set("secondaryRisk", e.target.value)} disabled={saving} />
        </label>

        <label>
          <span className="reviewFeedbackDialog__label">Sector</span>
          <input type="text" value={form.sector} onChange={(e) => set("sector", e.target.value)} disabled={saving} />
        </label>

        <label>
          <span className="reviewFeedbackDialog__label">Industry</span>
          <input type="text" value={form.industry} onChange={(e) => set("industry", e.target.value)} disabled={saving} />
        </label>

        <label>
          <span className="reviewFeedbackDialog__label">AI product</span>
          <input type="text" value={form.aiProductName} onChange={(e) => set("aiProductName", e.target.value)} disabled={saving} />
        </label>

        <label>
          <span className="reviewFeedbackDialog__label">AI product vendor</span>
          <input type="text" value={form.aiProductVendor} onChange={(e) => set("aiProductVendor", e.target.value)} disabled={saving} />
        </label>

        <label style={full}>
          <span className="reviewFeedbackDialog__label">Reason for change (optional)</span>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. corrected mislabeled domain"
            disabled={saving}
          />
        </label>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "0.75rem" }}>
        <button
          type="button"
          className="usersPage__btn usersPage__btn--primary"
          disabled={saving || changedCount === 0 || emptyTitle}
          aria-busy={saving}
          onClick={() => onSave(changed, reason.trim())}
        >
          <Save size={16} strokeWidth={2} aria-hidden />
          {saving ? "Saving…" : changedCount > 0 ? `Save ${changedCount} change${changedCount === 1 ? "" : "s"}` : "Save changes"}
        </button>
      </div>
    </section>
  );
});
