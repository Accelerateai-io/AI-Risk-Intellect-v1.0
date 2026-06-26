"""Translate short text to English using the active LLM backend."""

from __future__ import annotations

import json
import logging
import os
from typing import Any

logger = logging.getLogger("airisk")

USE_BEDROCK = os.getenv("USE_BEDROCK", "false").lower() == "true"
USE_SAGEMAKER = os.getenv("USE_SAGEMAKER", "false").lower() == "true"
USE_OPENAI = os.getenv("USE_OPENAI", "false").lower() == "true"
USE_CISCO = os.getenv("USE_CISCO", "false").lower() == "true"

if USE_BEDROCK:
    from app.llm.bedrock_llm import generate_json
elif USE_SAGEMAKER:
    from app.llm.sagemaker_llm import generate_json
elif USE_OPENAI:
    from app.llm.openai_llm import generate_json
elif USE_CISCO:
    from app.llm.cisco_llm import generate_json
else:
    from app.llm.local_llm import generate_json

TRANSLATE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "english_text": {"type": "string"},
    },
    "required": ["english_text"],
    "additionalProperties": False,
}

TRANSLATE_SYSTEM_PROMPT = (
    "You translate text into English. "
    "Return only valid JSON with a single english_text field containing the translation. "
    "Do not add explanations, labels, or markdown."
)


def translate_text_to_english(text: str) -> str | None:
    sample = (text or "").strip()
    if not sample:
        return None

    try:
        obj = generate_json(
            f"Translate this text to English:\n\n{sample}",
            TRANSLATE_SCHEMA,
            max_new_tokens=256,
            system_prompt_override=TRANSLATE_SYSTEM_PROMPT,
        )
    except Exception as exc:
        logger.warning("translate_text_to_english failed: %s", exc)
        return None

    if not isinstance(obj, dict):
        return None

    result = str(obj.get("english_text") or "").strip()
    return result or None
