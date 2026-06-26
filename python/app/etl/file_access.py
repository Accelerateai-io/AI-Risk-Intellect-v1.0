"""Safe on-disk access for ETL report uploads passed from Node."""

from __future__ import annotations

import os
from pathlib import Path


def etl_storage_roots() -> list[Path]:
    roots: list[Path] = []
    configured = os.environ.get("ETL_REPORTS_STORAGE_DIR", "").strip()
    if configured:
        roots.append(Path(configured).resolve())

    repo_root = Path(__file__).resolve().parents[3]
    roots.append((repo_root / "backend" / "storage" / "etl-reports").resolve())
    return roots


def resolve_allowed_etl_file_path(raw_path: str) -> Path:
    candidate = Path(raw_path).resolve()
    if not candidate.is_file():
        raise ValueError("ETL file was not found on disk.")

    for root in etl_storage_roots():
        try:
            candidate.relative_to(root)
            return candidate
        except ValueError:
            continue

    raise ValueError("ETL file path is not allowed.")


def read_allowed_etl_file(raw_path: str) -> bytes:
    path = resolve_allowed_etl_file_path(raw_path)
    return path.read_bytes()
