import { useRef, type ChangeEvent } from "react";
import { Upload } from "lucide-react";

export type EtlUploadStatus = "idle" | "uploading" | "uploaded" | "error";

interface EtlUploadRowProps {
  label: string;
  status: EtlUploadStatus;
  fileName: string | null;
  uploading: boolean;
  inputId: string;
  onFileSelected?: (file: File) => void;
  onUploadClick?: () => void;
}

function statusPillClass(status: EtlUploadStatus): string {
  if (status === "uploaded") return "adminPage__statusPill--running";
  if (status === "uploading") return "adminPage__statusPill--pending";
  if (status === "error") return "adminPage__statusPill--stopped";
  return "adminPage__statusPill--stopped";
}

function statusLabel(
  status: EtlUploadStatus,
  fileName: string | null,
): string {
  if (status === "uploading") return "Uploading…";
  if (status === "uploaded") return "Uploaded";
  if (status === "error") return "Failed";
  if (fileName) return "File selected";
  return "No file";
}

export function EtlUploadRow({
  label,
  status,
  fileName,
  uploading,
  inputId,
  onFileSelected,
  onUploadClick,
}: EtlUploadRowProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function openFilePicker() {
    if (onUploadClick) {
      onUploadClick();
      return;
    }
    inputRef.current?.click();
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !onFileSelected) return;
    onFileSelected(file);
  }

  return (
    <li className="adminPage__serviceRow">
      <span className="adminPage__serviceName">{label}</span>
      <span
        role="status"
        className={`adminPage__statusPill ${statusPillClass(status)}`}
        aria-live="polite"
      >
        <span className="adminPage__statusPillDot" aria-hidden />
        {statusLabel(status, fileName)}
      </span>
      <div className="adminPage__serviceActions">
        <button
          type="button"
          className="usersPage__btn usersPage__btn--primary usersPage__btn--inviteSend"
          onClick={openFilePicker}
          disabled={uploading}
          aria-busy={uploading}
        >
          <Upload size={16} strokeWidth={2} aria-hidden />
          {uploading ? "Uploading…" : "Upload CSV"}
        </button>
      </div>
      {!onUploadClick ? (
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept=".csv,text/csv"
          className="adminPage__visuallyHidden"
          onChange={handleChange}
        />
      ) : null}
    </li>
  );
}
