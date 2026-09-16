"""
CLI for Node bridge — risk extraction.

Request:
  {"op": "extract_risk", "text": "...", "title": "...", "url": "..."}

Response:
  {"ok": true, "object": {...}, "source_flag": "local-llm", "model": "..."}
  {"ok": false, "error": "StubExtraction", "message": "...", "source_flag": "stub"}
"""

from __future__ import annotations

import json
import sys

from app.env_bootstrap import bootstrap_env

bootstrap_env()

from app.extraction.extract_utils import (
    _is_stub_object,
    extract_with_auto_chunking,
    get_current_model_name,
    load_risk_schema,
)


from app.llm.model_config import set_model


def main() -> int:
    try:
        req = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        json.dump({"ok": False, "error": "InvalidJSON", "message": str(exc)}, sys.stdout)
        return 1

    op = req.get("op")
    if op != "extract_risk":
        json.dump(
            {"ok": False, "error": "BadOp", "message": f"unknown op: {op}"},
            sys.stdout,
        )
        return 1

    text = req.get("text") or ""
    title = req.get("title") or ""
    url = req.get("url") or ""
    model_id = req.get("modelId") or req.get("model_id") or ""

    if not text.strip():
        json.dump(
            {"ok": False, "error": "EmptyText", "message": "no text to extract"},
            sys.stdout,
        )
        return 1

    try:
        if str(model_id).strip():
            set_model(str(model_id).strip())

        schema = load_risk_schema()
        obj, source_flag, metrics = extract_with_auto_chunking(
            text,
            schema,
            title=title,
            source_url=url,
        )
        
        if _is_stub_object(obj) or source_flag == "stub":
            json.dump(
                {
                    "ok": False,
                    "error": "StubExtraction",
                    "message": "LLM returned stub/fallback extraction",
                    "source_flag": "stub",
                    "object": obj,
                    "metrics": metrics,
                },
                sys.stdout,
            )
            return 0

        json.dump(
            {
                "ok": True,
                "object": obj,
                "source_flag": source_flag,
                "model": get_current_model_name(),
                "metrics": metrics,
            },
            sys.stdout,
        )
        return 0
    except Exception as exc:
        json.dump(
            {"ok": False, "error": type(exc).__name__, "message": str(exc)},
            sys.stdout,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
