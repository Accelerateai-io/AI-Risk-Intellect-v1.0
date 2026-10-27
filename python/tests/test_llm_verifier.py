"""BUG-06: independent verifier pass.

TC-15 verifier blocks ungrounded records
TC-16 grounded records pass without a reason
"""

from __future__ import annotations

import json

from app.extraction import extract_utils
from app.verification.llm_verifier import (
    REASON_PREFIX,
    VERIFIER_CHECKS,
    build_verifier_blocks,
    parse_verifier_response,
    record_summary,
    run_verifier,
    verifier_review_reasons,
)

RECORD = {
    "risk": {
        "risk_title": "Hallucination in EEG pipelines",
        "description": "desc",
        "evidence_type": "demonstrated",
        "mitigations_in_source": ["not described in source"],
        "controls": "ignored",
    },
    "risk_scoring": {
        "likelihood": 4,
        "likelihood_reasoning": "patient data exposed to third parties",
        "impact": 4,
        "impact_reasoning": "HIPAA",
    },
}


def _verdict(**overrides) -> str:
    base = {
        name: {"pass": True, "reason": f"{name} ok"} for name in VERIFIER_CHECKS
    }
    base["grounding_score"] = 0.9
    base["unsupported_claims"] = []
    for k, v in overrides.items():
        base[k] = v
    return json.dumps(base)


def test_record_summary_keeps_only_auditable_fields():
    summary = record_summary(RECORD)
    assert "controls" not in summary["risk"]
    assert summary["risk"]["risk_title"] == "Hallucination in EEG pipelines"
    assert summary["risk_scoring"]["likelihood"] == 4


def test_blocks_put_source_first_and_cache_point_when_asked():
    blocks = build_verifier_blocks(RECORD, "SOURCE TEXT", cache_source=True)
    assert blocks[0]["text"].startswith("=== SOURCE ===")
    assert blocks[1] == {"cachePoint": {"type": "default"}}
    assert blocks[2]["text"].startswith("=== RECORD ===")
    blocks = build_verifier_blocks(RECORD, "SOURCE TEXT", cache_source=False)
    assert len(blocks) == 2


def test_long_source_is_head_and_tail():
    text = "H" * 1000 + "M" * 1000 + "T" * 1000
    blocks = build_verifier_blocks(RECORD, text, max_source_chars=1000)
    body = blocks[0]["text"]
    assert "middle of document omitted" in body
    assert body.count("H") == 600 and body.count("T") == 400 + body.count("T") - 400


def test_parse_handles_shapes_and_garbage():
    r = parse_verifier_response(_verdict(severity_within_evidence={"pass": "false", "reason": "x"}))
    assert r["checks"]["severity_within_evidence"]["pass"] is False
    assert r["checks"]["claim_is_demonstrated"]["pass"] is True
    assert r["grounding_score"] == 0.9 and r["parsed"]

    r = parse_verifier_response('{"claim_is_demonstrated": false, "grounding_score": 7}')
    assert r["checks"]["claim_is_demonstrated"]["pass"] is False
    assert r["checks"]["mitigations_reflected"]["pass"] is None
    assert r["grounding_score"] == 1.0

    r = parse_verifier_response("no json here")
    assert not r["parsed"] and r["grounding_score"] is None


def test_review_reasons_name_each_failed_check():
    result = parse_verifier_response(
        _verdict(
            severity_within_evidence={"pass": False, "reason": "rationale is about privacy, title is about hallucination"},
            mitigations_reflected={"pass": False, "reason": "paper validates on 3 datasets"},
            grounding_score=0.3,
        )
    )
    reasons = verifier_review_reasons(result, grounding_min=0.6)
    assert len(reasons) == 3
    assert reasons[0].startswith(f"{REASON_PREFIX} mitigations_reflected failed")
    assert "paper validates on 3 datasets" in reasons[0]
    assert reasons[1].startswith(f"{REASON_PREFIX} severity_within_evidence failed")
    assert "grounding_score 0.30 below 0.60" in reasons[2]

    assert verifier_review_reasons(parse_verifier_response(_verdict()), grounding_min=0.6) == []
    assert verifier_review_reasons(parse_verifier_response("garbage"), grounding_min=0.6) == [
        f"{REASON_PREFIX} no verdict - verifier response could not be parsed"
    ]


def test_run_verifier_passes_model_and_never_raises():
    seen = {}

    def ok(system, blocks, **kw):
        seen.update(kw)
        assert "independent evidence auditor" in system
        return _verdict(), "us.anthropic.claude-sonnet-5", {"input_tokens": 1}

    result = run_verifier(RECORD, "src", generate_text=ok, model_id="us.anthropic.claude-sonnet-5")
    assert result["ran"] and result["passed"] and result["review_reasons"] == []
    assert result["model_used"] == "us.anthropic.claude-sonnet-5"
    assert seen["model_id"] == "us.anthropic.claude-sonnet-5" and seen["temperature"] == 0.0

    def boom(*a, **k):
        raise RuntimeError("throttled")

    result = run_verifier(RECORD, "src", generate_text=boom)
    assert result["ran"] is False
    assert result["review_reasons"] == [f"{REASON_PREFIX} did not run - throttled"]


# --- wiring into the extraction path ------------------------------------------------

def _model_output():
    return {
        "risk": {
            "risk_title": "A sufficiently long risk title",
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
            "likelihood": 4,
            "likelihood_reasoning": "word word word word word word",
            "impact": 4,
            "impact_reasoning": "word word word word word word",
            "loss_categories": [],
        },
        "justification": {"self_assessment": {"total_score": 93, "confidence_level": "high"}},
    }


class FakeClient:
    def __init__(self, verdict: str):
        self.verdict = verdict
        self.calls = 0

    def _cache_enabled(self):
        return False

    def generate_text(self, system, blocks, **kw):
        self.calls += 1
        return self.verdict, "verifier-model", {"input_tokens": 10}


def _wire(monkeypatch, verdict: str) -> FakeClient:
    client = FakeClient(verdict)
    monkeypatch.setenv("USE_BEDROCK", "true")
    monkeypatch.delenv("ENABLE_VERIFIER", raising=False)
    monkeypatch.delenv("EXTRACTION_MODE", raising=False)
    monkeypatch.setattr(extract_utils, "_resolve_generate_json", lambda: (lambda *a, **k: _model_output(), "bedrock"))
    monkeypatch.setattr(extract_utils, "get_current_model_name", lambda: "us.anthropic.claude-haiku-4-5")
    import app.llm.bedrock_llm as bl

    monkeypatch.setattr(bl, "get_bedrock_client", lambda *a, **k: client)
    return client


def test_tc15_ungrounded_record_routed_to_review(monkeypatch):
    client = _wire(
        monkeypatch,
        _verdict(severity_within_evidence={"pass": False, "reason": "rationale about another topic"}),
    )
    obj, flag, _ = extract_utils.extract_with_auto_chunking("word word word word word word " * 50, extract_utils.load_risk_schema())
    assert flag == "bedrock" and client.calls == 1
    meta = obj["_meta"]
    assert meta["verifier"]["ran"] and not meta["verifier"]["passed"]
    reasons = meta["verification"]["review_reasons"]
    assert any(r.startswith("Verifier: severity_within_evidence failed") for r in reasons)
    assert reasons == meta["review_reasons"]


def test_tc16_grounded_record_has_no_verifier_reason(monkeypatch):
    client = _wire(monkeypatch, _verdict())
    obj, _, _ = extract_utils.extract_with_auto_chunking("word word word word word word " * 50, extract_utils.load_risk_schema())
    assert client.calls == 1
    assert obj["_meta"]["verifier"]["passed"] is True
    assert not any(r.startswith("Verifier:") for r in obj["_meta"].get("review_reasons", []))


def test_verifier_can_be_disabled(monkeypatch):
    client = _wire(monkeypatch, _verdict())
    monkeypatch.setenv("ENABLE_VERIFIER", "false")
    obj, _, _ = extract_utils.extract_with_auto_chunking("word " * 300, extract_utils.load_risk_schema())
    assert client.calls == 0
    assert obj["_meta"]["verifier"] == {"ran": False, "reason": "ENABLE_VERIFIER=false"}
