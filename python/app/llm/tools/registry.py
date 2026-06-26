"""Bedrock tool-use stubs (enable with ENABLE_TOOL_USE=true when implemented)."""

from __future__ import annotations

from typing import Any


def get_tool_specs() -> list[dict[str, Any]]:
    return []


def execute_tool(name: str, tool_input: dict[str, Any]) -> dict[str, Any]:
    return {"ok": False, "error": f"tool not implemented: {name}", "input": tool_input}
