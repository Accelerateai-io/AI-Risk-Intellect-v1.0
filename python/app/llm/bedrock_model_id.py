"""Bedrock model id helpers — US cross-region inference profile prefix."""

from __future__ import annotations

import re

_BEDROCK_MODEL_ID_RE = re.compile(
    r"^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9.:-]*$",
    re.IGNORECASE,
)

# Catalog ids like …:v1:0:200k are not valid for bedrock-runtime invoke_model.
_INVOKE_CONTEXT_SUFFIX_RE = re.compile(r":(?:28|48|200)k$", re.IGNORECASE)


def strip_us_model_prefix(model_id: str) -> str:
    trimmed = (model_id or "").strip()
    if trimmed.lower().startswith("us."):
        return trimmed[3:]
    return trimmed


def is_bedrock_provider_model_id(model_id: str) -> bool:
    trimmed = (model_id or "").strip()
    if not trimmed or "/" in trimmed:
        return False
    return bool(_BEDROCK_MODEL_ID_RE.match(trimmed))


def with_us_model_prefix(model_id: str) -> str:
    trimmed = (model_id or "").strip()
    if not trimmed:
        return trimmed
    if trimmed.lower().startswith("us."):
        return trimmed
    if is_bedrock_provider_model_id(trimmed):
        return f"us.{trimmed}"
    return trimmed


def resolve_bedrock_invoke_model_id(model_id: str) -> str:
    """Map env/catalog ids to a model id accepted by bedrock-runtime invoke_model."""
    trimmed = with_us_model_prefix((model_id or "").strip())
    if not trimmed:
        return trimmed
    return _INVOKE_CONTEXT_SUFFIX_RE.sub("", trimmed)
