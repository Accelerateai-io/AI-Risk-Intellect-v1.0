"""Dialogflow-style fulfillment JSON for model test / invoke demo responses."""

from __future__ import annotations

import json
import time
from typing import Any


def build_model_fulfillment_response(
    *,
    success: bool,
    text: str,
    model_id: str | None = None,
    invoke_model_id: str | None = None,
    prompt: str | None = None,
    latency_ms: int | None = None,
    usage: dict[str, Any] | None = None,
    session_id: str | None = None,
) -> dict[str, Any]:
    resolved_session = session_id or f"llm-model-{int(time.time() * 1000)}"
    context_name = (
        f"projects/ai-risk-intellect/agent/sessions/{resolved_session}"
        "/contexts/model_test_result"
    )

    parameters: dict[str, Any] = {
        "model_id": model_id or "",
        "invoke_model_id": invoke_model_id or "",
        "model_working": success,
    }
    if prompt:
        parameters["prompt"] = prompt
    if latency_ms is not None:
        parameters["latency_ms"] = latency_ms
    if usage:
        parameters["usage"] = usage

    return {
        "status": "success" if success else "error",
        "fulfillmentText": text,
        "fulfillmentMessages": [{"text": {"text": [text]}}],
        "outputContexts": [
            {
                "name": context_name,
                "lifespanCount": 5 if success else 1,
                "parameters": parameters,
            }
        ],
        "endInteraction": not success,
    }


def print_model_fulfillment_to_terminal(label: str, fulfillment: dict[str, Any]) -> None:
    print(f"\n[{label}]\n{json.dumps(fulfillment, indent=2)}\n")
