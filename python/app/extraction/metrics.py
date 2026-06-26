"""Per-extraction LLM usage metrics (thread-local via contextvars)."""

from __future__ import annotations

import contextvars
import json
from dataclasses import dataclass, field

_run: contextvars.ContextVar["ExtractionRunMetrics | None"] = contextvars.ContextVar(
    "extraction_run_metrics",
    default=None,
)


@dataclass
class ExtractionRunMetrics:
    word_count: int = 0
    tokens_generated: int = 0

    def to_dict(self) -> dict[str, int]:
        return {
            "word_count": self.word_count,
            "tokens_generated": self.tokens_generated,
        }


def begin_extraction(*, word_count: int) -> ExtractionRunMetrics:
    metrics = ExtractionRunMetrics(word_count=max(0, word_count))
    _run.set(metrics)
    return metrics


def add_generated_tokens(count: int) -> None:
    if count <= 0:
        return
    metrics = _run.get()
    if metrics is not None:
        metrics.tokens_generated += count


def record_generated_object(obj: object) -> None:
    """Estimate output tokens from serialized JSON."""
    try:
        encoded = json.dumps(obj, ensure_ascii=False)
    except (TypeError, ValueError):
        encoded = str(obj)
    add_generated_tokens(max(1, len(encoded) // 4))


def get_extraction_metrics() -> ExtractionRunMetrics | None:
    return _run.get()


def clear_extraction_metrics() -> None:
    _run.set(None)
