import { useId } from "react";
import { CheckCircle2, X, XCircle } from "lucide-react";
import type { LlmModelValidationResponse } from "../../../utils/llmModelApi";
import "../Users/usersPage.css";
import "./adminPage.css";

export type ModelTestDialogState = {
  success: boolean;
  message: string;
  modelId: string;
  modelLabel: string;
  response?: string;
  fulfillmentResponse?: LlmModelValidationResponse["fulfillmentResponse"];
};

interface ModelTestResultDialogProps {
  open: boolean;
  result: ModelTestDialogState | null;
  onClose: () => void;
}

export function ModelTestResultDialog({
  open,
  result,
  onClose,
}: ModelTestResultDialogProps) {
  const baseId = useId();

  if (!open || !result) return null;

  const displayMessage =
    result.fulfillmentResponse?.fulfillmentText ??
    result.response ??
    result.message;
  const modelWorking =
    result.fulfillmentResponse?.outputContexts?.[0]?.parameters?.model_working;
  const isSuccess = result.success;

  return (
    <div
      className="usersPage__overlay"
      role="presentation"
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <div
        className={`usersPage__dialog adminPage__modelTestDialog${
          isSuccess
            ? " adminPage__modelTestDialog--success"
            : " adminPage__modelTestDialog--error"
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${baseId}-title`}
      >
        <div className="usersPage__dialogHead">
          <h2 id={`${baseId}-title`} className="usersPage__dialogTitle">
            {isSuccess ? "Model test successful" : "Model test failed"}
          </h2>
          <button
            type="button"
            className="usersPage__dialogClose"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} strokeWidth={2} aria-hidden />
          </button>
        </div>

        <div className="usersPage__dialogBody">
          <div
            className={`adminPage__modelTestDialogBanner${
              isSuccess
                ? " adminPage__modelTestDialogBanner--success"
                : " adminPage__modelTestDialogBanner--error"
            }`}
            role="status"
          >
            {isSuccess ? (
              <CheckCircle2 size={22} strokeWidth={2} aria-hidden />
            ) : (
              <XCircle size={22} strokeWidth={2} aria-hidden />
            )}
            <span>{isSuccess ? "Model is working" : "Model is not working"}</span>
          </div>

          <dl className="adminPage__modelTestDialogMeta">
            <div className="adminPage__modelTestDialogRow">
              <dt>Model</dt>
              <dd title={result.modelId}>{result.modelLabel}</dd>
            </div>
            {typeof modelWorking === "boolean" ? (
              <div className="adminPage__modelTestDialogRow">
                <dt>Status</dt>
                <dd>{modelWorking ? "Working" : "Not working"}</dd>
              </div>
            ) : null}
          </dl>

          <div className="adminPage__modelTestDialogMessage">
            <p className="adminPage__modelTestDialogMessageLabel">Response</p>
            <p className="adminPage__modelTestDialogMessageText">
              {displayMessage}
            </p>
          </div>
        </div>

        <div className="usersPage__dialogActions">
          <button
            type="button"
            className="usersPage__btn usersPage__btn--primary usersPage__btn--inviteSend"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
