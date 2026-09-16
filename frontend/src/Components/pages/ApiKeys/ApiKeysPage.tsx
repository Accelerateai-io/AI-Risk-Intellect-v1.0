import { useCallback, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "react-toastify";
import {
  Check,
  Copy,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  ShieldOff,
  X,
} from "lucide-react";
import { PageHeader } from "../../Layout/PageHeader";
import { setDocumentPageTitle } from "../../../utils/pageTitle";
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  type ApiKeyRow,
  type CreatedApiKey,
} from "../../../utils/apiKeysApi";
import "./apiKeysPage.css";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function ApiKeysPage() {
  const generateTitleId = useId();
  const revealTitleId = useId();

  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "error">(
    "loading",
  );
  const [generating, setGenerating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const [generateOpen, setGenerateOpen] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [revealedKey, setRevealedKey] = useState<CreatedApiKey | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setDocumentPageTitle("API Keys");
  }, []);

  const loadKeys = useCallback(async () => {
    setLoadState("loading");
    const result = await listApiKeys();
    if (!result.ok) {
      setLoadState("error");
      toast.error(result.message, { autoClose: 4000 });
      return;
    }
    setKeys(result.keys);
    setLoadState("idle");
  }, []);

  useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  async function handleGenerate() {
    setGenerating(true);
    const result = await createApiKey(keyName);
    setGenerating(false);
    if (!result.ok) {
      toast.error(result.message, { autoClose: 4000 });
      return;
    }
    setGenerateOpen(false);
    setKeyName("");
    setRevealedKey(result.key);
    setCopied(false);
    setKeys((prev) => [
      {
        id: result.key.id,
        name: result.key.name,
        keyPrefix: result.key.keyPrefix,
        lastUsedAt: result.key.lastUsedAt,
        revokedAt: result.key.revokedAt,
        createdAt: result.key.createdAt,
        updatedAt: result.key.updatedAt,
      },
      ...prev,
    ]);
    toast.success("API key generated. Copy it now — it won’t be shown again.", {
      autoClose: 5000,
    });
  }

  async function handleRevoke(id: string) {
    if (!window.confirm("Revoke this API key? It will stop working immediately."))
      return;
    setRevokingId(id);
    const result = await revokeApiKey(id);
    setRevokingId(null);
    if (!result.ok) {
      toast.error(result.message, { autoClose: 4000 });
      return;
    }
    setKeys((prev) => prev.map((k) => (k.id === id ? result.key : k)));
    toast.success("API key revoked.", { autoClose: 3000 });
  }

  async function copyPlaintext() {
    if (!revealedKey?.plaintext) return;
    try {
      await navigator.clipboard.writeText(revealedKey.plaintext);
      setCopied(true);
      toast.success("Copied to clipboard", { autoClose: 2000 });
    } catch {
      toast.error("Could not copy to clipboard", { autoClose: 3000 });
    }
  }

  return (
    <div className="apiKeysPage">
      <PageHeader
        title="API Keys"
        subtitle="Generate and manage keys for authenticated API access. Keys are shown only once."
        actions={
          <div className="apiKeysPage__actions">
            <button
              type="button"
              className="apiKeysPage__btn apiKeysPage__btn--ghost"
              onClick={() => void loadKeys()}
              disabled={loadState === "loading"}
            >
              <RefreshCw size={16} aria-hidden />
              Refresh
            </button>
            <button
              type="button"
              className="apiKeysPage__btn apiKeysPage__btn--primary"
              onClick={() => setGenerateOpen(true)}
            >
              <Plus size={16} aria-hidden />
              Generate API key
            </button>
          </div>
        }
      />

      <section className="apiKeysPage__panel" aria-label="Your API keys">
        {loadState === "loading" && keys.length === 0 ? (
          <div className="apiKeysPage__empty">
            <Loader2 className="apiKeysPage__spin" size={22} aria-hidden />
            Loading API keys…
          </div>
        ) : keys.length === 0 ? (
          <div className="apiKeysPage__empty">
            <KeyRound size={28} aria-hidden />
            <p>No API keys yet. Generate one to get started.</p>
          </div>
        ) : (
          <div className="apiKeysPage__tableWrap">
            <table className="apiKeysPage__table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Prefix</th>
                  <th scope="col">Created</th>
                  <th scope="col">Last used</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {keys.map((key) => {
                  const isRevoked = Boolean(key.revokedAt);
                  return (
                    <tr key={key.id}>
                      <td>{key.name}</td>
                      <td>
                        <code className="apiKeysPage__prefix">
                          {key.keyPrefix}…
                        </code>
                      </td>
                      <td>{formatDate(key.createdAt)}</td>
                      <td>{formatDate(key.lastUsedAt)}</td>
                      <td>
                        <span
                          className={
                            isRevoked
                              ? "apiKeysPage__badge apiKeysPage__badge--revoked"
                              : "apiKeysPage__badge apiKeysPage__badge--active"
                          }
                        >
                          {isRevoked ? "Revoked" : "Active"}
                        </span>
                      </td>
                      <td>
                        {!isRevoked ? (
                          <button
                            type="button"
                            className="apiKeysPage__btn apiKeysPage__btn--danger"
                            disabled={revokingId === key.id}
                            onClick={() => void handleRevoke(key.id)}
                          >
                            {revokingId === key.id ? (
                              <Loader2
                                className="apiKeysPage__spin"
                                size={14}
                                aria-hidden
                              />
                            ) : (
                              <ShieldOff size={14} aria-hidden />
                            )}
                            Revoke
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {generateOpen
        ? createPortal(
            <div
              className="apiKeysPage__overlay"
              role="presentation"
              onClick={() => !generating && setGenerateOpen(false)}
            >
              <div
                className="apiKeysPage__dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby={generateTitleId}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="apiKeysPage__dialogHead">
                  <h2 id={generateTitleId}>Generate API key</h2>
                  <button
                    type="button"
                    className="apiKeysPage__iconBtn"
                    aria-label="Close"
                    disabled={generating}
                    onClick={() => setGenerateOpen(false)}
                  >
                    <X size={18} />
                  </button>
                </div>
                <p className="apiKeysPage__dialogHint">
                  The full key is shown only once after creation. Store it
                  securely.
                </p>
                <label className="apiKeysPage__label" htmlFor="api-key-name">
                  Name (optional)
                </label>
                <input
                  id="api-key-name"
                  className="apiKeysPage__input"
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !generating) {
                      e.preventDefault()
                      void handleGenerate()
                    }
                  }}
                  maxLength={128}
                  placeholder="Leave blank or type a label, then click Generate"
                  disabled={generating}
                  autoFocus
                />
                <div className="apiKeysPage__dialogActions">
                  <button
                    type="button"
                    className="apiKeysPage__btn apiKeysPage__btn--ghost"
                    disabled={generating}
                    onClick={() => setGenerateOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="apiKeysPage__btn apiKeysPage__btn--primary"
                    disabled={generating}
                    onClick={() => void handleGenerate()}
                  >
                    {generating ? (
                      <Loader2
                        className="apiKeysPage__spin"
                        size={16}
                        aria-hidden
                      />
                    ) : (
                      <KeyRound size={16} aria-hidden />
                    )}
                    Generate API key
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {revealedKey
        ? createPortal(
            <div
              className="apiKeysPage__overlay"
              role="presentation"
              onClick={() => setRevealedKey(null)}
            >
              <div
                className="apiKeysPage__dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby={revealTitleId}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="apiKeysPage__dialogHead">
                  <h2 id={revealTitleId}>Your new API key</h2>
                  <button
                    type="button"
                    className="apiKeysPage__iconBtn"
                    aria-label="Close"
                    onClick={() => setRevealedKey(null)}
                  >
                    <X size={18} />
                  </button>
                </div>
                <p className="apiKeysPage__dialogHint apiKeysPage__dialogHint--warn">
                  Copy this key now. You will not be able to see it again.
                </p>
                <div className="apiKeysPage__secretRow">
                  <input
                    className="apiKeysPage__secretInput"
                    type="text"
                    readOnly
                    value={revealedKey.plaintext}
                    aria-label="New API key"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <button
                    type="button"
                    className="apiKeysPage__copyIconBtn"
                    aria-label={copied ? "Copied" : "Copy API key"}
                    title={copied ? "Copied" : "Copy"}
                    onClick={() => void copyPlaintext()}
                  >
                    {copied ? (
                      <Check size={18} aria-hidden />
                    ) : (
                      <Copy size={18} aria-hidden />
                    )}
                  </button>
                </div>
                <div className="apiKeysPage__dialogActions">
                  <button
                    type="button"
                    className="apiKeysPage__btn apiKeysPage__btn--primary"
                    onClick={() => setRevealedKey(null)}
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
