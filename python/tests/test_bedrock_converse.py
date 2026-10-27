"""BUG-11 / BUG-10: Bedrock Converse adapter, model_used reporting, caching.

Runs against a fake bedrock-runtime client; no network.
"""

from __future__ import annotations

import json

import pytest
from botocore.exceptions import ClientError

from app.llm import bedrock_llm
from app.llm.bedrock_llm import (
    BedrockLLM,
    _converse_text,
    _has_cache_points,
    _strip_cache_points_messages,
)


def _client_error(code: str, message: str = "") -> ClientError:
    return ClientError({"Error": {"Code": code, "Message": message}}, "Converse")


def _resp(text: str, model_tokens=(100, 20), cache_read=0) -> dict:
    return {
        "output": {"message": {"role": "assistant", "content": [{"text": text}]}},
        "usage": {
            "inputTokens": model_tokens[0],
            "outputTokens": model_tokens[1],
            "cacheReadInputTokens": cache_read,
        },
        "stopReason": "end_turn",
    }


class FakeRuntime:
    """Scripted bedrock-runtime client: a list of outcomes per model id."""

    def __init__(self, script: dict[str, list]):
        self.script = {k: list(v) for k, v in script.items()}
        self.calls: list[dict] = []

    def converse(self, **kwargs):
        self.calls.append(kwargs)
        outcomes = self.script.get(kwargs["modelId"])
        if not outcomes:
            raise _client_error("ResourceNotFoundException", "no script")
        outcome = outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    def invoke_model(self, **kwargs):  # pragma: no cover - must not be used
        raise AssertionError("invoke_model must not be called on the Converse path")


@pytest.fixture
def llm(monkeypatch):
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    monkeypatch.setenv("BEDROCK_FALLBACK_MODEL", "us.anthropic.claude-haiku-4-5-20251001-v1:0")
    monkeypatch.delenv("BEDROCK_API", raising=False)
    monkeypatch.delenv("BEDROCK_PROMPT_CACHE", raising=False)
    monkeypatch.delenv("ENABLE_TOOL_USE", raising=False)
    inst = BedrockLLM(model_name="us.deepseek.r1-v1:0", region_name="us-east-1")
    return inst


VALID = json.dumps({"risk": {"risk_title": "A real risk title", "description": "d" * 60}})


def test_converse_text_strips_think_blocks():
    resp = _resp("<think>step 1\nstep 2</think>\n{\"a\": 1}")
    assert _converse_text(resp) == '{"a": 1}'
    resp["output"]["message"]["content"].insert(0, {"reasoningContent": {"reasoningText": {"text": "x"}}})
    assert _converse_text(resp) == '{"a": 1}'


def test_deepseek_runs_on_converse_and_reports_model_used(llm):
    """TC-BUG-11: a non-Anthropic model is called over Converse and the
    record carries the model that answered."""
    fake = FakeRuntime({"us.deepseek.r1-v1:0": [_resp(VALID)]})
    llm.client = fake
    obj = llm.generate_json("article text", {"type": "object"}, title="T", url="u")
    assert len(fake.calls) == 1
    call = fake.calls[0]
    assert call["modelId"] == "us.deepseek.r1-v1:0"
    assert call["system"][0]["text"].startswith("You are an AI Risk extraction")
    assert call["messages"][0]["role"] == "user"
    assert obj["_meta"]["model_used"] == "us.deepseek.r1-v1:0"
    assert obj["_meta"]["model_fallback"] is False
    assert obj["_meta"]["api"] == "converse"
    assert obj["_meta"]["usage"]["input_tokens"] == 100
    assert obj["risk"]["risk_title"] == "A real risk title"


def test_no_cache_points_for_models_without_support(llm):
    fake = FakeRuntime({"us.deepseek.r1-v1:0": [_resp(VALID)]})
    llm.client = fake
    llm.generate_json("article", {})
    call = fake.calls[0]
    assert not _has_cache_points(call["system"], call["messages"])


def test_cache_points_for_claude_and_rejection_retry(monkeypatch):
    """TC-BUG-10: Claude gets cachePoint after the system prompt and after the
    article; a model that rejects cache markers is retried once without."""
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    inst = BedrockLLM(model_name="us.anthropic.claude-haiku-4-5-20251001-v1:0")
    mid = inst.model_id
    fake = FakeRuntime({mid: [_client_error("ValidationException", "cachePoint not supported"), _resp(VALID, cache_read=5000)]})
    inst.client = fake
    obj = inst.generate_json("article", {})
    assert len(fake.calls) == 2
    first, second = fake.calls
    assert _has_cache_points(first["system"], first["messages"])
    assert first["system"][-1] == {"cachePoint": {"type": "default"}}
    # article block, cache point, trailing instruction
    content = first["messages"][0]["content"]
    assert "cachePoint" in content[1] and "ARTICLE TEXT" in content[0]["text"]
    assert not _has_cache_points(second["system"], second["messages"])
    assert obj["_meta"]["model_used"] == mid
    assert obj["_meta"]["usage"]["cache_read_input_tokens"] == 5000


def test_fallback_model_is_recorded_not_hidden(llm):
    """The configured model fails hard; the fallback answers; the record says so."""
    fallback = llm.fallback_model_id
    fake = FakeRuntime({
        "us.deepseek.r1-v1:0": [_client_error("ValidationException", "Malformed input request")],
        fallback: [_resp(VALID)],
    })
    llm.client = fake
    obj = llm.generate_json("article", {})
    assert [c["modelId"] for c in fake.calls] == ["us.deepseek.r1-v1:0", fallback]
    assert obj["_meta"]["model_used"] == fallback
    assert obj["_meta"]["model_configured"] == "us.deepseek.r1-v1:0"
    assert obj["_meta"]["model_fallback"] is True


def test_json_repair_round_trips_over_converse(llm):
    bad = "I could not produce the record, sorry."  # nothing the local repair can fix
    fake = FakeRuntime({"us.deepseek.r1-v1:0": [_resp(bad), _resp(VALID)]})
    llm.client = fake
    obj = llm.generate_json("article", {})
    assert len(fake.calls) == 2
    repair_msgs = fake.calls[1]["messages"]
    assert repair_msgs[-2]["role"] == "assistant" and repair_msgs[-1]["role"] == "user"
    assert "not valid JSON" in repair_msgs[-1]["content"][0]["text"]
    assert obj["risk"]["risk_title"] == "A real risk title"


def test_all_candidates_fail_returns_stub(llm):
    fake = FakeRuntime({})
    llm.client = fake
    obj = llm.generate_json("article", {})
    assert obj["_source"] == "stub"
    assert "ResourceNotFoundException" in obj["_stub_reason"]


def test_generate_text_for_verifier(llm):
    fake = FakeRuntime({"us.deepseek.r1-v1:0": [_resp("<think>hmm</think>{\"ok\": true}")]})
    llm.client = fake
    text, used, usage = llm.generate_text("SYS", [{"text": "hello"}], max_tokens=50)
    assert text == '{"ok": true}' and used == "us.deepseek.r1-v1:0"
    assert usage["output_tokens"] == 20
    assert fake.calls[0]["inferenceConfig"] == {"maxTokens": 50, "temperature": 0.0}


def test_invoke_api_can_be_forced_for_anthropic(monkeypatch):
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    monkeypatch.setenv("BEDROCK_API", "invoke")
    inst = BedrockLLM(model_name="us.anthropic.claude-haiku-4-5-20251001-v1:0")
    assert inst._use_converse(use_tools=False) is False
    monkeypatch.delenv("BEDROCK_API")
    assert inst._use_converse(use_tools=False) is True
    # Tool-use loop still needs the Anthropic invoke body.
    assert inst._use_converse(use_tools=True) is False
    other = BedrockLLM(model_name="us.deepseek.r1-v1:0")
    assert other._use_converse(use_tools=True) is True


def test_strip_cache_points_messages():
    msgs = [{"role": "user", "content": [{"text": "a"}, {"cachePoint": {"type": "default"}}]}]
    assert _strip_cache_points_messages(msgs) == [{"role": "user", "content": [{"text": "a"}]}]


def test_reported_model_prefers_model_used(monkeypatch):
    from app.extraction import extract_utils

    monkeypatch.setattr(extract_utils, "get_current_model_name", lambda: "configured")
    assert extract_utils.reported_model({"_meta": {"model_used": "actual"}}) == "actual"
    assert extract_utils.reported_model({"_meta": {}}) == "configured"
    assert extract_utils.reported_model({}) == "configured"
