"""BUG-05: whole-document extraction, synthesis merge, reference trimming.

TC-12 whole-document single pass for large-context models
TC-13 synthesis call used when chunking is unavoidable
TC-14 max-severity merge removed
"""

from __future__ import annotations

import json
import os

import pytest

from app.extraction import extract_utils
from app.extraction.preprocess import head_and_tail, trim_for_extraction
from app.llm.model_registry import (
    DEFAULT_CONTEXT_TOKENS,
    context_window_tokens,
    estimate_tokens,
    is_anthropic_model,
    supports_prompt_cache,
)
from app.risk_processing.merge import (
    build_synthesis_input,
    merge_extractions,
    pick_most_coherent,
    synthesize_extractions,
)


# --- model registry -----------------------------------------------------------

def test_context_window_known_models():
    assert context_window_tokens("us.anthropic.claude-haiku-4-5-20251001-v1:0") == 200_000
    assert context_window_tokens("us.deepseek.r1-v1:0") == 128_000
    assert context_window_tokens("global.anthropic.claude-fable-5-1") == 1_000_000
    assert context_window_tokens("amazon.nova-lite-v1:0") == 300_000


def test_context_window_unknown_model_is_conservative():
    assert context_window_tokens("vendor.mystery-model-v9") == DEFAULT_CONTEXT_TOKENS
    assert context_window_tokens(None) == DEFAULT_CONTEXT_TOKENS


def test_context_window_env_override(monkeypatch):
    monkeypatch.setenv("MODEL_CONTEXT_TOKENS", "50000")
    assert context_window_tokens("us.deepseek.r1-v1:0") == 50_000
    monkeypatch.setenv("MODEL_CONTEXT_TOKENS", "not-a-number")
    assert context_window_tokens("us.deepseek.r1-v1:0") == 128_000


def test_prompt_cache_and_anthropic_flags():
    assert supports_prompt_cache("us.anthropic.claude-haiku-4-5-20251001-v1:0")
    assert supports_prompt_cache("amazon.nova-pro-v1:0")
    assert not supports_prompt_cache("us.deepseek.r1-v1:0")
    assert is_anthropic_model("us.anthropic.claude-3-5-haiku-20241022-v1:0")
    assert not is_anthropic_model("us.deepseek.r1-v1:0")


def test_estimate_tokens_is_conservative():
    text = "word " * 1000  # 5000 chars
    assert 1_300 <= estimate_tokens(text) <= 1_500
    assert estimate_tokens("") == 0


# --- preprocess -----------------------------------------------------------------

def _paper(body_words: int = 2000) -> str:
    body = " ".join(f"w{i}" for i in range(body_words))
    refs = "\n".join(f"[{i}] Author {i}. Some cited paper title. 2024." for i in range(1, 40))
    return f"Title\nAbstract text here.\n{body}\n\nReferences\n{refs}\n"


def test_trim_removes_reference_list_by_heading():
    result = trim_for_extraction(_paper())
    assert result.references_removed
    assert result.method == "heading"
    assert "Some cited paper title" not in result.text
    assert result.trimmed_chars < result.original_chars


def test_trim_removes_numbered_entries_without_heading():
    body = " ".join(f"w{i}" for i in range(2000))
    refs = "\n".join(f"[{i}] Author {i}. Cited work. 2024." for i in range(1, 30))
    result = trim_for_extraction(f"{body}\n{refs}\n")
    assert result.references_removed
    assert result.method == "numbered_entries"


def test_trim_ignores_early_references_mention():
    text = "Intro\nReferences\nare discussed in section 3.\n" + ("body " * 3000)
    result = trim_for_extraction(text)
    assert not result.references_removed
    assert result.text == text


def test_trim_never_returns_tiny_body():
    text = "Short.\n\nReferences\n" + "\n".join(f"[{i}] x" for i in range(10))
    result = trim_for_extraction(text)
    assert not result.references_removed


def test_head_and_tail():
    text = "A" * 100 + "B" * 100 + "C" * 100
    head, tail = head_and_tail(text, 50, 50)
    assert head == "A" * 50 and tail == "C" * 50
    head, tail = head_and_tail("short", 50, 50)
    assert head == "short" and tail == ""


# --- plan_extraction ------------------------------------------------------------

def test_plan_whole_document_when_it_fits(monkeypatch):
    monkeypatch.delenv("EXTRACTION_MODE", raising=False)
    monkeypatch.delenv("CHUNK_MAX_TOKENS", raising=False)
    monkeypatch.delenv("MODEL_CONTEXT_TOKENS", raising=False)
    text = "word " * 15_000  # ~75k chars, ~21k tokens: a long paper
    plan = extract_utils.plan_extraction(text, "us.deepseek.r1-v1:0")
    assert plan["mode"] == "whole"
    assert plan["estimated_tokens"] < plan["budget_tokens"]


def test_plan_chunks_when_document_exceeds_context(monkeypatch):
    monkeypatch.delenv("EXTRACTION_MODE", raising=False)
    monkeypatch.delenv("CHUNK_MAX_TOKENS", raising=False)
    monkeypatch.setenv("MODEL_CONTEXT_TOKENS", "32000")
    text = "word " * 40_000  # ~57k tokens
    plan = extract_utils.plan_extraction(text, "vendor.small-model")
    assert plan["mode"] == "chunked"
    # Chunks are as large as the budget allows, not 1024 tokens.
    assert plan["chunk_tokens"] >= 4_000
    assert plan["chunk_tokens"] == plan["budget_tokens"]


def test_plan_env_mode_forces(monkeypatch):
    monkeypatch.setenv("EXTRACTION_MODE", "chunked")
    monkeypatch.setenv("CHUNK_MAX_TOKENS", "1024")
    plan = extract_utils.plan_extraction("short text", "us.anthropic.claude-haiku-4-5")
    assert plan["mode"] == "chunked" and plan["chunk_tokens"] == 1024
    monkeypatch.setenv("EXTRACTION_MODE", "whole")
    plan = extract_utils.plan_extraction("x" * 10_000_000, "us.anthropic.claude-haiku-4-5")
    assert plan["mode"] == "whole"


# --- merge ------------------------------------------------------------------------

def _obj(title: str, likelihood: int, impact: int, total: int, desc: str = "d") -> dict:
    return {
        "risk": {"risk_title": title, "description": desc, "ai_product_name": None},
        "risk_scoring": {
            "likelihood": likelihood,
            "likelihood_reasoning": f"{title} likelihood",
            "impact": impact,
            "impact_reasoning": f"{title} impact",
        },
        "justification": {"self_assessment": {"total_score": total}},
    }


def test_fallback_merge_never_mixes_chunks():
    """TC-14: the highest-severity block must NOT be grafted onto another chunk."""
    first = _obj("Problem statement", 2, 2, 90, desc="first")
    noisy = _obj("Cited-work claim from references", 5, 5, 60, desc="noisy")
    merged = merge_extractions([first, noisy])
    assert merged["risk"]["risk_title"] == "Problem statement"
    assert merged["risk_scoring"]["likelihood"] == 2
    assert merged["risk_scoring"]["likelihood_reasoning"] == "Problem statement likelihood"
    assert merged["risk"]["description"] == "first"  # no concatenation
    assert merged["_meta"]["merge_strategy"] == "most_coherent_chunk"
    assert merged["_meta"]["merged_from"] == 2


def test_pick_most_coherent_prefers_earlier_on_tie_and_skips_stubs():
    stub = {"_source": "stub", "risk": {"risk_title": "Failed Risk Extraction"}}
    a = _obj("A", 3, 3, 80)
    b = _obj("B", 3, 3, 80)
    assert pick_most_coherent([stub, a, b]) is a


def test_build_synthesis_input_contains_head_tail_and_drafts():
    text = "OPENING " * 3000 + "CLOSING " * 3000
    objs = [_obj("A", 2, 2, 80), _obj("B", 4, 4, 70)]
    payload = build_synthesis_input(objs, text, head_chars=100, tail_chars=100)
    assert "=== OPENING OF SOURCE DOCUMENT ===" in payload
    assert "=== CLOSING OF SOURCE DOCUMENT ===" in payload
    assert "DRAFT RECORDS FROM 2 CONSECUTIVE SECTIONS" in payload
    drafts = json.loads(payload.split("CONSECUTIVE SECTIONS ===\n", 1)[1])
    assert [d["risk"]["risk_title"] for d in drafts] == ["A", "B"]
    assert drafts[1]["risk_scoring"]["likelihood"] == 4


def test_synthesize_uses_one_extra_call_and_falls_back_on_failure():
    calls: list[dict] = []

    def fake_generate(input_text, schema, **kwargs):
        calls.append(kwargs)
        return _obj("Synthesised", 2, 3, 88)

    out = synthesize_extractions(
        [_obj("A", 2, 2, 80), _obj("B", 4, 4, 70)],
        "source text " * 100,
        generate_json=fake_generate,
        schema={},
        base_system_prompt="BASE PROMPT",
    )
    assert out is not None and out["risk"]["risk_title"] == "Synthesised"
    assert len(calls) == 1
    assert calls[0]["system_prompt_override"].startswith("BASE PROMPT")
    assert "SYNTHESIS TASK" in calls[0]["system_prompt_override"]
    assert out["_meta"]["merge_strategy"] == "synthesis_call"

    def failing(*_a, **_k):
        raise RuntimeError("boom")

    assert (
        synthesize_extractions(
            [_obj("A", 2, 2, 80), _obj("B", 4, 4, 70)],
            "t",
            generate_json=failing,
            schema={},
            base_system_prompt="p",
        )
        is None
    )


# --- end to end through extract_with_auto_chunking ---------------------------------

def _minimal_model_output(title: str) -> dict:
    return {
        "risk": {
            "risk_title": title,
            "domains": "7. AI System Safety, Failures, & Limitations",
            "primary_risk": "Technical Risks",
            "secondary_risks": "Technical/Performance Risk",
            "description": "A sufficiently long description of the extracted risk for the schema.",
            "source_type": "empirical_study",
            "evidence_type": "demonstrated",
            "demonstrated_finding": "x",
            "stated_implication": None,
            "paper_stance": "documents_problem",
            "proposed_mitigation": None,
            "mitigations_in_source": ["not described in source"],
        },
        "risk_scoring": {
            "likelihood": 2,
            "likelihood_reasoning": "word word word word word word",
            "impact": 2,
            "impact_reasoning": "word word word word word word",
            "loss_categories": [],
        },
        "justification": {"self_assessment": {"total_score": 80, "confidence_level": "medium"}},
    }


@pytest.fixture
def fake_backend(monkeypatch):
    calls: list[dict] = []

    def fake_generate(input_text, schema, **kwargs):
        calls.append({"len": len(input_text), **kwargs})
        return _minimal_model_output(f"call {len(calls)}")

    monkeypatch.setattr(extract_utils, "_resolve_generate_json", lambda: (fake_generate, "fake"))
    monkeypatch.setattr(extract_utils, "get_current_model_name", lambda: "us.anthropic.claude-haiku-4-5")
    monkeypatch.delenv("EXTRACTION_MODE", raising=False)
    monkeypatch.delenv("CHUNK_MAX_TOKENS", raising=False)
    monkeypatch.delenv("MODEL_CONTEXT_TOKENS", raising=False)
    return calls


def test_whole_document_single_call(fake_backend):
    """TC-12: a 12k-word paper is one model call, references trimmed."""
    schema = extract_utils.load_risk_schema()
    paper = _paper(body_words=12_000)
    obj, flag, metrics = extract_utils.extract_with_auto_chunking(
        paper, schema, title="T", source_url="https://arxiv.org/abs/1"
    )
    assert flag == "fake"
    assert len(fake_backend) == 1
    assert fake_backend[0]["len"] < len(paper)  # references removed
    ext = obj["_meta"]["extraction"]
    assert ext["mode"] == "whole" and ext["llm_calls"] == 1
    assert ext["preprocess"]["references_removed"] is True
    assert obj["_meta"]["chunked"]["used"] is False
    assert metrics["word_count"] > 0


def test_chunked_path_uses_synthesis_call(fake_backend, monkeypatch):
    """TC-13: when the document cannot fit, chunks + ONE synthesis call."""
    monkeypatch.setenv("MODEL_CONTEXT_TOKENS", "20000")
    schema = extract_utils.load_risk_schema()
    paper = "word " * 60_000  # ~86k tokens > 20k context
    obj, flag, _ = extract_utils.extract_with_auto_chunking(paper, schema)
    assert flag == "chunked"
    ext = obj["_meta"]["extraction"]
    assert ext["mode"] == "chunked"
    assert ext["chunks"] >= 2
    assert ext["llm_calls"] == ext["chunks"] + 1
    assert ext["merge_strategy"] == "synthesis_call"
    synth = fake_backend[-1]
    assert "SYNTHESIS TASK" in synth["system_prompt_override"]
    assert obj["risk"]["risk_title"] == f"call {len(fake_backend)}"
