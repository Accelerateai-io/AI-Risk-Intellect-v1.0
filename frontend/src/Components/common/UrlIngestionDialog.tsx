import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "react-toastify";
import { CircleX, Link2, Play, Tag, X } from "lucide-react";
import { enqueueIngestUrl } from "../../utils/ingestLinksApi";
import { enqueueJobUrl } from "../../utils/jobsEnqueueApi";
import "../pages/Users/usersPage.css";
import "../pages/Jobs/jobsPage.css";

export type UrlIngestionDialogVariant = "jobs" | "feed";

export type UrlIngestionDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Jobs: queue ingest job. Feed (default): save RSS feed URL. */
  variant?: UrlIngestionDialogVariant;
  /** Called after a URL is successfully enqueued (e.g. refresh job list). */
  onEnqueued?: () => void;
};

export function UrlIngestionDialog({
  open,
  onClose,
  variant = "feed",
  onEnqueued,
}: UrlIngestionDialogProps) {
  const isJobs = variant === "jobs";
  const baseId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const suggestedNameInputRef = useRef<HTMLInputElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const [ingestUrl, setIngestUrl] = useState("");
  const [suggestedName, setSuggestedName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const close = useCallback(() => {
    if (submitting) return;
    setIngestUrl("");
    setSuggestedName("");
    onClose();
  }, [submitting, onClose]);

  useEffect(() => {
    if (!open) return;
    const focusTarget = isJobs ? urlInputRef : suggestedNameInputRef;
    const focusTimer = window.setTimeout(() => focusTarget.current?.focus(), 0);
    return () => window.clearTimeout(focusTimer);
  }, [open, isJobs]);

  const handleSubmit = useCallback(async () => {
    const url = ingestUrl.trim();
    if (!url) {
      toast.error(
        isJobs ? "Enter a URL to enqueue." : "Enter a URL to add.",
        { autoClose: 2500 },
      );
      return;
    }

    setSubmitting(true);
    try {
      const result = isJobs
        ? await enqueueJobUrl(url)
        : await enqueueIngestUrl(url, suggestedName);

      if (result.status === "created") {
        toast.success(result.message, { autoClose: 3000 });
        setIngestUrl("");
        setSuggestedName("");
        onEnqueued?.();
        onClose();
        return;
      }

      if (result.status === "conflict") {
        toast.warning(result.message, { autoClose: 3500 });
        return;
      }

      if (result.status === "network") {
        toast.error(
          isJobs
            ? "Network error while enqueueing URL."
            : "Network error while saving URL.",
          { autoClose: 3000 },
        );
        return;
      }

      toast.error(result.message, { autoClose: 4000 });
    } finally {
      setSubmitting(false);
    }
  }, [ingestUrl, suggestedName, isJobs, onClose, onEnqueued]);

  if (!open) return null;

  const titleId = `${baseId}-ingest-title`;
  const urlId = `${baseId}-ingest-url`;
  const suggestedNameId = `${baseId}-suggested-name`;

  const overlayClass = isJobs
    ? "jobsPage__enqueueOverlay"
    : "usersPage__overlay";
  const dialogClass = isJobs ? "jobsPage__enqueueDialog" : "usersPage__dialog";
  const dialogHeadClass = isJobs
    ? "jobsPage__enqueueDialogHead"
    : "usersPage__dialogHead";
  const dialogTitleClass = isJobs
    ? "jobsPage__enqueueDialogTitle"
    : "usersPage__dialogTitle";
  const dialogCloseClass = isJobs
    ? "jobsPage__enqueueDialogClose"
    : "usersPage__dialogClose";
  const dialogBodyClass = isJobs
    ? "jobsPage__enqueueDialogBody"
    : "usersPage__dialogBody";
  const labelClass = isJobs
    ? "jobsPage__enqueueLabel jobsPage__enqueueLabel--withIcon"
    : "usersPage__label usersPage__label--withIcon";
  const labelIconClass = isJobs
    ? "jobsPage__enqueueLabelIcon"
    : "usersPage__labelIcon";
  const inputClass = isJobs ? "jobsPage__enqueueInput" : "usersPage__input";
  const actionsClass = isJobs
    ? "jobsPage__enqueueDialogActions"
    : "usersPage__dialogActions";
  const cancelBtnClass = isJobs
    ? "jobsPage__enqueueBtn jobsPage__enqueueBtn--cancel"
    : "usersPage__btn usersPage__btn--logoutTone";
  const submitBtnClass = isJobs
    ? "jobsPage__enqueueBtn jobsPage__enqueueBtn--primary"
    : "usersPage__btn usersPage__btn--primary usersPage__btn--inviteSend";

  return (
    <div
      className={overlayClass}
      role="presentation"
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        className={dialogClass}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className={dialogHeadClass}>
          <h2 id={titleId} className={dialogTitleClass}>
            {isJobs ? "Enqueue URL" : "URL ingestion"}
          </h2>
          <button
            type="button"
            className={dialogCloseClass}
            onClick={close}
            disabled={submitting}
            aria-label="Close"
          >
            <X size={18} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
        <div className={dialogBodyClass}>
          {!isJobs ? (
            <>
              <label className={labelClass} htmlFor={suggestedNameId}>
                <Tag className={labelIconClass} size={16} strokeWidth={2} aria-hidden />
                <span>URL Name</span>
              </label>
              <input
                ref={suggestedNameInputRef}
                id={suggestedNameId}
                type="text"
                className={inputClass}
                placeholder="URL Name"
                value={suggestedName}
                onChange={(e) => setSuggestedName(e.target.value)}
                autoComplete="off"
                maxLength={256}
                disabled={submitting}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleSubmit();
                  }
                }}
              />
            </>
          ) : null}
          <label className={labelClass} htmlFor={urlId}>
            <Link2 className={labelIconClass} size={16} strokeWidth={2} aria-hidden />
            <span>URL Link</span>
          </label>
          <input
            ref={urlInputRef}
            id={urlId}
            type="url"
            className={inputClass}
            placeholder={
              isJobs ? "https://example.com/article" : "https://feeds.example.com/rss.xml"
            }
            value={ingestUrl}
            onChange={(e) => setIngestUrl(e.target.value)}
            autoComplete="off"
            disabled={submitting}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleSubmit();
              }
            }}
          />
          <div className={actionsClass}>
            <button
              type="button"
              className={cancelBtnClass}
              onClick={close}
              disabled={submitting}
            >
              <CircleX size={16} strokeWidth={1.75} aria-hidden />
              Cancel
            </button>
            <button
              type="button"
              className={submitBtnClass}
              onClick={() => void handleSubmit()}
              disabled={submitting}
            >
              <Play size={16} strokeWidth={2} aria-hidden />
              {submitting
                ? isJobs
                  ? "Enqueueing…"
                  : "Saving…"
                : isJobs
                  ? "Enqueue"
                  : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
