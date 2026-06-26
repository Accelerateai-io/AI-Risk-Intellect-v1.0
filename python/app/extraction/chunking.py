"""Text chunking for LLM extraction (token-aware with char fallback)."""

from __future__ import annotations

from typing import List, Tuple

_TOKENIZERS = {}


def _char_chunk(
    text: str,
    max_chars: int,
    overlap_chars: int,
) -> List[Tuple[int, int, str]]:
    chunks: List[Tuple[int, int, str]] = []
    i = 0
    n = len(text)
    while i < n:
        j = min(i + max_chars, n)
        chunk_text = text[i:j].strip()
        if chunk_text:
            chunks.append((i, j, chunk_text))
        if j >= n:
            break
        i = max(0, j - overlap_chars)
    return chunks


def get_tokenizer(model_id: str):
    if model_id in _TOKENIZERS:
        return _TOKENIZERS[model_id]
    try:
        from transformers import AutoTokenizer

        tok = AutoTokenizer.from_pretrained(model_id)
        _TOKENIZERS[model_id] = tok
        return tok
    except Exception:
        return None


def tokenize_and_chunk(
    text: str,
    model_id: str,
    max_tokens: int = 1024,
    overlap_tokens: int = 100,
) -> List[Tuple[int, int, str]]:
    """
    Split long text into overlapping chunks.
    Uses HuggingFace tokenizer when available; otherwise ~4 chars/token estimate.
    """
    tokenizer = get_tokenizer(model_id)
    if tokenizer is None:
        max_chars = max(512, max_tokens * 4)
        overlap_chars = max(50, overlap_tokens * 4)
        return _char_chunk(text, max_chars, overlap_chars)

    tokens = tokenizer(
        text,
        return_offsets_mapping=True,
        add_special_tokens=False,
    )
    offsets = tokens["offset_mapping"]
    chunks: List[Tuple[int, int, str]] = []

    i = 0
    while i < len(offsets):
        j = min(i + max_tokens, len(offsets))
        start_char = offsets[i][0]
        end_char = offsets[j - 1][1]
        chunk_text = text[start_char:end_char].strip()
        if chunk_text:
            chunks.append((start_char, end_char, chunk_text))
        if j >= len(offsets):
            break
        i = max(0, j - overlap_tokens)

    return chunks
