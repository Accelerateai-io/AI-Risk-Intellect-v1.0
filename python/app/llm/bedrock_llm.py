"""
AWS Bedrock LLM client that matches the local_llm.py interface.
Provides access to Claude 3.5 Sonnet and other Bedrock models.
"""

import json
import boto3
import logging
import os
import re
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
from app.llm.model_registry import is_anthropic_model, supports_prompt_cache

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


_CACHE_POINT = {"cachePoint": {"type": "default"}}
_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)


def _is_cache_point_rejection(exc: ClientError) -> bool:
    err = exc.response.get("Error", {})
    if err.get("Code") != "ValidationException":
        return False
    msg = str(err.get("Message", "")).lower()
    return "cache" in msg


def _has_cache_points(system_blocks: list[dict], messages: list[dict]) -> bool:
    if any("cachePoint" in b for b in system_blocks):
        return True
    for m in messages:
        if any("cachePoint" in b for b in (m.get("content") or [])):
            return True
    return False


def _strip_cache_points(blocks: list[dict]) -> list[dict]:
    return [b for b in blocks if "cachePoint" not in b]


def _strip_cache_points_messages(messages: list[dict]) -> list[dict]:
    return [
        {**m, "content": _strip_cache_points(m.get("content") or [])}
        for m in messages
    ]


def _converse_text(resp: dict) -> str:
    """Join the text blocks of a Converse response; drop <think> reasoning.

    DeepSeek-R1 returns its chain of thought as a reasoningContent block (and
    some builds inline it as <think>...</think> in the text); only the answer
    text is parsed as JSON.
    """
    content = (resp.get("output") or {}).get("message", {}).get("content") or []
    parts = [b.get("text") for b in content if isinstance(b.get("text"), str)]
    text = "\n".join(p for p in parts if p)
    return _THINK_RE.sub("", text).strip()


class BedrockLLM:
    """AWS Bedrock client for LLM inference using Claude or other models"""
    
    
    MODELS = {
        "claude-haiku-4-5": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        "claude-3-5-haiku": "us.anthropic.claude-3-5-haiku-20241022-v1:0",
    }

    # Fallback when the primary model throttles, is rejected, or errors past
    # retries. Sourced from the env-driven default (BUG-13) instead of a
    # hard-coded id; runtime override via BEDROCK_FALLBACK_MODEL still applies.
    FALLBACK_MODEL_ID = DEFAULT_BEDROCK_MODEL

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

    # -----------------------------------------------------------------
    # Converse API path (BUG-11 / BUG-10)
    # -----------------------------------------------------------------
    # invoke_model needs a provider-specific body; the one above is the
    # Anthropic Messages shape, so DeepSeek, Nova, Llama, Mistral, Qwen, Grok
    # and gpt-oss either rejected it or returned a shape we could not parse,
    # and the job silently ran on the fallback Claude model while the record
    # was labelled with the configured model. Converse gives every text model
    # one request/response shape and supports cachePoint prompt caching.

    def _model_candidates(self) -> list[str]:
        seen: set[str] = set()
        ordered: list[str] = []
        for candidate in (self.model_id, self.fallback_model_id, self._tertiary_model_id):
            if candidate and candidate not in seen:
                seen.add(candidate)
                ordered.append(candidate)
        return ordered

    def _converse_once(
        self,
        model_id: str,
        system_blocks: list[dict],
        messages: list[dict],
        max_tokens: int,
        temperature: float,
    ) -> dict:
        kwargs: dict = {
            "modelId": model_id,
            "messages": messages,
            "inferenceConfig": {"maxTokens": max_tokens, "temperature": temperature},
        }
        if system_blocks:
            kwargs["system"] = system_blocks
        return self.client.converse(**kwargs)

    def converse_with_retry(
        self,
        system_blocks: list[dict],
        messages: list[dict],
        *,
        max_tokens: int = 4096,
        temperature: float = 0.1,
    ) -> tuple[dict, str]:
        """Converse with backoff on throttles and model fallback on hard errors.

        Returns (response, model_id_used). A ValidationException caused by an
        unsupported cachePoint is retried once on the same model with the
        cache markers removed, so caching can be left on for every model.
        """
        primary = self.model_id

        def _call(model_id: str, sys_blocks: list[dict], msgs: list[dict]) -> dict:
            if _TENACITY_AVAILABLE:
                @retry(
                    retry=retry_if_exception(_is_retryable_bedrock_error),
                    wait=wait_exponential(multiplier=1, min=1, max=8),
                    stop=stop_after_attempt(3),
                    reraise=True,
                )
                def _inner():
                    try:
                        return self._converse_once(model_id, sys_blocks, msgs, max_tokens, temperature)
                    except ClientError as e:
                        if _is_retryable_bedrock_error(e):
                            _emit_emf("BedrockThrottles", 1, dimensions={"Model": model_id})
                            logger.warning(
                                "Bedrock throttled on %s: %s — retrying",
                                model_id, e.response["Error"].get("Code"))
                        raise
                return _inner()
            return self._converse_once(model_id, sys_blocks, msgs, max_tokens, temperature)

        last_error: ClientError | None = None
        candidates = self._model_candidates()
        for index, model_id in enumerate(candidates):
            sys_blocks, msgs = system_blocks, messages
            try:
                try:
                    resp = _call(model_id, sys_blocks, msgs)
                except ClientError as e:
                    if _is_cache_point_rejection(e) and _has_cache_points(sys_blocks, msgs):
                        logger.info("Bedrock: %s rejected cachePoint — retrying without cache", model_id)
                        sys_blocks, msgs = _strip_cache_points(sys_blocks), _strip_cache_points_messages(msgs)
                        resp = _call(model_id, sys_blocks, msgs)
                    else:
                        raise
                if model_id != primary:
                    logger.warning("Bedrock: answered by fallback model %s (configured %s)", model_id, primary)
                return resp, model_id
            except ClientError as e:
                last_error = e
                if index >= len(candidates) - 1:
                    break
                logger.error(
                    "Bedrock converse failed on %s (%s: %s) — trying %s",
                    model_id,
                    e.response.get("Error", {}).get("Code"),
                    str(e.response.get("Error", {}).get("Message", ""))[:160],
                    candidates[index + 1],
                )
                _emit_emf(
                    "FallbackModelUsed",
                    1,
                    dimensions={"Primary": primary, "Fallback": candidates[index + 1]},
                )

        if last_error is not None:
            raise last_error
        raise RuntimeError("Bedrock converse failed with no model candidates")

    def _use_converse(self, use_tools: bool) -> bool:
        """Converse for every model except the Anthropic tool-use loop."""
        api = os.getenv("BEDROCK_API", "converse").strip().lower()
        if api == "invoke":
            return False
        if use_tools and is_anthropic_model(self.model_id):
            # The tool-use loop speaks the Anthropic tool protocol over
            # invoke_model; it is kept as-is until it is ported to toolConfig.
            return False
        return True

    def _cache_enabled(self) -> bool:
        flag = os.getenv("BEDROCK_PROMPT_CACHE", "auto").strip().lower()
        if flag in ("0", "false", "no", "off"):
            return False
        if flag in ("1", "true", "yes", "on"):
            return True
        return supports_prompt_cache(self.model_id)

    def _system_blocks(self, system_prompt: str) -> list[dict]:
        blocks: list[dict] = [{"text": system_prompt}]
        if self._cache_enabled():
            blocks.append(_CACHE_POINT)
        return blocks

    def _usage_from_converse(self, resp: dict, model_used: str) -> dict:
        usage = resp.get("usage") or {}
        input_tokens = int(usage.get("inputTokens") or 0)
        output_tokens = int(usage.get("outputTokens") or 0)
        cache_read = int(usage.get("cacheReadInputTokens") or 0)
        cache_write = int(usage.get("cacheWriteInputTokens") or 0)
        cost = self._compute_cost(input_tokens, output_tokens, model_id=model_used)
        if cache_read:
            _emit_emf("CacheReadInputTokens", cache_read, dimensions={"Model": model_used})
        if cache_write:
            _emit_emf("CacheWriteInputTokens", cache_write, dimensions={"Model": model_used})
        return {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cache_read_input_tokens": cache_read,
            "cache_write_input_tokens": cache_write,
            "cost_usd": cost,
        }

    def generate_text(
        self,
        system_prompt: str,
        user_blocks: list[dict],
        *,
        max_tokens: int = 2048,
        temperature: float = 0.0,
        model_id: Optional[str] = None,
    ) -> tuple[str, str, dict]:
        """Plain text completion over Converse (used by the verifier pass).

        ``user_blocks`` are Converse content blocks (``{"text": ...}`` and
        optional cachePoint markers). Returns (text, model_used, usage).
        ``model_id`` overrides the configured model for this call only.
        """
        messages = [{"role": "user", "content": list(user_blocks)}]
        if model_id and model_id != self.model_id:
            resp = self._converse_once(
                resolve_bedrock_invoke_model_id(model_id),
                self._system_blocks(system_prompt),
                messages,
                max_tokens,
                temperature,
            )
            used = resolve_bedrock_invoke_model_id(model_id)
        else:
            resp, used = self.converse_with_retry(
                self._system_blocks(system_prompt),
                messages,
                max_tokens=max_tokens,
                temperature=temperature,
            )
        return _converse_text(resp), used, self._usage_from_converse(resp, used)

    def _parse_json_converse(
        self,
        generated_text: str,
        system_blocks: list[dict],
        messages: list[dict],
        max_tokens: int,
    ) -> dict:
        """Parse model output; on failure ask the model (twice) for valid JSON."""
        from app.llm.json_parse import json_error_message, parse_llm_json

        history = list(messages)
        text = generated_text
        last_err: Exception | None = None
        for attempt in range(3):
            try:
                return parse_llm_json(text)
            except (json.JSONDecodeError, ValueError) as parse_err:
                last_err = parse_err
                if attempt == 2:
                    break
                logger.warning(
                    "Bedrock JSON parse failed (%s) — requesting corrected JSON (attempt %d)",
                    json_error_message(parse_err), attempt + 1,
                )
                instruction = (
                    f"Your previous response was not valid JSON ({json_error_message(parse_err)}). "
                    "Return ONLY a corrected JSON object matching the schema. Rules: "
                    "double-quoted keys and strings; comma after every value except the "
                    "last in each object/array; colon after every key; escape internal "
                    'quotes as \\"; no markdown fences or commentary.'
                    if attempt == 0
                    else f"Still invalid JSON ({json_error_message(parse_err)}). Output ONLY the "
                    "fixed JSON object. Validate: every property has a colon; values are "
                    "separated by commas; strings use double quotes; no trailing comma before } or ]."
                )
                history = history + [
                    {"role": "assistant", "content": [{"text": text[:8000] or "{}"}]},
                    {"role": "user", "content": [{"text": instruction}]},
                ]
                resp, _ = self.converse_with_retry(
                    system_blocks, history, max_tokens=max_tokens, temperature=0.0
                )
                text = _converse_text(resp)
        assert last_err is not None
        raise last_err
    
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

        try:
            if self._use_converse(use_tools):
                obj, usage, model_used = self._generate_json_converse(
                    _SYSTEM_PROMPT, user_prompt, max_new_tokens
                )
                total_cost = usage["cost_usd"]
                unknown_fields: list[str] = []
                api_used = "converse"
            else:
                # Legacy invoke_model path (Anthropic Messages body). Kept for
                # the tool-use loop and for BEDROCK_API=invoke.
                request_body = {
                    "anthropic_version": "bedrock-2023-05-31",
                    "max_tokens": max_new_tokens,
                    "temperature": 0.1,
                    "system": _SYSTEM_PROMPT,
                    "messages": [{"role": "user", "content": user_prompt}],
                }
                if use_tools:
                    from app.llm.tools.registry import get_tool_specs
                    request_body["tools"] = get_tool_specs()
                    obj, total_cost, unknown_fields = self._tool_use_loop(
                        request_body, input_text=input_text,
                    )
                    model_used = self.model_id
                else:
                    response_body, model_used = self.invoke_with_retry(request_body)
                    usage_raw = response_body.get("usage", {})
                    total_cost = self._compute_cost(
                        usage_raw.get("input_tokens", 0),
                        usage_raw.get("output_tokens", 0),
                        model_id=model_used,
                    )
                    if not response_body.get("content"):
                        raise ValueError("No content in Bedrock response")
                    generated_text = response_body["content"][0]["text"]
                    obj = self._parse_model_json(generated_text, request_body=request_body)
                    unknown_fields = []
                usage = {"cost_usd": total_cost}
                api_used = "invoke"

            logger.info(
                f"✓ Bedrock returned JSON: domains={obj.get('risk', {}).get('domains', 'N/A')}, "
                f"model={model_used}, cost=${total_cost:.4f}"
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

            # Record which model actually answered (BUG-11): the risk row
            # used to carry the configured model even when a fallback ran.
            meta = obj.setdefault("_meta", {})
            if not isinstance(meta, dict):
                meta = {}
                obj["_meta"] = meta
            meta["model_used"] = model_used
            meta["model_configured"] = self.model_id
            meta["model_fallback"] = model_used != self.model_id
            meta["api"] = api_used
            meta["usage"] = usage

            from app.llm.repair import repair_extraction_obj
            return repair_extraction_obj(obj, input_text, schema_json)

        except ClientError as e:
            error_code = e.response["Error"]["Code"]
            error_message = e.response["Error"]["Message"]
            logger.error(f"❌ Bedrock API error [{error_code}]: {error_message}")
            detail = f"Bedrock error: {error_code}: {str(error_message)[:200]}"
            if error_code == "ValidationException":
                detail = (
                    f"Bedrock error: ValidationException ({str(error_message)[:160]}) — check "
                    f"BEDROCK_MODEL_ID (configured: {self.model_name}, invoke id: {self.model_id})"
                )
            return self._create_fallback_object(input_text, detail)

        except Exception as e:
            logger.error(f"❌ Bedrock generation failed: {e}")
            detail = str(e)
            if "json" in detail.lower() or "delimiter" in detail.lower():
                detail = f"Bedrock returned invalid JSON: {detail}"
            return self._create_fallback_object(input_text, detail)

    # Marker that separates the cacheable prefix (metadata, schema, article)
    # from the per-call instruction in the user prompt built above.
    _USER_PROMPT_SPLIT = "\n\nExtract the AI risk information and return ONLY valid JSON"

    def _generate_json_converse(
        self,
        system_prompt: str,
        user_prompt: str,
        max_new_tokens: int,
    ) -> tuple[dict, dict, str]:
        """One extraction call over Converse. Returns (obj, usage, model_used)."""
        system_blocks = self._system_blocks(system_prompt)
        split_at = user_prompt.find(self._USER_PROMPT_SPLIT)
        if split_at > 0:
            prefix, suffix = user_prompt[:split_at], user_prompt[split_at:].lstrip()
        else:
            prefix, suffix = user_prompt, ""
        content: list[dict] = [{"text": prefix}]
        if self._cache_enabled():
            content.append(_CACHE_POINT)
        if suffix:
            content.append({"text": suffix})
        messages = [{"role": "user", "content": content}]

        resp, model_used = self.converse_with_retry(
            system_blocks, messages, max_tokens=max_new_tokens, temperature=0.1
        )
        usage = self._usage_from_converse(resp, model_used)
        text = _converse_text(resp)
        if not text:
            raise ValueError("No text content in Bedrock converse response")
        obj = self._parse_json_converse(text, system_blocks, messages, max_new_tokens)
        return obj, usage, model_used

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
                "secondary_risks": "Technical/Performance Risk",
                "ai_product_name": None,
                "ai_product_vendor": None
            },
            "risk_scoring": {
                "likelihood": None,
                "likelihood_reasoning": "",
                "impact": None,
                "impact_reasoning": "",
                "loss_categories": [],
                "severity_score": None,
                "severity_band": None
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
