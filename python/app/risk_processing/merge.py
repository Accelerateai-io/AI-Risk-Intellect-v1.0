"""Merge per-chunk extraction objects into one."""

from __future__ import annotations

from typing import Any

from app.risk_processing.description_utils import normalize_narrative_text


def _coerce_int(value: object, default: int = 0) -> int:
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default


def _self_assessment_rank(sa: dict[str, Any]) -> tuple[int, int, int]:
    total = _coerce_int(sa.get("total_score"), 0)
    sub_sum = (
        _coerce_int(sa.get("context_clarity_score"), 0)
        + _coerce_int(sa.get("keyword_score"), 0)
        + _coerce_int(sa.get("tagging_accuracy_score"), 0)
        + _coerce_int(sa.get("evidence_strength_score"), 0)
    )
    reasoning_count = sum(
        1
        for key in (
            "context_clarity_reasoning",
            "keyword_reasoning",
            "tagging_reasoning",
            "evidence_reasoning",
        )
        if str(sa.get(key) or "").strip()
    )
    effective_total = total if total > 0 else sub_sum
    return (effective_total, sub_sum, reasoning_count)


def _pick_best_self_assessment(
    objs: list[dict[str, Any]],
) -> dict[str, Any] | None:
    best: dict[str, Any] | None = None
    best_rank = (-1, -1, -1)
    for obj in objs:
        justification = obj.get("justification") or {}
        sa = justification.get("self_assessment")
        if not isinstance(sa, dict):
            continue
        rank = _self_assessment_rank(sa)
        if rank > best_rank:
            best_rank = rank
            best = dict(sa)
    return best


def merge_extractions(objs: list[dict[str, Any]]) -> dict[str, Any]:
    if not objs:
        raise ValueError("no extractions to merge")
    if len(objs) == 1:
        return objs[0]

    base = dict(objs[0])
    risk = dict(base.get("risk") or {})
    descriptions: list[str] = []

    for o in objs:
        r = o.get("risk") or {}
        desc = (r.get("description") or "").strip()
        if desc:
            descriptions.append(desc)

    if descriptions:
        combined = " ".join(descriptions[:5])
        risk["description"] = normalize_narrative_text(combined)
    base["risk"] = risk

    best_sa = _pick_best_self_assessment(objs)
    if best_sa:
        justification = dict(base.get("justification") or {})
        justification["self_assessment"] = best_sa
        base["justification"] = justification

    meta = dict(base.get("_meta") or {})
    meta["merged_from"] = len(objs)
    base["_meta"] = meta
    return base
