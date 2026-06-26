# Refactored local_llm.py
# NOTE: This is a cleaned, structured version keeping all functionality but
# removing the unused CLI, unused imports, and improving readability.

import json
import os
import re
import torch
import logging
from typing import Optional, Any, Dict
from transformers import AutoModelForCausalLM, AutoTokenizer

from app.llm.json_parse import parse_llm_json
from app.llm.repair import repair_extraction_obj

logger = logging.getLogger("airisk")

# ---------------------------------------------------------------------------
# Model configuration
# ---------------------------------------------------------------------------
MODEL_ID = os.getenv("LOCAL_MODEL_ID", "Qwen/Qwen2.5-3b-Instruct")
CACHE_DIR = os.getenv("MODEL_CACHE_DIR", "./models")

_tokenizer: Optional[AutoTokenizer] = None
_model: Optional[AutoModelForCausalLM] = None

# ---------------------------------------------------------------------------
# Load system prompt from file
# ---------------------------------------------------------------------------
_PROMPT_PATH = os.path.join(os.path.dirname(__file__), "system_prompt.txt")

def _load_system_prompt() -> str:
    """Load the system prompt from external file."""
    try:
        with open(_PROMPT_PATH, 'r', encoding='utf-8') as f:
            return f.read()
    except FileNotFoundError:
        logger.error(f"System prompt file not found: {_PROMPT_PATH}")
        raise
    except Exception as e:
        logger.error(f"Error loading system prompt: {e}")
        raise

_SYSTEM_PROMPT = _load_system_prompt()

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _strip_code_fences(s: str) -> str:
    s = s.strip()
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*", "", s, flags=re.I)
        s = re.sub(r"\s*```$", "", s)
    return s.strip()


def _first_balanced_json(s: str) -> Optional[str]:
    s = _strip_code_fences(s)
    start = s.find("{")
    if start == -1:
        return None
    depth = 0
    for i in range(start, len(s)):
        ch = s[i]
        if ch == "{": depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return s[start:i+1]
    return None


def _robust_json_load(raw: str, retries: int = 2) -> Dict[str, Any]:
    """Backwards-compatible wrapper; delegates to parse_llm_json."""
    del retries  # repair passes are handled inside parse_llm_json
    return parse_llm_json(raw)


# ---------------------------------------------------------------------------
# Model loading
# ---------------------------------------------------------------------------

def _ensure_loaded():
    global _tokenizer, _model

    if _tokenizer is not None and _model is not None:
        return

    logger.info(f"Loading LLM model: {MODEL_ID} (from env: LOCAL_MODEL_ID)")
    logger.info(f"Using cache directory: {CACHE_DIR}")

    # Ensure cache directory exists
    os.makedirs(CACHE_DIR, exist_ok=True)

    # Get HF token if available
    hf_token = os.getenv("HF_TOKEN")
    
    # Load tokenizer
    logger.info(f"Loading tokenizer for {MODEL_ID}...")
    _tokenizer = AutoTokenizer.from_pretrained(
        MODEL_ID, 
        trust_remote_code=True,
        cache_dir=CACHE_DIR,
        token=hf_token
    )

    # Device/dtype selection
    force_cpu = os.getenv("FORCE_CPU", "false").lower() in ("true", "1", "yes")
    
    if force_cpu:
        device_map = "cpu"
        dtype = torch.float32
    elif torch.cuda.is_available():
        device_map = "auto"
        dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    elif torch.backends.mps.is_available():  # Apple Silicon
        device_map = {"": "mps"}
        dtype = torch.float16
    else:
        device_map = "cpu"
        dtype = torch.float32

    # Load model
    logger.info(f"Loading model {MODEL_ID} with device_map={device_map}, dtype={dtype}...")
    _model = AutoModelForCausalLM.from_pretrained(
        MODEL_ID,
        dtype=dtype,
        device_map=device_map,
        trust_remote_code=True,
        cache_dir=CACHE_DIR,
        token=hf_token
    )
    _model.eval()
    logger.info(f"Model {MODEL_ID} loaded successfully!")

    if _tokenizer.pad_token_id is None:
        _tokenizer.pad_token_id = _tokenizer.eos_token_id


# ---------------------------------------------------------------------------
# Prompt + generation helpers
# ---------------------------------------------------------------------------

def _apply_chat_template(
    user_content: str,
    system_prompt: Optional[str] = None,
) -> Dict[str, Any]:
    assert _tokenizer is not None
    prompt = (system_prompt or _SYSTEM_PROMPT).strip()

    if hasattr(_tokenizer, "apply_chat_template"):
        messages = [
            {"role": "system", "content": prompt},
            {"role": "user", "content": user_content.strip()},
        ]
        text = _tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=True,
        )
        inputs = _tokenizer(text, return_tensors="pt")
    else:
        prompt_text = (
            prompt
            + "\n\n" + user_content.strip()
            + "\n\nReturn ONLY JSON now:"
        )
        inputs = _tokenizer(prompt_text, return_tensors="pt")

    # move to device
    dev = next(_model.parameters()).device
    return {k: v.to(dev) for k, v in inputs.items()}


def _render_user_block(
    input_text: str,
    schema_json: dict,
    *,
    title: str = "",
    url: str = "",
    chunk_index: Optional[int] = None,
    chunk_count: Optional[int] = None,
    global_offset: Optional[int] = None,
) -> str:

    schema_str = json.dumps(schema_json, ensure_ascii=False)

    meta_lines = []
    if title: meta_lines.append(f"Title: {title}")
    if url: meta_lines.append(f"URL: {url}")
    if chunk_index is not None:
        meta_lines.append(
            f"CHUNK: {chunk_index} of {chunk_count} (GLOBAL_OFFSET={global_offset or 0})"
        )

    meta_block = "\n".join(meta_lines) or "(none)"

    return (
        "SCHEMA (JSON):\n" + schema_str
        + "\n\nOPTIONAL CONTEXT:\n" + meta_block
        + "\n\nINPUT (length " + str(len(input_text)) + " chars):\n"
        + input_text
        + "\n\nRESPONSE: (ONLY the JSON object)"
    )


# ---------------------------------------------------------------------------
# PUBLIC API — called by extract_utils
# ---------------------------------------------------------------------------

def generate_json(
    input_text: str,
    schema_json: dict,
    max_new_tokens: int = 1536,  # Increased for analysis output (was 512)
    *,
    title: str = "",
    url: str = "",
    chunk_index: Optional[int] = None,
    chunk_count: Optional[int] = None,
    global_offset: Optional[int] = None,
    system_prompt_override: Optional[str] = None,
    **kwargs,
) -> dict:
    """Inference wrapper used by extract_utils + chunking pipeline."""
    del kwargs

    _ensure_loaded()

    system_prompt = system_prompt_override
    if not system_prompt:
        try:
            from app.utils.prompt_loader import get_active_prompt

            system_prompt = get_active_prompt()
        except Exception:
            system_prompt = _SYSTEM_PROMPT

    user_block = _render_user_block(
        input_text,
        schema_json,
        title=title,
        url=url,
        chunk_index=chunk_index,
        chunk_count=chunk_count,
        global_offset=global_offset,
    )

    inputs = _apply_chat_template(user_block, system_prompt=system_prompt)

    gen_params = dict(
        max_new_tokens=max_new_tokens,
        do_sample=True,  # Enable sampling for better variety
        temperature=0.3,  # Low temperature for more focused output
        top_p=0.9,       # Nucleus sampling
        use_cache=True,
        pad_token_id=_tokenizer.pad_token_id,
        eos_token_id=_tokenizer.eos_token_id,
        num_beams=1,
    )

    with torch.inference_mode():
        out_ids = _model.generate(**inputs, **gen_params)

    # remove prompt prefix
    input_len = inputs["input_ids"].shape[1]
    gen_only = out_ids[0][input_len:]
    try:
        from app.extraction.metrics import add_generated_tokens

        add_generated_tokens(int(gen_only.numel()))
    except Exception:
        # print("RAW LLM JSON TEXT from URL",decoded)
        pass
    decoded = _tokenizer.decode(gen_only, skip_special_tokens=True)

    try:
        obj = _robust_json_load(decoded)
        logger.info(f"✓ LLM generated valid JSON with domains: {obj.get('risk', {}).get('domains', 'N/A')}")
    except (ValueError, json.JSONDecodeError) as e:
        # If JSON parsing fails completely, create a minimal valid object with new schema
        logger.error(f"❌ JSON parsing failed: {e}")
        logger.error(f"Raw LLM output (first 500 chars): {decoded[:500]}")
        from datetime import datetime
        obj = {
            "risk": {
                "risk_title": "Failed Risk Extraction",
                "domains": "7. AI System Safety, Failures, & Limitations",
                "description": decoded[:200] if decoded else "Failed to extract risk from input",
                "technical_description": "LLM extraction failed, manual review required",
                "executive_summary": "Risk extraction process encountered an error",
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
                "why": "Automated extraction failed, human review needed",
                "score": 0.1
            }]
        }

    # normalize + repair
    return repair_extraction_obj(obj, input_text, schema_json)