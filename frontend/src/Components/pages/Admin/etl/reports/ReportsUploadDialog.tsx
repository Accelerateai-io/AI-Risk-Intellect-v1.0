import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { CircleX, FileSpreadsheet, Tag, Upload, X } from "lucide-react";
import { toast } from "react-toastify";
import "../../../Users/usersPage.css";

const ACCEPTED_EXTENSIONS = /\.(csv|xlsx|xls)$/i;
const ACCEPTED_MIME =
  ".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function isAcceptedFile(file: File): boolean {
  return ACCEPTED_EXTENSIONS.test(file.name);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface ReportsUploadDialogProps {
  open: boolean;
  uploading: boolean;
  uploadProgress?: number | null;
  reuploadTarget?: { id: number; suggestedName: string | null } | null;
  onClose: () => void;
  onSubmit: (payload: { suggestedName: string; file: File }) => void;
}

export function ReportsUploadDialog({
  open,
  uploading,
  uploadProgress = null,
  reuploadTarget = null,
  onClose,
  onSubmit,
}: ReportsUploadDialogProps) {
  const baseId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [suggestedName, setSuggestedName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const close = useCallback(() => {
    if (uploading) return;
    setSuggestedName("");
    setSelectedFile(null);
    onClose();
  }, [uploading, onClose]);

  useEffect(() => {
    if (!open) {
      setSuggestedName("");
      setSelectedFile(null);
      setDragActive(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setSuggestedName(reuploadTarget?.suggestedName?.trim() ?? "");
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    dialogRef.current?.querySelector<HTMLInputElement>("input[type=text]")?.focus();
  }, [open, reuploadTarget]);

  const handleSubmit = useCallback(() => {
    if (!selectedFile) {
      toast.error("Please select a CSV or Excel file.", { autoClose: 2500 });
      return;
    }

    if (!isAcceptedFile(selectedFile)) {
      toast.error("Please select a CSV or Excel file.", { autoClose: 2500 });
      return;
    }

    onSubmit({ suggestedName: suggestedName.trim(), file: selectedFile });
  }, [onSubmit, selectedFile, suggestedName]);

  const selectFile = useCallback((file: File | null | undefined) => {
    if (!file) return;
    if (!isAcceptedFile(file)) {
      toast.error("Please select a CSV or Excel file.", { autoClose: 2500 });
      return;
    }
    setSelectedFile(file);
  }, []);

  const openFilePicker = useCallback(() => {
    if (uploading) return;
    fileInputRef.current?.click();
  }, [uploading]);

  const handleDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (uploading) return;
      event.preventDefault();
      setDragActive(true);
    },
    [uploading],
  );

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (uploading) return;
      event.preventDefault();
      setDragActive(false);
      selectFile(event.dataTransfer.files?.[0]);
    },
    [selectFile, uploading],
  );

  if (!open) return null;

  const titleId = `${baseId}-reports-upload-title`;
  const suggestedNameId = `${baseId}-suggested-name`;
  const fileInputId = `${baseId}-file-input`;

  return (
    <div
      className="usersPage__overlay"
      role="presentation"
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        className="usersPage__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="usersPage__dialogHead">
          <h2 id={titleId} className="usersPage__dialogTitle">
            {reuploadTarget ? `Reupload report #${reuploadTarget.id}` : "Upload reports"}
          </h2>
          <button
            type="button"
            className="usersPage__dialogClose"
            onClick={close}
            disabled={uploading}
            aria-label="Close"
          >
            <X size={18} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
        <div className="usersPage__dialogBody">
          <label className="usersPage__label usersPage__label--withIcon" htmlFor={suggestedNameId}>
            <Tag className="usersPage__labelIcon" size={16} strokeWidth={2} aria-hidden />
            <span>Suggested name</span>
          </label>
          <input
            id={suggestedNameId}
            type="text"
            className="usersPage__input"
            placeholder="e.g. Q1 2026 reports import"
            value={suggestedName}
            onChange={(e) => setSuggestedName(e.target.value)}
            autoComplete="off"
            maxLength={256}
            disabled={uploading}
          />

          <div className="usersPage__fileField">
            <span
              id={`${fileInputId}-label`}
              className="usersPage__label usersPage__label--withIcon"
            >
              <Upload className="usersPage__labelIcon" size={16} strokeWidth={2} aria-hidden />
              <span>Report file</span>
            </span>
            <div
              className={[
                "usersPage__fileDrop",
                dragActive ? "usersPage__fileDrop--active" : "",
                selectedFile ? "usersPage__fileDrop--hasFile" : "",
                uploading ? "usersPage__fileDrop--disabled" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              role="button"
              tabIndex={uploading ? -1 : 0}
              aria-labelledby={`${fileInputId}-label`}
              aria-describedby={`${fileInputId}-hint`}
              aria-disabled={uploading}
              onClick={openFilePicker}
              onKeyDown={(event) => {
                if (uploading) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openFilePicker();
                }
              }}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              {selectedFile ? (
                <>
                  <FileSpreadsheet
                    className="usersPage__fileDropIcon usersPage__fileDropIcon--selected"
                    size={22}
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  <span className="usersPage__fileDropName">{selectedFile.name}</span>
                  <span className="usersPage__fileDropMeta">
                    {formatFileSize(selectedFile.size)}
                  </span>
                  <span className="usersPage__fileDropAction" id={`${fileInputId}-hint`}>
                    Click or drop to replace
                  </span>
                </>
              ) : (
                <>
                  <Upload
                    className="usersPage__fileDropIcon"
                    size={22}
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  <span className="usersPage__fileDropPrompt">
                    Choose a file or drag it here
                  </span>
                  <span id={`${fileInputId}-hint`} className="usersPage__fileDropHint">
                    CSV or Excel (.csv, .xlsx, .xls)
                  </span>
                </>
              )}
            </div>
            <input
              ref={fileInputRef}
              id={fileInputId}
              type="file"
              accept={ACCEPTED_MIME}
              className="usersPage__visuallyHidden"
              disabled={uploading}
              onChange={(e) => {
                selectFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>

          {uploading ? (
            <div
              className="usersPage__uploadProgress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={uploadProgress ?? 0}
              aria-label="Upload progress"
            >
              <div className="usersPage__uploadProgressLabel">
                <span>
                  {reuploadTarget ? "Reuploading file…" : "Uploading file…"}
                </span>
                <span>{uploadProgress ?? 0}%</span>
              </div>
              <div className="usersPage__uploadProgressTrack">
                <div
                  className="usersPage__uploadProgressBar"
                  style={{ width: `${uploadProgress ?? 0}%` }}
                />
              </div>
            </div>
          ) : null}

          <div className="usersPage__dialogActions">
            <button
              type="button"
              className="usersPage__btn usersPage__btn--logoutTone"
              onClick={close}
              disabled={uploading}
            >
              <CircleX size={16} strokeWidth={1.75} aria-hidden />
              Cancel
            </button>
            <button
              type="button"
              className="usersPage__btn usersPage__btn--primary usersPage__btn--inviteSend"
              onClick={handleSubmit}
              disabled={uploading}
              aria-busy={uploading}
            >
              <Upload size={16} strokeWidth={2} aria-hidden />
              {uploading
                ? reuploadTarget
                  ? "Reuploading…"
                  : "Uploading…"
                : reuploadTarget
                  ? "Reupload"
                  : "Upload"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
