"""B-2: every bedrock-runtime client is built with the long-read-timeout Config.

A short default socket read timeout (60s) was aborting multi-minute Bedrock
generations and surfacing as a ReadTimeoutError that looked like a model
failure. These tests pin the transport Config and the converse_stream default
so a regression here is caught without a live AWS call.
"""

from __future__ import annotations

import pytest
from botocore.config import Config
from botocore.exceptions import ClientError

from app.llm import bedrock_llm, model_invoke
from app.llm.bedrock_llm import (
    JOB_LIMIT_SECONDS,
    BedrockLLM,
    bedrock_call_budget_seconds,
    bedrock_max_attempts,
    bedrock_read_timeout_seconds,
    bedrock_runtime_config,
)


def _assert_timeout_config(config: Config) -> None:
    assert isinstance(config, Config)
    assert config.connect_timeout == 10
    # botocore retries are OFF so tenacity is the single source of retry truth.
    assert config.retries == {"mode": "standard", "max_attempts": 1}
    # One socket read cannot outlast the per-call budget (which is < job limit).
    assert config.read_timeout == bedrock_read_timeout_seconds()
    assert config.read_timeout <= bedrock_call_budget_seconds()
    assert config.read_timeout < JOB_LIMIT_SECONDS


def test_runtime_config_values():
    """The shared factory returns exactly the B-2 timeout/retry settings."""
    _assert_timeout_config(bedrock_runtime_config())


def test_bedrock_llm_client_uses_timeout_config(monkeypatch):
    """Constructing BedrockLLM passes the Config into boto3.client()."""
    captured: dict = {}

    def fake_client(service_name=None, region_name=None, config=None, **kwargs):
        captured["service_name"] = service_name
        captured["config"] = config
        return object()

    monkeypatch.setattr(bedrock_llm.boto3, "client", fake_client)
    BedrockLLM(model_name="us.anthropic.claude-haiku-4-5-20251001-v1:0")

    assert captured["service_name"] == "bedrock-runtime"
    _assert_timeout_config(captured["config"])


def test_model_invoke_runtime_client_uses_timeout_config(monkeypatch):
    """model_invoke._runtime_client() passes the Config into boto3.client()."""
    captured: dict = {}

    def fake_client(service_name, region_name=None, config=None, **kwargs):
        captured["service_name"] = service_name
        captured["config"] = config
        return object()

    monkeypatch.setattr(model_invoke.boto3, "client", fake_client)
    model_invoke._runtime_client()

    assert captured["service_name"] == "bedrock-runtime"
    _assert_timeout_config(captured["config"])


def test_streaming_is_default_but_can_be_disabled(monkeypatch):
    """The Converse path streams by default; BEDROCK_CONVERSE_STREAM=0 opts out."""
    monkeypatch.setattr(bedrock_llm.boto3, "client", lambda **kwargs: object())
    inst = BedrockLLM(model_name="us.deepseek.r1-v1:0")

    monkeypatch.delenv("BEDROCK_CONVERSE_STREAM", raising=False)
    assert inst._streaming() is True
    monkeypatch.setenv("BEDROCK_CONVERSE_STREAM", "0")
    assert inst._streaming() is False
    monkeypatch.setenv("BEDROCK_CONVERSE_STREAM", "off")
    assert inst._streaming() is False
    monkeypatch.setenv("BEDROCK_CONVERSE_STREAM", "1")
    assert inst._streaming() is True


# --- B-2 review follow-up: tenacity owns retries + per-call time budget -------


def test_botocore_retries_disabled_so_tenacity_owns_them():
    """max_attempts=1 => botocore does no retrying; tenacity is the only retrier."""
    cfg = bedrock_runtime_config()
    assert cfg.retries["max_attempts"] == 1


def test_per_call_budget_stays_under_the_job_limit(monkeypatch):
    """The per-call budget (and one read) must finish before the 120s job limit."""
    monkeypatch.delenv("BEDROCK_CALL_BUDGET_S", raising=False)
    monkeypatch.delenv("BEDROCK_READ_TIMEOUT_S", raising=False)
    budget = bedrock_call_budget_seconds()
    assert 0 < budget < JOB_LIMIT_SECONDS
    assert bedrock_read_timeout_seconds() <= budget

    # An over-large override is still clamped beneath the job limit.
    monkeypatch.setenv("BEDROCK_CALL_BUDGET_S", "10000")
    assert bedrock_call_budget_seconds() < JOB_LIMIT_SECONDS
    # A garbage / non-positive value falls back to a sane default.
    monkeypatch.setenv("BEDROCK_CALL_BUDGET_S", "nonsense")
    assert 0 < bedrock_call_budget_seconds() < JOB_LIMIT_SECONDS
    monkeypatch.setenv("BEDROCK_CALL_BUDGET_S", "0")
    assert 0 < bedrock_call_budget_seconds() < JOB_LIMIT_SECONDS


def test_read_timeout_never_exceeds_budget(monkeypatch):
    monkeypatch.setenv("BEDROCK_CALL_BUDGET_S", "30")
    monkeypatch.setenv("BEDROCK_READ_TIMEOUT_S", "9999")
    assert bedrock_read_timeout_seconds() == 30  # clamped to the budget


def _throttle_error() -> ClientError:
    return ClientError(
        {"Error": {"Code": "ThrottlingException", "Message": "slow down"}},
        "InvokeModel",
    )


def test_tenacity_retries_to_the_attempt_cap(monkeypatch):
    """On a persistent retryable error, tenacity retries up to the attempt cap.

    Proves tenacity (not botocore) performs the retries: the fake _invoke
    bypasses botocore entirely, so every attempt counted here is tenacity's.
    """
    if not bedrock_llm._TENACITY_AVAILABLE:  # pragma: no cover
        pytest.skip("tenacity not installed")

    # No real backoff sleeps — keep the test fast and deterministic.
    from tenacity import wait_none

    monkeypatch.setattr(bedrock_llm, "wait_exponential", lambda **kw: wait_none())
    monkeypatch.setenv("BEDROCK_MAX_ATTEMPTS", "3")
    monkeypatch.setenv("BEDROCK_CALL_BUDGET_S", "60")  # time budget won't trip first
    monkeypatch.setattr(bedrock_llm.boto3, "client", lambda **kw: object())

    inst = BedrockLLM(model_name="us.anthropic.claude-haiku-4-5-20251001-v1:0")
    # Collapse to a single model candidate so attempts are counted on one model.
    inst.fallback_model_id = inst.model_id
    inst._tertiary_model_id = inst.model_id

    calls = {"n": 0}

    def fake_invoke(model_id, body):
        calls["n"] += 1
        raise _throttle_error()

    monkeypatch.setattr(inst, "_invoke", fake_invoke)

    with pytest.raises(ClientError):
        inst.invoke_with_retry({"anything": 1})

    assert calls["n"] == 3  # first try + 2 tenacity retries


def test_max_attempts_env_override(monkeypatch):
    monkeypatch.setenv("BEDROCK_MAX_ATTEMPTS", "5")
    assert bedrock_max_attempts() == 5
    monkeypatch.setenv("BEDROCK_MAX_ATTEMPTS", "bad")
    assert bedrock_max_attempts() == 3
    monkeypatch.setenv("BEDROCK_MAX_ATTEMPTS", "0")
    assert bedrock_max_attempts() == 1  # never below a single attempt


def test_stream_collection_stops_when_the_call_budget_is_spent(monkeypatch):
    """A live converse_stream must not outrun the per-call budget."""
    monkeypatch.setattr(bedrock_llm, "bedrock_call_budget_seconds", lambda: 0.0)

    def events():
        yield {"contentBlockDelta": {"delta": {"text": "still thinking"}}}

    with pytest.raises(TimeoutError):
        bedrock_llm._collect_converse_stream({"stream": events()})
