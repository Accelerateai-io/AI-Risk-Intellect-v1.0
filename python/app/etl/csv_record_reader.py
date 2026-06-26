"""Robust CSV reader for multiline Excel / AIID exports."""

from __future__ import annotations

import csv
import io
import logging
import re
from typing import Any

import pandas as pd

logger = logging.getLogger("airisk")

RECORD_START_PATTERN = re.compile(r'^"?[0-9a-fA-F]{24}"?,')
INCOMPLETE_RECORD_REASON = "Incomplete CSV record (file truncated or unclosed quote)"
MALFORMED_RECORD_REASON = "Malformed CSV record (could not parse fields)"


def _count_unescaped_quotes(text: str) -> int:
    count = 0
    i = 0
    while i < len(text):
        if text[i] == '"':
            if i + 1 < len(text) and text[i + 1] == '"':
                i += 2
                continue
            count += 1
        i += 1
    return count


def _normalize_csv_bytes(file_bytes: bytes) -> bytes:
    if file_bytes.startswith(b"\xef\xbb\xbf"):
        file_bytes = file_bytes[3:]
    text = file_bytes.decode("utf-8", errors="replace")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    return text.encode("utf-8")


def _truncate_incomplete_tail(file_bytes: bytes) -> tuple[bytes, int]:
    text = file_bytes.decode("utf-8")
    lines = text.split("\n")
    record_starts: list[int] = []
    for index, line in enumerate(lines):
        if RECORD_START_PATTERN.match(line):
            record_starts.append(index)

    if len(record_starts) < 2:
        return file_bytes, 0

    dropped = 0
    while record_starts:
        chunk_lines = lines[record_starts[-1] :]
        blob = "\n".join(chunk_lines)
        if _count_unescaped_quotes(blob) % 2 == 0:
            break
        lines = lines[: record_starts[-1]]
        record_starts.pop()
        dropped += 1

    return "\n".join(lines).encode("utf-8"), dropped


def _repair_record_blob(blob: str) -> str:
    repaired = blob
    if _count_unescaped_quotes(repaired) % 2 != 0:
        repaired += '"'
    return repaired


def _parse_record_blob(blob: str, expected_cols: int) -> list[str] | None:
    for candidate in (blob, _repair_record_blob(blob)):
        try:
            rows = list(
                csv.reader(
                    io.StringIO(candidate),
                    delimiter=",",
                    quotechar='"',
                    doublequote=True,
                    skipinitialspace=False,
                ),
            )
        except csv.Error:
            continue

        if not rows or not rows[0]:
            continue

        fields = [str(value) for value in rows[0]]
        if len(fields) < expected_cols:
            fields.extend([""] * (expected_cols - len(fields)))
        elif len(fields) > expected_cols:
            overflow = fields[expected_cols - 1 :]
            fields = fields[: expected_cols - 1] + [",".join(overflow)]

        return fields

    return None


def _has_multiline_records(lines: list[str]) -> bool:
    data_lines = [line for line in lines[1:] if line.strip()]
    record_indexes = [
        index for index, line in enumerate(data_lines) if RECORD_START_PATTERN.match(line)
    ]
    if len(record_indexes) < 2:
        return False

    gaps = [
        record_indexes[index + 1] - record_indexes[index]
        for index in range(len(record_indexes) - 1)
    ]
    return any(gap > 1 for gap in gaps)


def _should_use_record_parser(file_bytes: bytes) -> bool:
    text = file_bytes.decode("utf-8", errors="replace")
    lines = [line for line in text.split("\n") if line.strip()]
    if len(lines) < 2:
        return False

    header = lines[0].lower()
    has_id_column = "_id" in header or "objectid" in header.replace(" ", "").replace("_", "")
    record_markers = sum(1 for line in lines[1:] if RECORD_START_PATTERN.match(line))
    if not (has_id_column and record_markers > 0):
        return False

    if len(file_bytes) > 1_000_000:
        return True

    return _has_multiline_records(lines)


def read_csv_records_dataframe(file_bytes: bytes) -> tuple[pd.DataFrame, list[dict[str, Any]]]:
    """Parse AIID-style multiline CSV exports into a dataframe."""
    normalized = _normalize_csv_bytes(file_bytes)
    trimmed, dropped_tail = _truncate_incomplete_tail(normalized)

    text = trimmed.decode("utf-8")
    lines = text.split("\n")
    while lines and not lines[0].strip():
        lines.pop(0)
    if not lines:
        return pd.DataFrame(), []

    header_fields = next(csv.reader([lines[0]]))
    expected_cols = len(header_fields)

    records: list[list[str]] = []
    skipped: list[dict[str, Any]] = []
    chunks: list[str] = []
    record_number = 0

    def flush_chunk(is_last: bool = False) -> None:
        nonlocal record_number
        if not chunks:
            return

        record_number += 1
        blob = "\n".join(chunks)
        fields = _parse_record_blob(blob, expected_cols)
        if fields is None:
            reason = (
                INCOMPLETE_RECORD_REASON
                if is_last and _count_unescaped_quotes(blob) % 2 != 0
                else MALFORMED_RECORD_REASON
            )
            skipped.append({"row": record_number + 1, "reason": reason})
            logger.warning("Skipping CSV record %s: %s", record_number + 1, reason)
            return

        records.append(fields)

    for line in lines[1:]:
        if RECORD_START_PATTERN.match(line):
            flush_chunk()
            chunks = [line]
        elif chunks:
            chunks.append(line)

    flush_chunk(is_last=True)

    if dropped_tail:
        logger.warning(
            "Removed %s incomplete trailing CSV record(s) before parsing",
            dropped_tail,
        )
        logical_records = len(records) + len(skipped)
        for index in range(dropped_tail):
            skipped.append(
                {
                    "row": logical_records + index + 2,
                    "reason": INCOMPLETE_RECORD_REASON,
                }
            )

    if not records:
        return pd.DataFrame(columns=header_fields), skipped

    return pd.DataFrame(records, columns=header_fields, dtype=str), skipped


def read_csv_dataframe(file_bytes: bytes) -> tuple[pd.DataFrame, list[dict[str, Any]]]:
    """Read CSV using the best strategy for the file shape."""
    normalized = _normalize_csv_bytes(file_bytes)

    if _should_use_record_parser(normalized):
        return read_csv_records_dataframe(normalized)

    trimmed, dropped_tail = _truncate_incomplete_tail(normalized)

    try:
        df = pd.read_csv(
            io.BytesIO(trimmed),
            dtype=str,
            keep_default_na=False,
            quoting=csv.QUOTE_MINIMAL,
            encoding="utf-8",
            on_bad_lines="warn",
        )
    except pd.errors.ParserError as exc:
        logger.warning("Pandas CSV parse failed, using record parser fallback: %s", exc)
        return read_csv_records_dataframe(normalized)

    skipped: list[dict[str, Any]] = []
    for index in range(dropped_tail):
        skipped.append(
            {
                "row": len(df) + index + 2,
                "reason": INCOMPLETE_RECORD_REASON,
            }
        )

    return df, skipped
