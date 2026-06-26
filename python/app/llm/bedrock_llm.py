"""
AWS Bedrock LLM client that matches the local_llm.py interface.
Provides access to Claude 3.5 Sonnet and other Bedrock models.
"""

import json
import boto3
import logging
import os
import time
from typing import Dict, Any, Optional
from botocore.exceptions import ClientError

try:
    from tenacity import (
        retry,
        retry_if_exception,
        stop_after_attempt,
        wait_exponential,
    )
    _TENACITY_AVAILABLE = True
except ImportError:  # pragma: no cover - soft dep, fallback keeps old behavior
    _TENACITY_AVAILABLE = False

from app.env_bootstrap import DEFAULT_BEDROCK_MODEL, normalize_bedrock_model
from app.llm.bedrock_model_id import (
    resolve_bedrock_invoke_model_id,
    with_us_model_prefix,
)

logger = logging.getLogger("airisk")


# --- Throttle / retry classification ----------------------------------------
_RETRYABLE_CODES = {
    "ThrottlingException",
    "TooManyRequestsException",
    "ModelTimeoutException",
    "ModelErrorException",
    "ServiceUnavailableException",
    "InternalServerException",
}


def _is_retryable_bedrock_error(exc: BaseException) -> bool:
    if isinstance(exc, ClientError):
        code = exc.response.get("Error", {}).get("Code", "")
        return code in _RETRYABLE_CODES
    return False


# --- CloudWatch EMF emission -------------------------------------------------
def _emit_emf(metric_name: str, value: float, unit: str = "Count",
              dimensions: Optional[Dict[str, str]] = None) -> None:
    """Emit a single CloudWatch Embedded Metric Format log line.

    EMF is parsed out of container stdout by the CloudWatch agent on ECS with
    no extra infra. Namespace: AIRisk/Agents. Safe to call on dev (just logs a
    JSON line). Never raises.
    """
    try:
        dims = dimensions or {}
        emf_doc = {
            "_aws": {
                "Timestamp": int(time.time() * 1000),
                "CloudWatchMetrics": [{
                    "Namespace": "AIRisk/Agents",
                    "Dimensions": [list(dims.keys())] if dims else [[]],
                    "Metrics": [{"Name": metric_name, "Unit": unit}],
                }],
            },
            metric_name: value,
            **dims,
        }
        # Print to stdout so the ECS awslogs driver + CloudWatch agent parses it.
        print(json.dumps(emf_doc))
    except Exception:  # pragma: no cover - EMF must never break a job
        pass


class BedrockLLM:
    """AWS Bedrock client for LLM inference using Claude or other models"""
    
    
    MODELS = {
        "claude-haiku-4-5": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        "claude-3-5-haiku": "us.anthropic.claude-3-5-haiku-20241022-v1:0",
    }

    # Fallback when the primary model throttles, is rejected, or errors past retries.
    FALLBACK_MODEL_ID = "us.anthropic.claude-3-sonnet-20240229-v1:0:200k"

    def __init__(
        self,
        model_name: str = DEFAULT_BEDROCK_MODEL,
        region_name: str = "us-east-1"
    ):
        """
        Initialize Bedrock client.

        Args:
            model_name: One of: claude-3-5-sonnet, claude-3-5-haiku, claude-3-haiku
            region_name: AWS region (default: us-east-1)
        """
        resolved_name = normalize_bedrock_model(model_name)
        self.model_name = resolved_name
        if resolved_name in self.MODELS:
            self.model_id = resolve_bedrock_invoke_model_id(self.MODELS[resolved_name])
        elif resolved_name and (":" in resolved_name or "." in resolved_name):
            # Full Bedrock model id from BEDROCK_MODEL / BEDROCK_MODEL_ID env
            self.model_id = resolve_bedrock_invoke_model_id(resolved_name)
        else:
            self.model_id = resolve_bedrock_invoke_model_id(DEFAULT_BEDROCK_MODEL)
        fallback = (
            os.getenv("BEDROCK_FALLBACK_MODEL", "").strip()
            or self.FALLBACK_MODEL_ID
        )
        self.fallback_model_id = resolve_bedrock_invoke_model_id(fallback)
        # Last resort when configured primary/fallback resolve to the same rejected id.
        self._tertiary_model_id = resolve_bedrock_invoke_model_id(
            self.MODELS["claude-haiku-4-5"]
        )
        self.region_name = region_name

        self.client = boto3.client(
            service_name='bedrock-runtime',
            region_name=region_name
        )

        logger.info(f"✅ Initialized AWS Bedrock LLM client")
        logger.info(f"   Model: {self.model_id}")
        logger.info(f"   Fallback: {self.fallback_model_id}")
        logger.info(f"   Region: {region_name}")

    # -----------------------------------------------------------------
    # Resilient invoke wrapper (retry + fallback model + EMF metrics)
    # -----------------------------------------------------------------
    def _invoke(self, model_id: str, body: dict) -> dict:
        """Single Bedrock call. Raises on ClientError; caller handles retry."""
        return self.client.invoke_model(modelId=model_id, body=json.dumps(body))

    def invoke_with_retry(self, body: dict) -> tuple[dict, str]:
        """Invoke Bedrock with exponential backoff + fallback model.

        Returns (response_body_dict, model_id_used). Emits BedrockThrottles
        and FallbackModelUsed EMF metrics so ops can see retry pressure
        before cost alarms fire.
        """
        primary = self.model_id
        fallback = self.fallback_model_id
        tertiary = self._tertiary_model_id

        def _invoke_candidates() -> list[str]:
            seen: set[str] = set()
            ordered: list[str] = []
            for candidate in (primary, fallback, tertiary):
                if candidate and candidate not in seen:
                    seen.add(candidate)
                    ordered.append(candidate)
            return ordered

        def _call(model_id: str) -> dict:
            if _TENACITY_AVAILABLE:
                @retry(
                    retry=retry_if_exception(_is_retryable_bedrock_error),
                    wait=wait_exponential(multiplier=1, min=1, max=8),
                    stop=stop_after_attempt(3),
                    reraise=True,
                )
                def _inner():
                    try:
                        return self._invoke(model_id, body)
                    except ClientError as e:
                        if _is_retryable_bedrock_error(e):
                            _emit_emf("BedrockThrottles", 1,
                                      dimensions={"Model": model_id})
                            logger.warning(
                                "Bedrock throttled on %s: %s — retrying",
                                model_id, e.response["Error"].get("Code"))
                        raise
                return _inner()
            # tenacity missing — single shot, no retry
            return self._invoke(model_id, body)

        last_error: ClientError | None = None
        candidates = _invoke_candidates()
        for index, model_id in enumerate(candidates):
            try:
                resp = _call(model_id)
                return json.loads(resp["body"].read()), model_id
            except ClientError as e:
                last_error = e
                if index >= len(candidates) - 1:
                    break
                logger.error(
                    "Bedrock invoke failed on %s (%s) — trying %s",
                    model_id,
                    e.response.get("Error", {}).get("Code"),
                    candidates[index + 1],
                )
                _emit_emf(
                    "FallbackModelUsed",
                    1,
                    dimensions={"Primary": primary, "Fallback": candidates[index + 1]},
                )

        if last_error is not None:
            raise last_error
        raise RuntimeError("Bedrock invoke failed with no model candidates")
    
    def generate_json(
        self,
        input_text: str,
        schema_json: dict,
        max_new_tokens: int = 4096,
        **kwargs
    ) -> dict:
        """
        Generate JSON output from Bedrock model.
        Compatible with local_llm.generate_json() interface.

        Args:
            input_text: The input text to process
            schema_json: The JSON schema for validation
            max_new_tokens: Maximum tokens to generate
            **kwargs: Additional arguments (title, url, chunk_index,
                      system_prompt_override — used by router agent to inject
                      a specialist prompt — etc.)

        Returns:
            dict: Extracted risk data matching the schema
        """

        # Resolve the system prompt: explicit override (router agent) wins,
        # otherwise use the active PromptVersion from DB (cached, with static
        # fallback to system_prompt.txt). This wires Phase 7's PromptVersion
        # mechanism into the LLM call site.
        system_prompt_override = kwargs.get("system_prompt_override")
        if system_prompt_override:
            _SYSTEM_PROMPT = system_prompt_override
        else:
            try:
                from app.utils.prompt_loader import get_active_prompt
                _SYSTEM_PROMPT = get_active_prompt()
            except Exception as _e:
                # Defensive fallback if prompt_loader/db is unavailable.
                logger.warning("bedrock_llm: prompt_loader failed (%s), using static prompt", _e)
                from app.llm.local_llm import _load_system_prompt
                _SYSTEM_PROMPT = _load_system_prompt()

        # Optional few-shot block from gold-tier in-use FeedbackSamples.
        # Returns "" when ENABLE_FEW_SHOT=false (default) or no samples.
        few_shot_block = ""
        try:
            from app.utils.prompt_loader import get_few_shot_block
            few_shot_block = get_few_shot_block()
        except Exception as _e:
            logger.debug("bedrock_llm: few-shot lookup skipped: %s", _e)
        
        # Build the user prompt
        schema_str = json.dumps(schema_json, ensure_ascii=False, indent=2)
        
        # Extract metadata
        title = kwargs.get('title', '')
        url = kwargs.get('url', '')
        chunk_index = kwargs.get('chunk_index')
        chunk_count = kwargs.get('chunk_count')
        global_offset = kwargs.get('global_offset')
        
        # Build metadata block
        meta_lines = []
        if title:
            meta_lines.append(f"Title: {title}")
        if url:
            meta_lines.append(f"URL: {url}")
        if chunk_index is not None:
            meta_lines.append(
                f"CHUNK: {chunk_index} of {chunk_count} (GLOBAL_OFFSET={global_offset or 0})"
            )
        meta_block = "\n".join(meta_lines) or "(none)"
        
        # Build full user prompt. The few-shot block goes BETWEEN the schema
        # and the article text so the model sees the schema, then concrete
        # examples of what valid output looks like, then the article to
        # extract from.
        few_shot_section = f"\n{few_shot_block}\n" if few_shot_block else ""
        user_prompt = f"""METADATA:
{meta_block}

SCHEMA:
{schema_str}
{few_shot_section}
ARTICLE TEXT:
{input_text}

Extract the AI risk information and return ONLY valid JSON matching the schema above.

JSON FORMATTING (strict — invalid JSON will be rejected):
- Double quotes for all keys and string values
- Colon after every key: "key": value
- Comma after every value except the last in each {{ }} or [ ]
- Escape quotes inside strings as \\"
- No trailing commas, comments, markdown fences, or text outside the JSON object"""
        
        # Tool-use mode: when ENABLE_TOOL_USE=true (default false during
        # rollout), we expose 4 tools to the model so it can ground entities,
        # OWASP IDs, and evidence — and explicitly refuse via
        # mark_field_unknown instead of hallucinating "unspecified".
        use_tools = os.getenv("ENABLE_TOOL_USE", "false").lower() in ("1", "true", "yes")

        # Build base request body — tools are added only when enabled, so
        # the non-tool-use path is byte-identical to the previous behavior.
        request_body = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": max_new_tokens,
            "temperature": 0.1,
            "system": _SYSTEM_PROMPT,
            "messages": [
                {"role": "user", "content": user_prompt}
            ],
        }

        if use_tools:
            from app.llm.tools.registry import get_tool_specs
            request_body["tools"] = get_tool_specs()

        try:
            if use_tools:
                # Multi-turn tool-use loop. The model may call tools several
                # times before producing final JSON. We cap iterations to
                # prevent runaway cost.
                obj, total_cost, unknown_fields = self._tool_use_loop(
                    request_body, input_text=input_text,
                )
            else:
                # Original single-shot path (preserved for backward compat),
                # now wrapped with retry + fallback + EMF.
                response_body, model_used = self.invoke_with_retry(request_body)

                usage = response_body.get("usage", {})
                total_cost = self._compute_cost(
                    usage.get("input_tokens", 0),
                    usage.get("output_tokens", 0),
                    model_id=model_used,
                )

                if not response_body.get("content"):
                    raise ValueError("No content in Bedrock response")
                generated_text = response_body["content"][0]["text"]
                # print("RAW LLM JSON TEXT from bedrock",generated_text)
                obj = self._parse_model_json(
                    generated_text,
                    request_body=request_body,
                )
                unknown_fields = []

            logger.info(
                f"✓ Bedrock returned JSON: domains={obj.get('risk', {}).get('domains', 'N/A')}, cost=${total_cost:.4f}"
            )

            # If the model used mark_field_unknown for any field, set those
            # fields to None and flag the risk for review (worker will see
            # _tool_use_unknown_fields and route to pending_review).
            if unknown_fields:
                risk_block = obj.setdefault("risk", {})
                for field in unknown_fields:
                    if field in risk_block:
                        risk_block[field] = None
                obj["_tool_use_unknown_fields"] = unknown_fields

            from app.llm.repair import repair_extraction_obj
            return repair_extraction_obj(obj, input_text, schema_json)

        except ClientError as e:
            error_code = e.response["Error"]["Code"]
            error_message = e.response["Error"]["Message"]
            logger.error(f"❌ Bedrock API error [{error_code}]: {error_message}")
            detail = f"Bedrock error: {error_code}"
            if error_code == "ValidationException":
                detail = (
                    "Bedrock error: invalid model identifier — check BEDROCK_MODEL_ID "
                    f"(configured: {self.model_name}, invoke id: {self.model_id})"
                )
            return self._create_fallback_object(input_text, detail)

        except Exception as e:
            logger.error(f"❌ Bedrock generation failed: {e}")
            detail = str(e)
            if "json" in detail.lower() or "delimiter" in detail.lower():
                detail = f"Bedrock returned invalid JSON: {detail}"
            return self._create_fallback_object(input_text, detail)

    # ---------------------------------------------------------------
    # Tool-use loop and cost helper
    # ---------------------------------------------------------------

    def _compute_cost(self, input_tokens: int, output_tokens: int,
                      model_id: Optional[str] = None) -> float:
        """Compute USD cost for this Bedrock call based on the model in use.

        Also emits EMF metrics (InputTokens, OutputTokens, CostUSD) under the
        AIRisk/Agents namespace dimensioned by Model so we can build a
        per-model cost dashboard before flipping agent flags in prod.
        """
        mid = model_id or self.model_id
        if "haiku-4-5" in mid:
            cost = input_tokens / 1_000_000 * 1.00 + output_tokens / 1_000_000 * 5.00
        elif "3-5-haiku" in mid:
            cost = input_tokens / 1_000_000 * 0.80 + output_tokens / 1_000_000 * 4.00
        else:
            cost = 0.0

        dims = {"Model": mid}
        _emit_emf("InputTokens", input_tokens, unit="Count", dimensions=dims)
        _emit_emf("OutputTokens", output_tokens, unit="Count", dimensions=dims)
        _emit_emf("CostUSD", cost, unit="None", dimensions=dims)
        return cost

    def _tool_use_loop(self, request_body: dict, input_text: str,
                       max_iterations: int = 6) -> tuple[dict, float, list[str]]:
        """Run the multi-turn tool-use conversation until Claude returns final text.

        Anthropic tool-use protocol:
          1. Send messages + tools, get response
          2. If response contains tool_use blocks, execute them, send back
             tool_result blocks as a user message, repeat
          3. When response is text-only (no tool_use), parse the final JSON

        Returns (parsed_json, total_cost_usd, fields_marked_unknown).
        """
        from app.llm.tools.registry import execute_tool

        messages = list(request_body["messages"])
        total_cost = 0.0
        unknown_fields: list[str] = []

        for iteration in range(max_iterations):
            body = dict(request_body)
            body["messages"] = messages
            resp, model_used = self.invoke_with_retry(body)

            usage = resp.get("usage", {})
            total_cost += self._compute_cost(
                usage.get("input_tokens", 0),
                usage.get("output_tokens", 0),
                model_id=model_used,
            )

            content_blocks = resp.get("content") or []
            stop_reason = resp.get("stop_reason")

            # Append the assistant's response to the running conversation.
            messages.append({"role": "assistant", "content": content_blocks})

            # If the model didn't call a tool, this is the final answer.
            tool_uses = [b for b in content_blocks if b.get("type") == "tool_use"]
            if not tool_uses or stop_reason != "tool_use":
                # Find the text block(s) and parse JSON.
                text_blocks = [b for b in content_blocks if b.get("type") == "text"]
                if not text_blocks:
                    raise ValueError("Bedrock returned no text and no tool_use")
                generated_text = "\n".join(b.get("text", "") for b in text_blocks)
                obj = self._parse_model_json(generated_text, request_body=request_body)
                _emit_emf("ToolUseIterations", iteration + 1, unit="Count",
                          dimensions={"Model": model_used})
                return obj, total_cost, unknown_fields

            # Execute every tool call and build a tool_result message.
            tool_results = []
            for tu in tool_uses:
                tool_name = tu.get("name")
                tool_input = tu.get("input") or {}
                # Special handling for mark_field_unknown — record which
                # fields the model refused to fill so the orchestrator can
                # null them out + route to review.
                if tool_name == "mark_field_unknown":
                    field_name = tool_input.get("field_name")
                    if field_name:
                        unknown_fields.append(field_name)

                result = execute_tool(tool_name, tool_input)
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tu.get("id"),
                    "content": json.dumps(result),
                })

            messages.append({"role": "user", "content": tool_results})

        # Loop budget exhausted — fall back to whatever we have so far.
        logger.warning("bedrock_llm: tool-use loop hit max_iterations=%d", max_iterations)
        # Re-call without tools to force a final answer.
        body = dict(request_body)
        body.pop("tools", None)
        body["messages"] = messages + [
            {"role": "user", "content": "Stop using tools. Respond NOW with the final JSON."}
        ]
        resp, model_used = self.invoke_with_retry(body)
        usage = resp.get("usage", {})
        total_cost += self._compute_cost(
            usage.get("input_tokens", 0),
            usage.get("output_tokens", 0),
            model_id=model_used,
        )
        text_blocks = [b for b in (resp.get("content") or []) if b.get("type") == "text"]
        generated_text = "\n".join(b.get("text", "") for b in text_blocks) or "{}"
        obj = self._parse_model_json(generated_text, request_body=request_body)
        return obj, total_cost, unknown_fields

    def _parse_model_json(
        self,
        generated_text: str,
        request_body: dict | None = None,
    ) -> dict:
        """Parse model output; repair locally, then retry via Bedrock if needed."""
        from app.llm.json_parse import json_error_message, parse_llm_json

        try:
            return parse_llm_json(generated_text)
        except (json.JSONDecodeError, ValueError) as parse_err:
            if not request_body:
                raise
            logger.warning(
                "Bedrock JSON parse failed (%s) — requesting corrected JSON",
                json_error_message(parse_err),
            )
            return self._retry_json_repair(
                request_body,
                generated_text,
                json_error_message(parse_err),
            )

    def _retry_json_repair(
        self,
        request_body: dict,
        bad_text: str,
        error: str,
    ) -> dict:
        """Follow-up Bedrock call asking for valid JSON only."""
        from app.llm.json_parse import json_error_message, parse_llm_json

        repair_body = dict(request_body)
        repair_body["temperature"] = 0.0
        repair_body["messages"] = list(request_body["messages"]) + [
            {
                "role": "assistant",
                "content": [{"type": "text", "text": bad_text[:8000]}],
            },
            {
                "role": "user",
                "content": (
                    f"Your previous response was not valid JSON ({error}). "
                    "Return ONLY a corrected JSON object matching the schema. "
                    "Rules: double-quoted keys and strings; comma after every "
                    "value except the last in each object/array; colon after "
                    "every key; escape internal quotes as \\\"; no markdown fences "
                    "or commentary."
                ),
            },
        ]
        response_body, _ = self.invoke_with_retry(repair_body)
        if not response_body.get("content"):
            raise ValueError("No content in Bedrock JSON-repair response")
        repaired_text = response_body["content"][0]["text"]
        try:
            return parse_llm_json(repaired_text)
        except (json.JSONDecodeError, ValueError) as second_err:
            logger.warning(
                "Bedrock JSON repair pass failed (%s) — second repair attempt",
                json_error_message(second_err),
            )
            return self._retry_json_repair_second(
                repair_body,
                repaired_text,
                json_error_message(second_err),
            )

    def _retry_json_repair_second(
        self,
        prior_repair_body: dict,
        bad_text: str,
        error: str,
    ) -> dict:
        from app.llm.json_parse import json_error_message, parse_llm_json

        repair_body = dict(prior_repair_body)
        repair_body["messages"] = list(prior_repair_body["messages"]) + [
            {
                "role": "assistant",
                "content": [{"type": "text", "text": bad_text[:8000]}],
            },
            {
                "role": "user",
                "content": (
                    f"Still invalid JSON ({error}). Output ONLY the fixed JSON object. "
                    "Validate: every property has a colon; values are separated by "
                    "commas; strings use double quotes; no trailing comma before } or ]."
                ),
            },
        ]
        response_body, _ = self.invoke_with_retry(repair_body)
        if not response_body.get("content"):
            raise ValueError("No content in Bedrock JSON-repair response")
        repaired_text = response_body["content"][0]["text"]
        return parse_llm_json(repaired_text)

    def _create_fallback_object(self, input_text: str, error_msg: str) -> dict:
        """Create a minimal valid object when extraction fails.

        IMPORTANT: This object MUST be marked with `_source = "stub"` so that
        downstream code (extract_utils, job_worker) can detect and reject it
        instead of persisting "Failed Risk Extraction" rows to the database.
        """
        return {
            "_source": "stub",
            "_stub_reason": error_msg,
            "risk": {
                "risk_title": "Failed Risk Extraction",
                "domains": "7. AI System Safety, Failures, & Limitations",
                "description": input_text[:200] if input_text else "Failed to extract risk from input",
                "attack_vector": "Unknown",
                "observable_indicators": "Extraction failure",
                "data_to_identify_risk": "Manual review of source content",
                "evidence_sources": "Original article text",
                "intent": "Unknown",
                "timing": "Unknown",
                "risk_type_detected": "Extraction Error",
                "primary_risk": "Technical Risks",
                "secondary_risks": "Technical/Performance Risk"
            },
            "controls": [{
                "control_ref": "ERR-001",
                "name": "Manual Review Required",
                "why": f"Automated extraction failed: {error_msg}",
                "score": 0.1
            }],
            "analysis": {
                "risk_identified": "Extraction process failed",
                "article_context": f"Bedrock error occurred: {error_msg}",
                "alignment_reasoning": "Manual review required to properly extract risk"
            }
        }


# Singleton instance
_bedrock_client: Optional[BedrockLLM] = None


def get_bedrock_client(
    model_name: str = None,
    region_name: str = None
) -> BedrockLLM:
    """
    Get or create singleton Bedrock client.
    
    Args:
        model_name: Override default model from env
        region_name: Override default region from env
    """
    global _bedrock_client
    
    if _bedrock_client is None:
        model = (
            model_name
            or os.getenv("BEDROCK_MODEL", "").strip()
            or os.getenv("BEDROCK_MODEL_ID", "").strip()
            or DEFAULT_BEDROCK_MODEL
        )
        region = (
            region_name
            or os.getenv("AWS_REGION", "").strip()
            or os.getenv("AWS_DEFAULT_REGION", "us-east-1")
        )
        _bedrock_client = BedrockLLM(model_name=model, region_name=region)
    
    return _bedrock_client


def generate_json(
    input_text: str,
    schema_json: dict,
    max_new_tokens: int = 4096,
    **kwargs
) -> dict:
    """
    Module-level function matching local_llm.generate_json() interface.
    This allows drop-in replacement in extract_utils.py
    """
    client = get_bedrock_client()
    return client.generate_json(input_text, schema_json, max_new_tokens, **kwargs)
