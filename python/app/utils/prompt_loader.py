"""Load active system prompt (static file; DB PromptVersion optional later).

Reads the prompt file directly so callers (Bedrock/OpenAI backends, the
synthesis and verifier passes) never import the local HuggingFace backend,
which pulls in torch at import time.
"""

from __future__ import annotations

from pathlib import Path

_PROMPT_PATH = Path(__file__).resolve().parent.parent / "llm" / "system_prompt.txt"


def get_active_prompt() -> str:
    with _PROMPT_PATH.open(encoding="utf-8") as handle:
        return handle.read()


def get_few_shot_block() -> str:
    """Few-shot examples from gold feedback samples (disabled by default)."""
    import os

    if os.getenv("ENABLE_FEW_SHOT", "false").lower() not in ("1", "true", "yes"):
        return ""
    return ""
