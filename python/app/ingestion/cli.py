"""
CLI for Node.js bridge — read JSON from stdin, write JSON to stdout.

Request:
  {"op": "ingest_pdf", "url": "...", "title": "...", "pdf_base64": "..."}
  {"op": "ingest_raw", "url": "...", "title": "...", "raw_text": "..."}

Response:
  {"ok": true, "text": "...", "title": "...", "details": {...}}
  {"ok": false, "error": "SkipIngest", "message": "..."}
"""

from __future__ import annotations

import base64
import json
import sys

from app.env_bootstrap import bootstrap_env

bootstrap_env()

from app.ingestion.errors import SkipIngest
from app.ingestion.pipeline import (
    prepare_html_ingest,
    prepare_pdf_ingest,
    prepare_raw_ingest,
)


def main() -> int:
    try:
        req = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        json.dump({"ok": False, "error": "InvalidJSON", "message": str(e)}, sys.stdout)
        return 1

    op = req.get("op")
    url = req.get("url") or ""
    title = req.get("title") or ""

    try:
        if op == "ingest_pdf":
            b64 = req.get("pdf_base64") or ""
            pdf_bytes = base64.b64decode(b64)
            result = prepare_pdf_ingest(pdf_bytes, url=url, title=title)
        elif op == "ingest_raw":
            raw = req.get("raw_text") or ""
            result = prepare_raw_ingest(raw, url=url, title=title)
        elif op == "ingest_html":
            html = req.get("html") or ""
            result = prepare_html_ingest(
                html,
                url=url,
                title=title,
                skip_ai_check=bool(req.get("skip_ai_check")),
            )
        else:
            json.dump(
                {"ok": False, "error": "BadOp", "message": f"unknown op: {op}"},
                sys.stdout,
            )
            return 1

        json.dump({"ok": True, **result}, sys.stdout)
        return 0
    except SkipIngest as e:
        json.dump({"ok": False, "error": "SkipIngest", "message": str(e)}, sys.stdout)
        return 0
    except Exception as e:
        json.dump({"ok": False, "error": type(e).__name__, "message": str(e)}, sys.stdout)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
