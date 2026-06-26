"""LLM model listing and runtime selection for the Python ingestion service."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Literal, TypedDict

from app.env_bootstrap import normalize_bedrock_model
from app.llm.bedrock_llm import BedrockLLM
from app.llm.bedrock_model_id import strip_us_model_prefix, with_us_model_prefix

LlmBackend = Literal["bedrock", "local", "openai", "sagemaker", "cisco"]

_MODELS_JSON = (
    Path(__file__).resolve().parents[3] / "backend" / "models.json"
)

_cached_options: list["ModelOption"] | None = None
_cached_by_id: dict[str, dict[str, Any]] | None = None


class ModelOption(TypedDict):
    id: str
    label: str
    backend: LlmBackend


def _load_models_file() -> dict[str, Any]:
    if not _MODELS_JSON.is_file():
        raise FileNotFoundError(f"models.json not found at {_MODELS_JSON}")
    with _MODELS_JSON.open(encoding="utf-8") as handle:
        return json.load(handle)


def _is_text_generation(model: dict[str, Any]) -> bool:
    outputs = {str(m).upper() for m in model.get("outputModalities") or []}
    inputs = {str(m).upper() for m in model.get("inputModalities") or []}
    return "TEXT" in outputs and "TEXT" in inputs


def _option_label(model: dict[str, Any]) -> str:
    name = str(model.get("name") or model.get("modelId") or "").strip()
    provider = str(model.get("provider") or "").strip()
    return f"{name} ({provider})" if provider else name


def _build_cache() -> None:
    global _cached_options, _cached_by_id
    payload = _load_models_file()
    by_id: dict[str, dict[str, Any]] = {}
    options: list[ModelOption] = []

    # Include LEGACY models in the picker (e.g. Claude 3 Sonnet). That is generally
    # not recommended — AWS may block or retire those endpoints.
    for model in payload.get("models") or []:
        if not isinstance(model, dict):
            continue
        model_id = str(model.get("modelId") or "").strip()
        if not model_id:
            continue
        if not _is_text_generation(model):
            continue

        resolved_id = with_us_model_prefix(model_id)
        by_id[model_id] = model
        by_id[resolved_id] = model
        options.append(
            {
                "id": resolved_id,
                "label": _option_label(model),
                "backend": "bedrock",
            }
        )

    options.sort(key=lambda item: item["label"].lower())
    _cached_by_id = by_id
    _cached_options = options


def _get_catalog_model(model_id: str) -> dict[str, Any] | None:
    if _cached_by_id is None:
        _build_cache()
    assert _cached_by_id is not None

    exact = _cached_by_id.get(model_id)
    if exact:
        return exact

    normalized = model_id.strip()
    candidates = {
        normalized,
        strip_us_model_prefix(normalized),
        with_us_model_prefix(strip_us_model_prefix(normalized)),
    }
    for candidate in candidates:
        exact = _cached_by_id.get(candidate)
        if exact:
            return exact

    for candidate in candidates:
        for catalog_id, model in _cached_by_id.items():
            if (
                candidate == catalog_id
                or candidate.endswith(catalog_id)
                or catalog_id.endswith(candidate)
                or candidate in catalog_id
                or catalog_id in candidate
            ):
                return model
    return None


def _resolve_option(model_id: str) -> ModelOption | None:
    model = _get_catalog_model(model_id)
    if not model:
        return None
    return {
        "id": with_us_model_prefix(str(model["modelId"])),
        "label": _option_label(model),
        "backend": "bedrock",
    }


def _active_backend() -> LlmBackend:
    if os.getenv("USE_BEDROCK", "false").lower() == "true":
        return "bedrock"
    if os.getenv("USE_SAGEMAKER", "false").lower() == "true":
        return "sagemaker"
    if os.getenv("USE_OPENAI", "false").lower() == "true":
        return "openai"
    if os.getenv("USE_CISCO", "false").lower() == "true":
        return "cisco"
    return "local"


def _current_model_id() -> str:
    backend = _active_backend()
    if backend == "bedrock":
        return (
            os.getenv("BEDROCK_MODEL", "").strip()
            or os.getenv("BEDROCK_MODEL_ID", "").strip()
            or ""
        )
    if backend == "openai":
        return os.getenv("OPENAI_MODEL", "gpt-5-mini").strip() or "gpt-5-mini"
    if backend == "sagemaker":
        return (
            os.getenv("SAGEMAKER_MODEL_NAME", "foundation-sec-8b").strip()
            or "foundation-sec-8b"
        )
    if backend == "cisco":
        return (
            os.getenv("CISCO_MODEL_NAME", "foundation-sec-8b").strip()
            or "foundation-sec-8b"
        )
    return os.getenv("LOCAL_MODEL_ID", "Qwen/Qwen2.5-3B-Instruct").strip()


def _bedrock_model_id(model_id: str) -> str:
    model_id = normalize_bedrock_model(model_id)
    catalog = _get_catalog_model(model_id)
    if catalog:
        return with_us_model_prefix(str(catalog["modelId"]))
    if model_id in BedrockLLM.MODELS:
        return BedrockLLM.MODELS[model_id]
    return with_us_model_prefix(model_id)


def list_model_options() -> list[ModelOption]:
    if _cached_options is None:
        _build_cache()
    assert _cached_options is not None

    options = list(_cached_options)
    current = _current_model_id()
    if current and not _resolve_option(current):
        options = [
            {
                "id": current,
                "label": f"Current ({current})",
                "backend": _active_backend(),
            },
            *options,
        ]
    return options


def get_model_config() -> dict[str, Any]:
    backend = _active_backend()
    model_id = _current_model_id()
    option = _resolve_option(model_id)
    return {
        "backend": backend,
        "modelId": model_id,
        "modelLabel": option["label"] if option else model_id,
        "bedrockModelId": _bedrock_model_id(model_id) if backend == "bedrock" else None,
        "options": list_model_options(),
        "requiresPythonRestart": backend == "local",
    }


def _clear_bedrock_singleton() -> None:
    import app.llm.bedrock_llm as bedrock_module

    bedrock_module._bedrock_client = None


def _disable_other_backends() -> None:
    os.environ["USE_BEDROCK"] = "false"
    os.environ["USE_SAGEMAKER"] = "false"
    os.environ["USE_OPENAI"] = "false"
    os.environ["USE_CISCO"] = "false"


def set_model(model_id: str) -> dict[str, Any]:
    model_id = normalize_bedrock_model(model_id.strip())
    if not model_id:
        raise ValueError("modelId is required")

    option = _resolve_option(model_id)
    if not option and _active_backend() == "bedrock":
        if not (
            model_id in BedrockLLM.MODELS
            or model_id.startswith("us.anthropic.")
            or model_id.startswith("anthropic.")
            or "." in model_id
        ):
            raise ValueError(f"Model not found in models.json: {model_id}")

    _disable_other_backends()
    resolved = _bedrock_model_id(model_id)
    os.environ["USE_BEDROCK"] = "true"
    os.environ["BEDROCK_MODEL"] = resolved
    os.environ["BEDROCK_MODEL_ID"] = resolved
    _clear_bedrock_singleton()

    result = get_model_config()
    result["requiresPythonRestart"] = False
    return result
