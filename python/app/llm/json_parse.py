"""
Parse and repair JSON returned by LLMs (Bedrock, local, etc.).

Models often omit commas, use smart quotes, leave trailing commas, or put
unescaped quotes inside string values. This module normalizes common issues
before json.loads and retries with position-aware repairs.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional

logger = logging.getLogger("airisk")

_JSON_ERR_PREFIX = "Model did not return valid JSON: "

_SMART_QUOTE_MAP = str.maketrans({
    "\u201c": '"',
    "\u201d": '"',
    "\u2018": "'",
    "\u2019": "'",
})


def json_error_message(err: Exception) -> str:
    """Flatten nested 'Model did not return valid JSON' wrappers."""
    text = str(err).strip()
    while text.startswith(_JSON_ERR_PREFIX):
        text = text[len(_JSON_ERR_PREFIX) :].strip()
    return text or "unknown parse error"


def strip_code_fences(raw: str) -> str:
    s = raw.strip()
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*", "", s, flags=re.I)
        s = re.sub(r"\s*```$", "", s)
    return s.strip()


def first_balanced_json(raw: str) -> Optional[str]:
    s = strip_code_fences(raw)
    start = s.find("{")
    if start == -1:
        return None
    depth = 0
    in_string = False
    escape = False
    for i in range(start, len(s)):
        ch = s[i]
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return s[start : i + 1]
    return None


def _strip_line_comments(text: str) -> str:
    out: list[str] = []
    i = 0
    n = len(text)
    in_string = False
    escape = False
    while i < n:
        ch = text[i]
        if in_string:
            out.append(ch)
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            i += 1
            continue
        if ch == '"':
            in_string = True
            out.append(ch)
            i += 1
            continue
        if ch == "/" and i + 1 < n and text[i + 1] == "/":
            while i < n and text[i] not in "\n\r":
                i += 1
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def _remove_trailing_commas(text: str) -> str:
    prev = None
    s = text
    while prev != s:
        prev = s
        s = re.sub(r",(\s*[}\]])", r"\1", s)
    return s


def _fix_single_quoted_keys(text: str) -> str:
    """Convert 'key': to "key": (common LLM mistake)."""
    return re.sub(
        r"([{\[,]\s*)'([^'\\]*(?:\\.[^'\\]*)*)'(\s*:)",
        r'\1"\2"\3',
        text,
    )


def _fix_unescaped_quotes_in_strings(text: str) -> str:
    """
    Escape double quotes that appear inside JSON string values without a backslash.
    Common in evidence_excerpts when the model quotes article text verbatim.
    """
    result: list[str] = []
    i = 0
    n = len(text)
    in_string = False
    escape = False

    def next_non_ws(pos: int) -> int:
        while pos < n and text[pos] in " \t\r\n":
            pos += 1
        return pos

    while i < n:
        ch = text[i]
        if not in_string:
            result.append(ch)
            if ch == '"':
                in_string = True
                escape = False
            i += 1
            continue

        if escape:
            result.append(ch)
            escape = False
            i += 1
            continue
        if ch == "\\":
            result.append(ch)
            escape = True
            i += 1
            continue
        if ch == '"':
            j = next_non_ws(i + 1)
            if j >= n or text[j] in ":,}]":
                in_string = False
                result.append(ch)
                i += 1
                continue
            # Likely an unescaped quote inside the string value.
            result.append('\\"')
            i += 1
            continue

        result.append(ch)
        i += 1

    return "".join(result)


def _fix_missing_commas(text: str) -> str:
    """Insert commas the model omitted between JSON values."""
    patterns = [
        (r'("(?:[^"\\]|\\.)*")\s*\n\s*(")', r"\1,\n\2"),
        (r'("(?:[^"\\]|\\.)*")\s+("(?:[A-Za-z_][\w-]*"\s*:))', r"\1, \2"),
        (r"([\}\]])\s*\n\s*(\"|\{|\[)", r"\1,\n\2"),
        (r"([\}\]])\s*(\"|\{|\[)", r"\1, \2"),
        (
            r"\b(true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*\n\s*(\")",
            r"\1,\n\2",
        ),
    ]
    s = text
    for pattern, repl in patterns:
        s = re.sub(pattern, repl, s)
    return s


def normalize_json_text(raw: str) -> str:
    s = strip_code_fences(raw)
    s = s.translate(_SMART_QUOTE_MAP)
    s = s.replace("\ufeff", "")
    s = _strip_line_comments(s)
    s = _fix_single_quoted_keys(s)
    s = _fix_unescaped_quotes_in_strings(s)
    s = _remove_trailing_commas(s)
    s = _fix_missing_commas(s)
    s = _remove_trailing_commas(s)
    return s.strip()


def _try_load(text: str) -> dict[str, Any]:
    parsed = json.loads(text)
    if not isinstance(parsed, dict):
        raise ValueError("Expected a JSON object at the top level")
    return parsed


def _print_final_json(obj: dict[str, Any]) -> dict[str, Any]:
    """Debug: print the successfully parsed JSON object."""
    # print(
    #     "FINAL PARSED JSON:\n"
    #     + json.dumps(obj, ensure_ascii=False, indent=2),
    #     flush=True,
    # )
    return obj


def _remove_trailing_comma_near(text: str, pos: int) -> str:
    start = max(0, pos - 40)
    end = min(len(text), pos + 40)
    segment = text[start:end]
    new_segment = re.sub(r",(\s*[}\]])", r"\1", segment)
    if new_segment != segment:
        return text[:start] + new_segment + text[end:]
    return text


def _remove_duplicate_comma_at(text: str, pos: int) -> str:
    if pos < len(text) and text[pos] == ",":
        nxt = pos + 1
        while nxt < len(text) and text[nxt] in " \t\r\n":
            nxt += 1
        if nxt < len(text) and text[nxt] == ",":
            return text[:pos] + text[pos + 1 :]
    if pos > 0 and text[pos - 1] == "," and pos < len(text) and text[pos] == ",":
        return text[: pos - 1] + text[pos:]
    return text


def _repair_at_error_positions(text: str, max_attempts: int = 12) -> dict[str, Any]:
    cand = text
    for _ in range(max_attempts):
        try:
            return _try_load(cand)
        except json.JSONDecodeError as err:
            msg = err.msg or ""
            pos = err.pos
            if pos is None or pos >= len(cand):
                raise ValueError(f"{_JSON_ERR_PREFIX}{err}") from err

            changed = False

            if "Expecting property name enclosed in double quotes" in msg:
                new_cand = _remove_trailing_comma_near(cand, pos)
                new_cand = _remove_duplicate_comma_at(new_cand, pos)
                if new_cand != cand:
                    cand = new_cand
                    changed = True
                else:
                    new_cand = _fix_unescaped_quotes_in_strings(cand)
                    if new_cand != cand:
                        cand = new_cand
                        changed = True
                    else:
                        new_cand = _fix_single_quoted_keys(cand)
                        if new_cand != cand:
                            cand = new_cand
                            changed = True

            elif "Expecting ',' delimiter" in msg or "Expecting ':' delimiter" in msg:
                insert = "," if "comma" in msg.lower() or "','" in msg else ":"
                if cand[pos : pos + 1] not in ",:":
                    cand = cand[:pos] + insert + cand[pos:]
                    changed = True

            elif "Invalid control character" in msg:
                cand = cand[:pos] + " " + cand[pos + 1 :]
                changed = True

            if changed:
                continue

            raise ValueError(f"{_JSON_ERR_PREFIX}{err}") from err

    raise ValueError(f"{_JSON_ERR_PREFIX}repair attempts exhausted")


def parse_llm_json(raw: str) -> dict[str, Any]:
    """
    Parse LLM output into a dict, applying normalization and repair passes.
    Raises ValueError when the text cannot be recovered.
    """
    if not raw or not raw.strip():
        raise ValueError(f"{_JSON_ERR_PREFIX}empty response")

    bases: list[str] = []
    balanced = first_balanced_json(raw)
    if balanced:
        bases.append(balanced)
    stripped = strip_code_fences(raw)
    if stripped not in bases:
        bases.append(stripped)

    variants: list[str] = []
    for base in bases:
        variants.extend([
            base,
            normalize_json_text(base),
            _remove_trailing_commas(base),
            _fix_unescaped_quotes_in_strings(base),
            _fix_missing_commas(_remove_trailing_commas(base)),
        ])

    seen: set[str] = set()
    last_err: Exception | None = None

    for cand in variants:
        if not cand or cand in seen:
            continue
        seen.add(cand)
        try:
            return _print_final_json(_try_load(cand))
        except json.JSONDecodeError as err:
            last_err = err
            try:
                return _print_final_json(_repair_at_error_positions(cand))
            except ValueError as repair_err:
                last_err = repair_err
        except ValueError as err:
            last_err = err

    raise ValueError(f"{_JSON_ERR_PREFIX}{json_error_message(last_err or Exception('unknown'))}")
