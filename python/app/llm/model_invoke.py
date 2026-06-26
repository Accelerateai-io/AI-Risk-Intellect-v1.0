"""Bedrock model test and prompt invoke helpers for demo / Postman use."""

from __future__ import annotations

import os
import time
from typing import Any

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from app.llm.bedrock_model_id import resolve_bedrock_invoke_model_id
from app.llm.model_config import _bedrock_model_id, _get_catalog_model
from app.llm.model_fulfillment import (
    build_model_fulfillment_response,
    print_model_fulfillment_to_terminal,
)

TEST_PROMPT = "Reply with the single word OK."
DEFAULT_INVOKE_MAX_TOKENS = 512


def _bedrock_region() -> str:
    return (
        os.getenv("AWS_REGION", "").strip()
        or os.getenv("AWS_DEFAULT_REGION", "").strip()
        or "us-east-1"
    )


def _is_text_generation_model(model_id: str) -> bool:
    catalog = _get_catalog_model(model_id)
    if not catalog:
        return False
    outputs = {str(m).upper() for m in catalog.get("outputModalities") or []}
    inputs = {str(m).upper() for m in catalog.get("inputModalities") or []}
    return "TEXT" in outputs and "TEXT" in inputs


def _format_bedrock_error(err: BaseException) -> str:
    if isinstance(err, ClientError):
        code = err.response.get("Error", {}).get("Code", "")
        detail = (err.response.get("Error", {}).get("Message") or "").strip()
        if code == "AccessDeniedException":
            return "Model is not enabled in your AWS account."
        if code == "ValidationException":
            return detail or "This model is not supported for inference."
        if code == "ResourceNotFoundException":
            return "Model was not found in Bedrock."
        if code in {"ThrottlingException", "TooManyRequestsException"}:
            return "Bedrock rate limit reached. Try again in a moment."
        if detail:
            return detail
    message = str(err).strip()
    return message or "Model test failed."


def _runtime_client():
    return boto3.client("bedrock-runtime", region_name=_bedrock_region())


def _converse(
    *,
    invoke_id: str,
    prompt: str,
    max_tokens: int,
    temperature: float,
) -> dict[str, Any]:
    client = _runtime_client()
    return client.converse(
        modelId=invoke_id,
        messages=[{"role": "user", "content": [{"text": prompt}]}],
        inferenceConfig={
            "maxTokens": max_tokens,
            "temperature": temperature,
        },
    )


def _extract_text(response: dict[str, Any]) -> str:
    content = (
        response.get("output", {})
        .get("message", {})
        .get("content", [])
    )
    for block in content:
        text = block.get("text")
        if isinstance(text, str) and text.strip():
            return text.strip()
    return ""


def _finalize_result(
    *,
    label: str,
    result: dict[str, Any],
    fulfillment_text: str,
    prompt: str | None = None,
    usage: dict[str, Any] | None = None,
) -> dict[str, Any]:
    fulfillment = build_model_fulfillment_response(
        success=bool(result.get("success")),
        text=fulfillment_text,
        model_id=str(result.get("modelId") or ""),
        invoke_model_id=str(result.get("invokeModelId") or ""),
        prompt=prompt,
        latency_ms=result.get("latencyMs"),
        usage=usage,
    )
    print_model_fulfillment_to_terminal(label, fulfillment)
    return {**result, "fulfillmentResponse": fulfillment}


def test_bedrock_model(model_id: str) -> dict[str, Any]:
    trimmed = (model_id or "").strip()
    if not trimmed:
        result = {"success": False, "message": "This model is not supported"}
        return _finalize_result(
            label="LLM model test",
            result=result,
            fulfillment_text=result["message"],
        )
    if not _is_text_generation_model(trimmed):
        result = {"success": False, "message": "This model is not supported"}
        return _finalize_result(
            label="LLM model test",
            result={**result, "modelId": trimmed},
            fulfillment_text=result["message"],
        )

    invoke_id = resolve_bedrock_invoke_model_id(_bedrock_model_id(trimmed))
    started_at = time.monotonic()

    try:
        response = _converse(
            invoke_id=invoke_id,
            prompt=TEST_PROMPT,
            max_tokens=16,
            temperature=0,
        )
        text = _extract_text(response)
        latency_ms = int((time.monotonic() - started_at) * 1000)
        base = {
            "modelId": trimmed,
            "invokeModelId": invoke_id,
            "latencyMs": latency_ms,
        }
        if not text:
            result = {
                **base,
                "success": False,
                "message": "Model responded without text output.",
            }
            return _finalize_result(
                label="LLM model test",
                result=result,
                fulfillment_text=result["message"],
                prompt=TEST_PROMPT,
            )
        result = {
            **base,
            "success": True,
            "message": "Model works",
            "response": text,
        }
        return _finalize_result(
            label="LLM model test",
            result=result,
            fulfillment_text=text,
            prompt=TEST_PROMPT,
        )
    except (ClientError, BotoCoreError) as err:
        message = _format_bedrock_error(err)
        result = {
            "success": False,
            "message": message,
            "modelId": trimmed,
            "invokeModelId": invoke_id,
            "latencyMs": int((time.monotonic() - started_at) * 1000),
        }
        return _finalize_result(
            label="LLM model test",
            result=result,
            fulfillment_text=message,
            prompt=TEST_PROMPT,
        )


def invoke_bedrock_model(
    *,
    model_id: str,
    prompt: str,
    max_tokens: int | None = None,
    temperature: float | None = None,
) -> dict[str, Any]:
    trimmed = (model_id or "").strip()
    prompt_text = (prompt or "").strip()
    if not trimmed:
        result = {"success": False, "message": "This model is not supported"}
        return _finalize_result(
            label="LLM model invoke",
            result=result,
            fulfillment_text=result["message"],
        )
    if not prompt_text:
        result = {"success": False, "message": "Prompt is required."}
        return _finalize_result(
            label="LLM model invoke",
            result=result,
            fulfillment_text=result["message"],
        )
    if not _is_text_generation_model(trimmed):
        result = {"success": False, "message": "This model is not supported"}
        return _finalize_result(
            label="LLM model invoke",
            result={**result, "modelId": trimmed},
            fulfillment_text=result["message"],
        )

    invoke_id = resolve_bedrock_invoke_model_id(_bedrock_model_id(trimmed))
    resolved_max_tokens = max_tokens if max_tokens is not None else DEFAULT_INVOKE_MAX_TOKENS
    resolved_temperature = temperature if temperature is not None else 0.7
    started_at = time.monotonic()

    try:
        response = _converse(
            invoke_id=invoke_id,
            prompt=prompt_text,
            max_tokens=resolved_max_tokens,
            temperature=resolved_temperature,
        )
        text = _extract_text(response)
        usage = {
            "inputTokens": (response.get("usage") or {}).get("inputTokens"),
            "outputTokens": (response.get("usage") or {}).get("outputTokens"),
            "totalTokens": (response.get("usage") or {}).get("totalTokens"),
        }
        latency_ms = int((time.monotonic() - started_at) * 1000)
        base = {
            "modelId": trimmed,
            "invokeModelId": invoke_id,
            "prompt": prompt_text,
            "latencyMs": latency_ms,
        }
        if not text:
            result = {
                **base,
                "success": False,
                "message": "Model responded without text output.",
            }
            return _finalize_result(
                label="LLM model invoke",
                result=result,
                fulfillment_text=result["message"],
                prompt=prompt_text,
            )
        result = {
            **base,
            "success": True,
            "message": "Model response received.",
            "response": text,
            "usage": usage,
        }
        return _finalize_result(
            label="LLM model invoke",
            result=result,
            fulfillment_text=text,
            prompt=prompt_text,
            usage=usage,
        )
    except (ClientError, BotoCoreError) as err:
        message = _format_bedrock_error(err)
        result = {
            "success": False,
            "message": message,
            "modelId": trimmed,
            "invokeModelId": invoke_id,
            "prompt": prompt_text,
            "latencyMs": int((time.monotonic() - started_at) * 1000),
        }
        return _finalize_result(
            label="LLM model invoke",
            result=result,
            fulfillment_text=message,
            prompt=prompt_text,
        )
