"""Excel/CSV parsing and row normalization for AIID ETL imports."""

from __future__ import annotations

import io
import logging
import re
from typing import Any, Iterator

import pandas as pd

from app.etl.csv_record_reader import read_csv_dataframe
from app.etl.objectid import is_valid_object_id, normalize_object_id
from app.risk_processing.description_utils import normalize_narrative_text

logger = logging.getLogger("airisk")

REQUIRED_FIELDS = ("title", "url")

FIELD_ALIASES: dict[str, tuple[str, ...]] = {
    "date_published": (
        "date_published",
        "datepublished",
        "published_date",
        "published",
        "publication_date",
    ),
    "report_number": (
        "report_number",
        "reportnumber",
        "report_no",
        "reportno",
        "report",
    ),
    "source_domain": (
        "source_domain",
        "sourcedomain",
        "domain",
        "source",
    ),
    "description": ("text", "description", "body", "content", "narrative", "summary"),
    "title": ("title", "name", "headline"),
    "url": ("url", "link", "source_url", "sourceurl", "permalink"),
    "tags": ("tags", "tag", "labels", "keywords"),
    "created_date": (
        "created_date",
        "createddate",
        "created_at",
        "createdat",
        "created",
    ),
}

OBJECT_ID_ALIASES = frozenset(
    {"objectid", "object_id", "_id", "id", "mongo_id", "mongoid"}
)

SUPPORTED_EXTENSIONS = frozenset({".csv", ".xlsx", ".xls"})


def _normalize_header(value: object) -> str:
    text = str(value or "").strip().lower()
    text = re.sub(r"[\s\-]+", "_", text)
    return re.sub(r"[^a-z0-9_]", "", text)


def _resolve_field_name(header: object) -> str | None:
    normalized = _normalize_header(header)
    if not normalized or normalized in OBJECT_ID_ALIASES:
        return None
    for field, aliases in FIELD_ALIASES.items():
        if normalized in aliases:
            return field
    return None


def _clean_string(value: object) -> str | None:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    text = str(value).strip().replace("\x00", "")
    if not text or text.lower() in {"null", "none", "nan", "undefined"}:
        return None
    return text


def _parse_datetime(value: object) -> str | None:
    cleaned = _clean_string(value)
    if not cleaned:
        return None
    parsed = pd.to_datetime(cleaned, errors="coerce", utc=True)
    if pd.isna(parsed):
        logger.warning("Could not parse date value: %r", cleaned)
        return None
    if isinstance(parsed, pd.Timestamp):
        return parsed.isoformat()
    return str(parsed)


def _parse_tags(value: object) -> list[str] | None:
    cleaned = _clean_string(value)
    if not cleaned:
        return None
    if cleaned.startswith("[") and cleaned.endswith("]"):
        cleaned = cleaned[1:-1]
    parts = re.split(r"[;,|]", cleaned)
    tags = [part.strip() for part in parts if part.strip()]
    return tags or None


def _read_dataframe(
    file_bytes: bytes,
    filename: str,
) -> tuple[pd.DataFrame, list[dict[str, Any]]]:
    ext = _extension(filename)
    buffer = io.BytesIO(file_bytes)

    if ext == ".csv":
        return read_csv_dataframe(file_bytes)

    if ext == ".xlsx":
        return pd.read_excel(buffer, engine="openpyxl", dtype=str), []

    if ext == ".xls":
        return pd.read_excel(buffer, engine="xlrd", dtype=str), []

    raise ValueError(f"Unsupported file extension: {ext}")


def _extension(filename: str) -> str:
    dot = filename.rfind(".")
    if dot == -1:
        raise ValueError("File must have a .csv, .xlsx, or .xls extension.")
    ext = filename[dot:].lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise ValueError(
            f"Unsupported file type {ext!r}. Allowed: .csv, .xlsx, .xls"
        )
    return ext


def _iter_row_frames(df: pd.DataFrame, chunk_size: int) -> Iterator[pd.DataFrame]:
    if len(df) <= chunk_size:
        yield df
        return
    for start in range(0, len(df), chunk_size):
        yield df.iloc[start : start + chunk_size]


def _map_row(row: pd.Series, column_map: dict[int, str]) -> dict[str, Any]:
    object_id_raw = row.iloc[0] if len(row.index) > 0 else None
    record: dict[str, Any] = {"id": normalize_object_id(object_id_raw)}

    for col_idx, field in column_map.items():
        if col_idx >= len(row.index):
            continue
        value = row.iloc[col_idx]
        if field == "date_published":
            record[field] = _parse_datetime(value)
        elif field == "created_date":
            record[field] = _parse_datetime(value)
        elif field == "tags":
            record[field] = _parse_tags(value)
        elif field == "description":
            cleaned = _clean_string(value)
            record[field] = normalize_narrative_text(cleaned) if cleaned else None
        else:
            record[field] = _clean_string(value)

    return record


def _validate_required_fields(record: dict[str, Any]) -> list[str]:
    missing: list[str] = []
    for field in REQUIRED_FIELDS:
        value = record.get(field)
        if value is None or (isinstance(value, str) and not value.strip()):
            missing.append(field)
    return missing


def _build_column_map(columns: pd.Index) -> dict[int, str]:
    column_map: dict[int, str] = {}
    for idx, header in enumerate(columns):
        if idx == 0:
            continue
        field = _resolve_field_name(header)
        if field:
            column_map[idx] = field
    return column_map


def parse_import_file(
    file_bytes: bytes,
    filename: str,
    *,
    chunk_size: int = 1000,
) -> dict[str, Any]:
    df, pre_skipped_rows = _read_dataframe(file_bytes, filename)
    if df.empty and not pre_skipped_rows:
        return {
            "totalRows": 0,
            "records": [],
            "skippedRows": [],
            "failedRows": [],
        }

    column_map = _build_column_map(df.columns)
    total_rows = len(df) + len(pre_skipped_rows)
    records: list[dict[str, Any]] = []
    skipped_rows: list[dict[str, Any]] = list(pre_skipped_rows)
    failed_rows: list[dict[str, Any]] = []

    row_offset = 0
    for chunk in _iter_row_frames(df, chunk_size):
        for row_idx, (_, row) in enumerate(chunk.iterrows(), start=1):
            absolute_row = row_offset + row_idx
            excel_row = absolute_row + 1  # account for header row
            object_id_raw = row.iloc[0] if len(row.index) > 0 else None

            if not is_valid_object_id(object_id_raw):
                reason = (
                    "ObjectId Missing"
                    if _clean_string(object_id_raw) is None
                    else "ObjectId Invalid"
                )
                logger.info(
                    "Skipping row %s: %s (value=%r)",
                    excel_row,
                    reason,
                    object_id_raw,
                )
                skipped_rows.append({"row": excel_row, "reason": reason})
                continue

            record = _map_row(row, column_map)
            missing = _validate_required_fields(record)
            if missing:
                reason = f"Missing required fields: {', '.join(missing)}"
                logger.warning("Row %s failed validation: %s", excel_row, reason)
                failed_rows.append({"row": excel_row, "reason": reason})
                continue

            records.append(record)

        row_offset += len(chunk)

    return {
        "totalRows": total_rows,
        "records": records,
        "skippedRows": skipped_rows,
        "failedRows": failed_rows,
    }
