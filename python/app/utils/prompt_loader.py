"""Load active system prompt (static file; DB PromptVersion optional later)."""

from __future__ import annotations


def get_active_prompt() -> str:
    from app.llm.local_llm import _load_system_prompt

    return _load_system_prompt()


def get_few_shot_block() -> str:
    """Few-shot examples from gold feedback samples (disabled by default)."""
    import os

    if os.getenv("ENABLE_FEW_SHOT", "false").lower() not in ("1", "true", "yes"):
        return ""
    return ""
