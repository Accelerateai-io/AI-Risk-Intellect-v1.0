"""Bedrock model id helpers — region-aware cross-region inference profile prefix."""

from __future__ import annotations

import os
import re

_BEDROCK_MODEL_ID_RE = re.compile(
    r"^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9.:-]*$",
    re.IGNORECASE,
)

# Catalog ids like …:v1:0:200k are not valid for bedrock-runtime invoke_model.
_INVOKE_CONTEXT_SUFFIX_RE = re.compile(r":(?:28|48|200)k$", re.IGNORECASE)

# Known Bedrock cross-region inference profile prefixes.
_PROFILE_PREFIXES = ("us.", "eu.", "apac.", "global.")

# AWS region geo token -> inference profile prefix (without the trailing dot).
_REGION_GEO_TO_PREFIX = {"us": "us", "eu": "eu", "ap": "apac", "global": "global"}

# Preserve the original single-region behaviour when nothing is configured.
_DEFAULT_PROFILE_PREFIX = "us"


def bedrock_profile_prefix() -> str:
    """Inference-profile prefix: 'us.', 'eu.', 'apac.' or 'global.' (BUG-12).

    Resolved from BEDROCK_PROFILE_PREFIX when set, otherwise derived from
    AWS_REGION / AWS_DEFAULT_REGION. Falls back to 'us.' when nothing is set so
    existing single-region deployments behave exactly as before.
    """
    explicit = os.getenv("BEDROCK_PROFILE_PREFIX", "").strip().lower().rstrip(".")
    if explicit:
        return f"{explicit}."
    region = (
        os.getenv("AWS_REGION", "").strip()
        or os.getenv("AWS_DEFAULT_REGION", "").strip()
    ).lower()
    geo = region.split("-", 1)[0] if region else ""
    return f"{_REGION_GEO_TO_PREFIX.get(geo, _DEFAULT_PROFILE_PREFIX)}."


def _has_profile_prefix(model_id: str) -> bool:
    low = model_id.lower()
    return any(low.startswith(p) for p in _PROFILE_PREFIXES)


def strip_us_model_prefix(model_id: str) -> str:
    """Strip any region inference-profile prefix (us./eu./apac./global.).

    Name kept for backward compatibility with existing imports.
    """
    trimmed = (model_id or "").strip()
    low = trimmed.lower()
    for prefix in _PROFILE_PREFIXES:
        if low.startswith(prefix):
            return trimmed[len(prefix):]
    return trimmed


def is_bedrock_provider_model_id(model_id: str) -> bool:
    trimmed = (model_id or "").strip()
    if not trimmed or "/" in trimmed:
        return False
    return bool(_BEDROCK_MODEL_ID_RE.match(trimmed))


def with_us_model_prefix(model_id: str) -> str:
    """Apply the region-derived inference-profile prefix to a provider model id.

    Name kept for backward compatibility; the prefix is region-aware (BUG-12).
    """
    trimmed = (model_id or "").strip()
    if not trimmed:
        return trimmed
    if _has_profile_prefix(trimmed):
        return trimmed
    if is_bedrock_provider_model_id(trimmed):
        return f"{bedrock_profile_prefix()}{trimmed}"
    return trimmed


def _enforce_region_enabled() -> bool:
    return os.getenv("BEDROCK_ENFORCE_REGION", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def assert_model_region_compatible(model_id: str) -> str:
    """Refuse to route a region-pinned model to a different geography (BUG-12, TC-34).

    Opt-in via BEDROCK_ENFORCE_REGION=true (default off). When enabled, if the
    model id carries an explicit region profile prefix (us./eu./apac.) that
    conflicts with the resolved profile prefix — e.g. resolved 'eu.' but the id
    starts with 'us.' — raise an error naming both. 'global.' is multi-region and
    never conflicts. Returns the id unchanged when compatible or when enforcement
    is off.

    Default is off on purpose: prod may legitimately run an EU region with a
    us.* model id saved (e.g. us.deepseek.r1-v1:0), and enforcing by default
    would halt extraction on deploy.
    """
    trimmed = (model_id or "").strip()
    if not trimmed or not _enforce_region_enabled():
        return trimmed
    resolved = bedrock_profile_prefix()
    low = trimmed.lower()
    model_prefix = next((p for p in _PROFILE_PREFIXES if low.startswith(p)), "")
    if (
        model_prefix
        and model_prefix != "global."
        and resolved != "global."
        and model_prefix != resolved
    ):
        raise ValueError(
            f"Bedrock region mismatch: resolved inference-profile prefix is "
            f"'{resolved}' (from AWS_REGION / BEDROCK_PROFILE_PREFIX) but model id "
            f"'{trimmed}' targets the '{model_prefix}' geography. Pick a "
            f"'{resolved}' model or unset BEDROCK_ENFORCE_REGION to bypass."
        )
    return trimmed


def resolve_bedrock_invoke_model_id(model_id: str) -> str:
    """Map env/catalog ids to a model id accepted by bedrock-runtime invoke_model."""
    assert_model_region_compatible(model_id)
    trimmed = with_us_model_prefix((model_id or "").strip())
    if not trimmed:
        return trimmed
    return _INVOKE_CONTEXT_SUFFIX_RE.sub("", trimmed)
