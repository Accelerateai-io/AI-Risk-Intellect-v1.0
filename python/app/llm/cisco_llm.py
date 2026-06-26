"""
HuggingFace Serverless Inference client for Foundation-Sec-8B (Cisco model).
Uses HuggingFace Serverless Inference API.
"""

import json
import logging
import os
import re
from typing import Optional
from huggingface_hub import InferenceClient

logger = logging.getLogger("airisk")


class CiscoLLM:
    """HuggingFace Serverless Inference client for Cisco Foundation-Sec-8B model"""
    
    def __init__(self, api_token: str):
        self.client = InferenceClient(api_key=api_token, bill_to="Accelerate-AI")
        self.model = "fdtn-ai/Foundation-Sec-8B"
        
        logger.info(f"✅ Initialized Cisco LLM client")
        logger.info(f"   Model: {self.model}")
        logger.info(f"   Provider: HuggingFace Serverless")
        
        logger.info(f"✅ Initialized Cisco LLM client")
        logger.info(f"   Model: {self.model}")
        logger.info(f"   Provider: HuggingFace Serverless")
    
    def generate_json(
        self,
        input_text: str,
        schema_json: dict,
        max_new_tokens: int = 8192,  # Increased from 4096
        **kwargs
    ) -> dict:
        """
        Generate JSON output from the Cisco model via HuggingFace endpoint.
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
        schema_str = json.dumps(schema_json, ensure_ascii=False)
        
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
        
        # Build full user prompt with system prompt prepended
        full_prompt = _SYSTEM_PROMPT + "\n\n" + (
            "SCHEMA (JSON):\n" + schema_str
            + "\n\nOPTIONAL CONTEXT:\n" + meta_block
            + "\n\nINPUT (length " + str(len(input_text)) + " chars):\n"
            + input_text
            + "\n\nRESPONSE: (ONLY the JSON object)"
        )
        
        # Prepare payload for HuggingFace Inference API
        payload = {
            "inputs": full_prompt,
            "parameters": {
                "max_new_tokens": max_new_tokens,
                "temperature": 0.3,
                "top_p": 0.9,
                "do_sample": True,
                "return_full_text": False,
            }
        }
        
        try:
            # Call HuggingFace Serverless API
            import time
            start_time = time.time()
            
            generated_text = self.client.text_generation(
                full_prompt,
                model=self.model,
                max_new_tokens=max_new_tokens,
                temperature=0.3,
                top_p=0.9,
            )
            
            elapsed = time.time() - start_time
            logger.info(f"⏱️  HuggingFace call took {elapsed:.2f} seconds")
            
            # Strip reasoning traces (model outputs <think>...</think> tags)
            if '<think>' in generated_text:
                generated_text = re.sub(r'^.*?</think>\s*', '', generated_text, flags=re.DOTALL)
            
            if not generated_text or generated_text == '<|end_of_text|>':
                logger.error(f"❌ Model returned empty or EOS-only response")
                raise ValueError("Model returned empty response")
            
            # Parse JSON from generated text
            from app.llm.local_llm import _robust_json_load
            obj = _robust_json_load(generated_text)
            
            logger.info(f"✅ Cisco model generated valid JSON with domains: {obj.get('risk', {}).get('domains', 'N/A')}")
            
        except json.JSONDecodeError as e:
            logger.error(f"❌ JSON parsing failed: {e}")
            logger.error(f"Generated text (first 1000 chars):\n{generated_text[:1000]}")
            # Don't raise - let repair handle it
            obj = self._create_fallback_object(f"JSON parsing error: {e}")
            
        except Exception as e:
            logger.error(f"❌ HuggingFace API request failed: {e}")
            obj = self._create_fallback_object(f"API request error: {e}")
        
        # Repair and return
        from app.llm.repair import repair_extraction_obj
        return repair_extraction_obj(obj, input_text, schema_json)
    
    def _create_fallback_object(self, error_msg: str) -> dict:
        """Create a fallback object when extraction fails"""
        return {
            "risk": {
                "risk_title": "Cisco Model Extraction Failed",
                "domains": "7. AI System Safety, Failures, & Limitations",
                "description": error_msg[:200],
                "attack_vector": "Unknown",
                "observable_indicators": "Extraction failure",
                "data_to_identify_risk": "Manual review of source content required",
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
                "why": "Automated extraction failed, human review needed",
                "score": 0.1
            }],
            "analysis": {
                "risk_identified": "Extraction process failed",
                "article_context": f"Cisco model error occurred: {error_msg}",
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


# Global instance
_cisco_client: Optional[CiscoLLM] = None


def get_cisco_client() -> CiscoLLM:
    """Get or create Cisco client singleton"""
    global _cisco_client
    
    if _cisco_client is None:
        api_token = os.getenv("HF_TOKEN")
        
        if not api_token:
            raise ValueError(
                "HF_TOKEN not set in environment. "
                "Get token from: https://huggingface.co/settings/tokens"
            )
        
        _cisco_client = CiscoLLM(api_token=api_token)
    
    return _cisco_client


def generate_json(
    input_text: str,
    schema_json: dict,
    max_new_tokens: int = 4096,
    **kwargs
) -> dict:
    """
    Convenience function that matches local_llm.generate_json() signature.
    """
    client = get_cisco_client()
    return client.generate_json(
        input_text,
        schema_json,
        max_new_tokens=max_new_tokens,
        **kwargs
    )
