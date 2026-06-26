import { Play, Square } from "lucide-react";
import {
  isServiceBusy,
  serviceStatusLabel,
  serviceStatusPillClass,
  type ServiceState,
} from "./adminServices";

export type AdminServiceRowProps = {
  label: string;
  status: ServiceState;
  apiRunning: boolean;
  /** When true, Start stays enabled if the process is up but idle (queue empty). */
  allowStartWhileIdle?: boolean;
  onStart: () => void;
  onStop: () => void;
};

export function AdminServiceRow({
  label,
  status,
  apiRunning,
  allowStartWhileIdle = false,
  onStart,
  onStop,
}: AdminServiceRowProps) {
  const busy = isServiceBusy(status);
  const canStart =
    !busy && (!apiRunning || (allowStartWhileIdle && status === "idle"));
  const canStop = !busy && apiRunning;

  return (
    <li className="adminPage__serviceRow">
      <span className="adminPage__serviceName">{label}</span>
      <span
        role="status"
        className={`adminPage__statusPill ${serviceStatusPillClass(status)}`}
        aria-live="polite"
      >
        <span className="adminPage__statusPillDot" aria-hidden />
        {serviceStatusLabel(status)}
      </span>
      <div className="adminPage__serviceActions">
        <button
          type="button"
          className="usersPage__btn usersPage__btn--primary usersPage__btn--inviteSend"
          onClick={onStart}
          disabled={!canStart || busy}
        >
          <Play size={16} strokeWidth={2} aria-hidden />
          Start
        </button>
        <button
          type="button"
          className="usersPage__btn usersPage__btn--logoutTone"
          onClick={onStop}
          disabled={!canStop || busy}
        >
          <Square size={14} strokeWidth={2} aria-hidden />
          Stop
        </button>
      </div>
    </li>
  );
}
