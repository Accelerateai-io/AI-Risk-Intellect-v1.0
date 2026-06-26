"""
OpenAI LLM client that matches the local_llm.py interface.
Provides access to GPT-5-mini and other OpenAI models.
"""

import json
import logging
import os
from typing import Optional
from openai import OpenAI

logger = logging.getLogger("airisk")


class OpenAILLM:
    """OpenAI client for LLM inference"""
    
    MODELS = {
        "gpt-5-mini": "gpt-5-mini",
    }
    
    def __init__(
        self,
        model_name: str = "gpt-5-mini",
        api_key: str = None
    ):
        self.model_id = self.MODELS.get(model_name, self.MODELS["gpt-5-mini"])
        self.client = OpenAI(api_key=api_key or os.getenv("OPENAI_API_KEY"))
        
        logger.info(f"✅ Initialized OpenAI LLM client")
        logger.info(f"   Model: {self.model_id}")
    
    def generate_json(
        self,
        input_text: str,
        schema_json: dict,
        max_new_tokens: int = 4096,
        **kwargs
    ) -> dict:
        """
        Generate JSON output from OpenAI model.
        Compatible with local_llm.generate_json() interface.
        """
        
        system_prompt_override = kwargs.get("system_prompt_override")
        if system_prompt_override:
            _SYSTEM_PROMPT = system_prompt_override
        else:
            try:
                from app.utils.prompt_loader import get_active_prompt

                _SYSTEM_PROMPT = get_active_prompt()
            except Exception:
                from app.llm.local_llm import _load_system_prompt

                _SYSTEM_PROMPT = _load_system_prompt()
        
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
        
        # Build full user prompt
        user_prompt = f"""METADATA:
{meta_block}

SCHEMA:
{schema_str}

ARTICLE TEXT:
{input_text}

Extract the AI risk information and return ONLY valid JSON matching the schema above."""
        
        try:
            # Call OpenAI
            response = self.client.chat.completions.create(
                model=self.model_id,
                messages=[
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt}
                ],
                max_completion_tokens=max_new_tokens,
                response_format={"type": "json_object"}
            )
            
            # Extract token usage
            usage = response.usage
            input_tokens = usage.prompt_tokens
            output_tokens = usage.completion_tokens
            try:
                from app.extraction.metrics import add_generated_tokens

                add_generated_tokens(int(output_tokens))
            except Exception:
                pass

            # Calculate cost (GPT-5-mini pricing)
            input_cost = (input_tokens / 1_000_000) * 0.15
            output_cost = (output_tokens / 1_000_000) * 0.60
            model_label = "GPT-5-mini"
            
            total_cost = input_cost + output_cost
            logger.info(f"💰 OpenAI ({model_label}): {input_tokens} in + {output_tokens} out = ${total_cost:.4f}")
            
            # Extract text from response
            generated_text = response.choices[0].message.content
            
            # Parse JSON from response
            obj = self._robust_json_load(generated_text)
            
            logger.info(f"✓ OpenAI generated valid JSON with domains: {obj.get('risk', {}).get('domains', 'N/A')}")
            
            # Import repair function to normalize and process analysis
            from app.llm.repair import repair_extraction_obj
            
            return repair_extraction_obj(obj, input_text, schema_json)
            
        except Exception as e:
            logger.error(f"❌ OpenAI generation failed: {e}")
            return self._create_fallback_object(input_text, str(e))
    
    def _robust_json_load(self, text: str) -> dict:
        """Attempt to extract JSON from text"""
        text = text.strip()
        
        # Remove markdown code fences if present
        if text.startswith("```"):
            lines = text.split("\n")
            lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            text = "\n".join(lines).strip()
        
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            # Try to find JSON object in text
            start = text.find("{")
            end = text.rfind("}") + 1
            if start >= 0 and end > start:
                return json.loads(text[start:end])
            raise
    
    def _create_fallback_object(self, input_text: str, error_msg: str) -> dict:
        """Create a minimal valid object when extraction fails"""
        return {
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
                "sector": "Private",
                "industry": "Technology & Software"
            },
            "controls": [{
                "control_ref": "ERR-001",
                "name": "Manual Review Required",
                "why": f"Automated extraction failed: {error_msg}",
                "score": 0.1
            }],
            "analysis": {
                "risk_identified": "Extraction process failed",
                "article_context": f"Error occurred: {error_msg}",
                "alignment_reasoning": "Manual review required to properly extract risk"
            },
            "justification": {
                "decision_rationale": "Extraction failed, using fallback object",
                "taxonomy_mapping": {
                    "domain_match": {
                        "chosen_domain": "7. AI System Safety, Failures, & Limitations",
                        "evidence_excerpts": [],
                        "keyword_matches": [],
                        "confidence_reasoning": "Fallback classification"
                    },
                    "primary_risk_match": {
                        "chosen_primary": "Technical Risks",
                        "evidence_excerpts": [],
                        "keyword_matches": [],
                        "confidence_reasoning": "Fallback classification"
                    },
                    "secondary_risk_match": {
                        "chosen_secondary": "Technical/Performance Risk",
                        "evidence_excerpts": [],
                        "keyword_matches": [],
                        "confidence_reasoning": "Fallback classification"
                    }
                },
                "evidence_breakdown": [],
                "self_assessment": {
                    "total_score": 0,
                    "confidence_level": "low"
                }
            }
        }


# Singleton instance
_openai_client: Optional[OpenAILLM] = None


def get_openai_client(
    model_name: str = None,
    api_key: str = None
) -> OpenAILLM:
    """Get or create singleton OpenAI client"""
    global _openai_client
    
    if _openai_client is None:
        model = model_name or os.getenv("OPENAI_MODEL", "gpt-5-mini")
        _openai_client = OpenAILLM(model_name=model, api_key=api_key)
    
    return _openai_client


def generate_json(
    input_text: str,
    schema_json: dict,
    max_new_tokens: int = 4096,
    **kwargs
) -> dict:
    """
    Module-level function matching local_llm.generate_json() interface.
    """
    client = get_openai_client()
    return client.generate_json(input_text, schema_json, max_new_tokens, **kwargs)
