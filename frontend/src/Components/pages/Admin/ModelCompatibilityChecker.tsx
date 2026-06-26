import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  applyLlmModel,
  fetchLlmModelConfig,
  testLlmModel,
  type LlmModelOption,
} from "../../../utils/llmModelApi";
import { LlmModelPicker } from "./LlmModelPicker";
import {
  ModelTestResultDialog,
  type ModelTestDialogState,
} from "./ModelTestResultDialog";

type TestResult = "success" | "failure" | null;

type ModelCompatibilityCheckerProps = {
  idPrefix: string;
};

function modelLabelFor(options: LlmModelOption[], modelId: string): string {
  return options.find((option) => option.id === modelId)?.label ?? modelId;
}

export function ModelCompatibilityChecker({
  idPrefix,
}: ModelCompatibilityCheckerProps) {
  const [options, setOptions] = useState<LlmModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [appliedModel, setAppliedModel] = useState("");
  const [appliedModelLabel, setAppliedModelLabel] = useState("");
  const [validatedModel, setValidatedModel] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [testResult, setTestResult] = useState<TestResult>(null);
  const [applyStatusMessage, setApplyStatusMessage] = useState("");
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [testDialogResult, setTestDialogResult] =
    useState<ModelTestDialogState | null>(null);

  const loadConfig = useCallback(async () => {
    const token = sessionStorage.getItem("accessToken");
    if (!token) {
      setOptionsLoading(false);
      return;
    }

    setOptionsLoading(true);
    try {
      const result = await fetchLlmModelConfig();
      if (!result.ok) {
        setApplyStatusMessage(result.message);
        return;
      }

      setOptions(result.config.options);
      setSelectedModel(result.config.modelId);
      setAppliedModel(result.config.modelId);
      setAppliedModelLabel(result.config.modelLabel);
    } finally {
      setOptionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const handleModelChange = (modelId: string) => {
    setSelectedModel(modelId);
    setTestResult(null);
    setValidatedModel(null);
    setApplyStatusMessage("");
    setTestDialogOpen(false);
    setTestDialogResult(null);
  };

  const openTestDialog = (result: ModelTestDialogState) => {
    setTestDialogResult(result);
    setTestDialogOpen(true);
  };

  const handleTest = async () => {
    if (!selectedModel || isTesting || isApplying) return;

    setIsTesting(true);
    setTestResult(null);
    setValidatedModel(null);
    setApplyStatusMessage("");
    setTestDialogOpen(false);
    setTestDialogResult(null);

    const modelLabel = modelLabelFor(options, selectedModel);

    try {
      const result = await testLlmModel(selectedModel);

      if (!result.ok) {
        setTestResult("failure");
        openTestDialog({
          success: false,
          message: result.message,
          modelId: selectedModel,
          modelLabel,
        });
        return;
      }

      if (result.result.success) {
        setTestResult("success");
        setValidatedModel(selectedModel);
        openTestDialog({
          success: true,
          message: result.result.message,
          modelId: selectedModel,
          modelLabel,
          response: result.result.response,
          fulfillmentResponse: result.result.fulfillmentResponse,
        });
        return;
      }

      setTestResult("failure");
      openTestDialog({
        success: false,
        message: result.result.message,
        modelId: selectedModel,
        modelLabel,
        response: result.result.response,
        fulfillmentResponse: result.result.fulfillmentResponse,
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleApply = async () => {
    if (
      !selectedModel ||
      isApplying ||
      isTesting ||
      optionsLoading
    ) {
      return;
    }

    setIsApplying(true);
    try {
      const result = await applyLlmModel(selectedModel);
      if (!result.ok) {
        setTestResult("failure");
        setApplyStatusMessage(result.message);
        return;
      }

      setAppliedModel(result.config.modelId);
      setAppliedModelLabel(result.config.modelLabel);
      setSelectedModel(result.config.modelId);
      setApplyStatusMessage(`Active model set to ${result.config.modelLabel}.`);
    } finally {
      setIsApplying(false);
    }
  };

  const canTest =
    Boolean(selectedModel) &&
    !isTesting &&
    !isApplying &&
    !optionsLoading &&
    options.length > 0;

  const canApply =
    Boolean(selectedModel) &&
    validatedModel === selectedModel &&
    !isTesting &&
    !isApplying &&
    !optionsLoading &&
    options.length > 0;

  const applyStatusClassName =
    testResult === "failure"
      ? "adminPage__modelStatus adminPage__modelStatus--error"
      : applyStatusMessage.includes("Active model")
        ? "adminPage__modelStatus adminPage__modelStatus--success"
        : "adminPage__modelStatus";

  return (
    <>
      <div className="adminPage__modelField">
        <div className="adminPage__modelLabelRow">
          <label
            className="adminPage__modelLabel"
            htmlFor={`${idPrefix}-trigger`}
          >
            LLM model
          </label>
          <span
            className="adminPage__modelCurrent"
            role="status"
            aria-live="polite"
            title={appliedModel || undefined}
          >
            {optionsLoading
              ? "Loading…"
              : appliedModelLabel || appliedModel || "—"}
          </span>
        </div>

        <div className="adminPage__modelControls">
          <div className="adminPage__modelPickerRow">
            <LlmModelPicker
              idPrefix={idPrefix}
              options={options}
              value={selectedModel}
              onChange={handleModelChange}
              disabled={isApplying || isTesting || !options.length}
              loading={optionsLoading}
            />
          </div>

          <div className="adminPage__modelActions">
            <button
              type="button"
              className="adminPage__ghostBtn adminPage__modelTestBtn"
              onClick={() => void handleTest()}
              disabled={!canTest}
              aria-busy={isTesting}
            >
              {isTesting ? (
                <>
                  <Loader2
                    className="usersPage__spinner"
                    size={16}
                    aria-hidden
                  />
                  Testing…
                </>
              ) : (
                "Test"
              )}
            </button>
            <button
              type="button"
              className="usersPage__btn usersPage__btn--primary usersPage__btn--inviteSend adminPage__modelApplyBtn"
              onClick={() => void handleApply()}
              disabled={!canApply}
              aria-busy={isApplying}
            >
              {isApplying ? (
                <>
                  <Loader2
                    className="usersPage__spinner"
                    size={16}
                    aria-hidden
                  />
                  Applying…
                </>
              ) : (
                "Apply"
              )}
            </button>
          </div>
        </div>

        {applyStatusMessage ? (
          <p
            className={applyStatusClassName}
            role="status"
            aria-live="polite"
          >
            {applyStatusMessage}
          </p>
        ) : null}
      </div>

      <ModelTestResultDialog
        open={testDialogOpen}
        result={testDialogResult}
        onClose={() => setTestDialogOpen(false)}
      />
    </>
  );
}
