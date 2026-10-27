"""Model capability registry (BUG-05 / BUG-10 / BUG-11).

Pure lookup tables, no I/O. Answers three questions the extraction path needs
before it decides how to call a model:

* ``context_window_tokens(model_id)`` - how much input the model accepts, so a
  whole paper can go through in a single call instead of 1024-token chunks.
* ``supports_prompt_cache(model_id)`` - whether Bedrock Converse accepts
  ``cachePoint`` blocks for this model (Anthropic Claude 3.5 Haiku and later,
  Amazon Nova).
* ``estimate_tokens(text)`` - a conservative chars-per-token estimate used when
  no tokenizer is available (all Bedrock models).

Matching is by substring on the lower-cased model id with the region prefix
stripped, so ``us.anthropic.claude-haiku-4-5-20251001-v1:0`` and
``anthropic.claude-haiku-4-5`` resolve the same way. Unknown models fall back
to a conservative 32k window so chunking still happens rather than a failed
request.

Override per deployment with ``MODEL_CONTEXT_TOKENS`` (an integer) when a
model is missing from the table.
"""

from __future__ import annotations

import os
import re

# Fallback for ids not in the table: small enough to be safe for every
# text-generation model on Bedrock today.
DEFAULT_CONTEXT_TOKENS = 32_000

# Ordered: first match wins, so more specific patterns come first.
_CONTEXT_WINDOWS: tuple[tuple[str, int], ...] = (
    # Anthropic
    ("claude-fable", 1_000_000),
    ("claude-opus-5", 1_000_000),
    ("claude-sonnet-5", 1_000_000),
    ("claude-haiku-5", 1_000_000),
    ("claude-opus-4", 200_000),
    ("claude-sonnet-4", 200_000),
    ("claude-haiku-4", 200_000),
    ("claude-3-7", 200_000),
    ("claude-3-5", 200_000),
    ("claude-3-", 200_000),
    # Amazon Nova
    ("nova-2", 1_000_000),
    ("nova-premier", 1_000_000),
    ("nova-pro", 300_000),
    ("nova-lite", 300_000),
    ("nova-micro", 128_000),
    # DeepSeek
    ("deepseek.v3", 128_000),
    ("deepseek.r1", 128_000),
    # Meta
    ("llama4", 1_000_000),
    ("llama3-3", 128_000),
    ("llama3-2", 128_000),
    ("llama3-1", 128_000),
    # Mistral
    ("mistral-large", 128_000),
    ("pixtral", 128_000),
    ("mixtral", 32_000),
    # OpenAI open-weight on Bedrock
    ("gpt-oss", 128_000),
    # xAI
    ("grok", 256_000),
    # Qwen
    ("qwen3", 128_000),
    ("qwen2", 32_000),
    # Cohere
    ("command-r", 128_000),
)

# Prompt caching via Converse cachePoint is supported for these families.
_PROMPT_CACHE_FAMILIES: tuple[str, ...] = (
    "claude-fable",
    "claude-opus-5",
    "claude-sonnet-5",
    "claude-haiku-5",
    "claude-opus-4",
    "claude-sonnet-4",
    "claude-haiku-4",
    "claude-3-7",
    "claude-3-5-haiku",
    "nova-",
)

# Models whose Bedrock request/response shape is the Anthropic Messages API.
# Only these may use the legacy invoke_model path and the Anthropic tool-use
# loop; everything else must go through Converse (BUG-11).
_ANTHROPIC_FAMILY = ("anthropic.",)

_PREFIX_RE = re.compile(r"^(us|eu|apac|global)\.", re.IGNORECASE)


def _norm(model_id: str | None) -> str:
    mid = (model_id or "").strip().lower()
    return _PREFIX_RE.sub("", mid)


def is_anthropic_model(model_id: str | None) -> bool:
    return _norm(model_id).startswith(_ANTHROPIC_FAMILY)


def context_window_tokens(model_id: str | None) -> int:
    """Input context window in tokens for ``model_id``.

    ``MODEL_CONTEXT_TOKENS`` overrides the table for every model when set to a
    positive integer; invalid values are ignored.
    """
    override = os.getenv("MODEL_CONTEXT_TOKENS", "").strip()
    if override:
        try:
            value = int(override)
            if value > 0:
                return value
        except ValueError:
            pass
    mid = _norm(model_id)
    for needle, window in _CONTEXT_WINDOWS:
        if needle in mid:
            return window
    return DEFAULT_CONTEXT_TOKENS


def supports_prompt_cache(model_id: str | None) -> bool:
    mid = _norm(model_id)
    return any(family in mid for family in _PROMPT_CACHE_FAMILIES)


# Conservative: English prose runs ~4 chars/token; scientific text with
# numbers, symbols and citations runs closer to 3.2. Using 3.5 keeps the
# whole-document decision on the safe side of the context limit.
CHARS_PER_TOKEN = 3.5


def estimate_tokens(text: str | None) -> int:
    if not text:
        return 0
    return int(len(text) / CHARS_PER_TOKEN) + 1
