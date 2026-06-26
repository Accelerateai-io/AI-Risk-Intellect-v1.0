"""HTTP service for the Node backend (ingestion + risk extraction)."""

from __future__ import annotations

import base64
import os

from app.env_bootstrap import bootstrap_env

bootstrap_env()

from fastapi import FastAPI
from pydantic import BaseModel, Field

from app.extraction.extract_utils import (
    _is_stub_object,
    extract_with_auto_chunking,
    get_current_model_name,
    load_risk_schema,
)
from app.llm.model_config import get_model_config, set_model
from app.llm.model_invoke import invoke_bedrock_model, test_bedrock_model
from app.ingestion.errors import SkipIngest
from app.etl.file_access import read_allowed_etl_file
from app.etl.pipeline import prepare_etl_import
from app.ingestion.pipeline import (
    prepare_html_ingest,
    prepare_pdf_ingest,
    prepare_raw_ingest,
)

app = FastAPI(title="AI Risk Intellect Python", version="1.0.0")


class RawIngestBody(BaseModel):
    url: str = ""
    title: str = ""
    raw_text: str = ""


class PdfIngestBody(BaseModel):
    url: str = ""
    title: str = ""
    pdf_base64: str = Field(default="")
    skip_ai_check: bool = True


class HtmlIngestBody(BaseModel):
    url: str = ""
    title: str = ""
    html: str = ""
    skip_ai_check: bool = True


class ExtractRiskBody(BaseModel):
    url: str = ""
    title: str = ""
    text: str = ""


class SetLlmModelBody(BaseModel):
    modelId: str = Field(min_length=1)


class InvokeLlmModelBody(BaseModel):
    modelId: str = Field(min_length=1)
    prompt: str = Field(min_length=1, max_length=16_000)
    maxTokens: int | None = Field(default=None, ge=16, le=4096)
    temperature: float | None = Field(default=None, ge=0, le=1)


class EtlImportBody(BaseModel):
    filename: str = Field(min_length=1)
    file_base64: str = Field(default="")
    file_path: str = Field(default="")


def _error_payload(error: str, message: str) -> dict[str, object]:
    return {"ok": False, "error": error, "message": message}


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@app.post("/ingest/raw")
def ingest_raw(body: RawIngestBody) -> dict[str, object]:
    try:
        result = prepare_raw_ingest(body.raw_text, url=body.url, title=body.title)
        return {"ok": True, **result}
    except SkipIngest as exc:
        return _error_payload("SkipIngest", str(exc))
    except Exception as exc:
        return _error_payload(type(exc).__name__, str(exc))


@app.post("/ingest/html")
def ingest_html(body: HtmlIngestBody) -> dict[str, object]:
    try:
        result = prepare_html_ingest(
            body.html,
            url=body.url,
            title=body.title,
            skip_ai_check=body.skip_ai_check,
        )
        return {"ok": True, **result}
    except SkipIngest as exc:
        return _error_payload("SkipIngest", str(exc))
    except Exception as exc:
        return _error_payload(type(exc).__name__, str(exc))


@app.post("/ingest/pdf")
def ingest_pdf(body: PdfIngestBody) -> dict[str, object]:
    try:
        pdf_bytes = base64.b64decode(body.pdf_base64 or "")
    except Exception as exc:
        return _error_payload("InvalidBase64", str(exc))

    try:
        result = prepare_pdf_ingest(
            pdf_bytes,
            url=body.url,
            title=body.title,
            skip_ai_check=body.skip_ai_check,
        )
        return {"ok": True, **result}
    except SkipIngest as exc:
        return _error_payload("SkipIngest", str(exc))
    except Exception as exc:
        return _error_payload(type(exc).__name__, str(exc))


@app.get("/config/llm-model")
def get_llm_model_config() -> dict[str, object]:
    return {"ok": True, **get_model_config()}


@app.put("/config/llm-model")
def put_llm_model_config(body: SetLlmModelBody) -> dict[str, object]:
    try:
        config = set_model(body.modelId)
        return {"ok": True, **config}
    except ValueError as exc:
        return _error_payload("InvalidModel", str(exc))


@app.post("/config/llm-model/test")
def post_llm_model_test(body: SetLlmModelBody) -> dict[str, object]:
    result = test_bedrock_model(body.modelId)
    return {"ok": result.get("success", False), **result}


@app.post("/config/llm-model/invoke")
def post_llm_model_invoke(body: InvokeLlmModelBody) -> dict[str, object]:
    result = invoke_bedrock_model(
        model_id=body.modelId,
        prompt=body.prompt,
        max_tokens=body.maxTokens,
        temperature=body.temperature,
    )
    return {"ok": result.get("success", False), **result}


def _load_etl_file_bytes(body: EtlImportBody) -> bytes:
    if body.file_path.strip():
        return read_allowed_etl_file(body.file_path)
    try:
        return base64.b64decode(body.file_base64 or "")
    except Exception as exc:
        raise ValueError(f"Invalid base64 file payload: {exc}") from exc


@app.post("/etl/import")
def etl_import(body: EtlImportBody) -> dict[str, object]:
    try:
        file_bytes = _load_etl_file_bytes(body)
    except ValueError as exc:
        return _error_payload("InvalidFile", str(exc))

    if not file_bytes:
        return _error_payload("EmptyFile", "uploaded file is empty")

    try:
        result = prepare_etl_import(
            file_bytes,
            body.filename,
        )
        return {"ok": True, **result}
    except ValueError as exc:
        return _error_payload("InvalidFile", str(exc))
    except Exception as exc:
        return _error_payload(type(exc).__name__, str(exc))


@app.post("/extract/risk")
def extract_risk(body: ExtractRiskBody) -> dict[str, object]:
    if not (body.text or "").strip():
        return _error_payload("EmptyText", "no text to extract")

    try:
        schema = load_risk_schema()
        obj, source_flag, metrics = extract_with_auto_chunking(
            body.text,
            schema,
            title=body.title,
            source_url=body.url,
        )
        if _is_stub_object(obj) or source_flag == "stub":
            return {
                "ok": False,
                "error": "StubExtraction",
                "message": "LLM returned stub/fallback extraction",
                "source_flag": "stub",
                "object": obj,
                "metrics": metrics,
            }

        return {
            "ok": True,
            "object": obj,
            "source_flag": source_flag,
            "model": get_current_model_name(),
            "metrics": metrics,
        }
    except Exception as exc:
        return _error_payload(type(exc).__name__, str(exc))


def run() -> None:
    import uvicorn

    port = int(os.environ.get("PYTHON_PORT", "5006"))
    host = os.environ.get("PYTHON_HOST", "localhost")
    reload = os.environ.get("PYTHON_RELOAD", "0") == "1"
    uvicorn.run(
        "app.server:app",
        host=host,
        port=port,
        reload=reload,
        reload_dirs=[os.path.dirname(os.path.dirname(__file__))] if reload else None,
    )
