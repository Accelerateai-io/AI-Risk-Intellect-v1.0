"""ETL import pipeline entrypoints."""

from __future__ import annotations

from app.etl.import_parser import parse_import_file


def prepare_etl_import(
    file_bytes: bytes,
    filename: str,
    *,
    chunk_size: int = 1000,
) -> dict[str, object]:
    parsed = parse_import_file(file_bytes, filename, chunk_size=chunk_size)
    return {
        "totalRows": parsed["totalRows"],
        "records": parsed["records"],
        "skippedRows": len(parsed["skippedRows"]),
        "failedRows": len(parsed["failedRows"]),
        "skippedDetails": parsed["skippedRows"],
        "failedDetails": parsed["failedRows"],
    }
