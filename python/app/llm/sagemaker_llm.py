"""
SageMaker LLM client that matches the local_llm.py interface.
Uses same prompt format as cisco_llm for consistency.
"""

import json
import boto3
import logging
import os
from typing import Optional

logger = logging.getLogger("airisk")

class SageMakerLLM:
    """SageMaker endpoint client for LLM inference"""
    
    def __init__(
        self,
        endpoint_name: str,
        region_name: str = "us-east-1"
    ):
        self.endpoint_name = endpoint_name
        self.region_name = region_name
        
        # Configure boto3 with longer timeout
        from botocore.config import Config
        config = Config(
            read_timeout=300,
            connect_timeout=60,
            retries={'max_attempts': 0}
        )
        
        self.runtime = boto3.client(
            'sagemaker-runtime',
            region_name=region_name,
            config=config
        )
        
        logger.info(f"✅ Initialized SageMaker LLM client")
        logger.info(f"   Endpoint: {endpoint_name}")
        logger.info(f"   Region: {region_name}")
    
    def generate_json(
        self,
        input_text: str,
        schema_json: dict,
        max_new_tokens: int = 4096,
        **kwargs
    ) -> dict:
        """
        Generate JSON output from the SageMaker model.
        Uses same prompt format as cisco_llm.
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
        
        # Build the user prompt (same format as cisco_llm)
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
        
        # Build full user prompt with system prompt prepended (same as cisco_llm)
        full_prompt = _SYSTEM_PROMPT + "\n\n" + (
            "SCHEMA (JSON):\n" + schema_str
            + "\n\nOPTIONAL CONTEXT:\n" + meta_block
            + "\n\nINPUT (length " + str(len(input_text)) + " chars):\n"
            + input_text
            + "\n\nRESPONSE: (ONLY the JSON object)"
        )
        
        # Prepare payload for HuggingFace TGI format
        payload = {
            "inputs": full_prompt,
            "parameters": {
                "max_new_tokens": max_new_tokens,
                "temperature": 0.3,
                "top_p": 0.9,
                "do_sample": True,
            }
        }
        
        try:
            # Call SageMaker endpoint
            import time
            start_time = time.time()
            
            response = self.runtime.invoke_endpoint(
                EndpointName=self.endpoint_name,
                ContentType='application/json',
                Body=json.dumps(payload)
            )
            
            elapsed = time.time() - start_time
            logger.info(f"⏱️  SageMaker call took {elapsed:.2f} seconds")
            
            # Parse response
            raw_body = response['Body'].read().decode()
            result = json.loads(raw_body)
            
            # Extract generated text from HuggingFace TGI response format
            if isinstance(result, list) and len(result) > 0:
                generated_text = result[0].get('generated_text', '')
            elif isinstance(result, dict):
                generated_text = result.get('generated_text', '')
            else:
                generated_text = str(result)
            
            if not generated_text or generated_text == '<|end_of_text|>':
                logger.error(f"❌ Model returned empty or EOS-only response")
                raise ValueError("Model returned empty response")
            
            logger.info(f"📝 Generated text length: {len(generated_text)} chars")
            logger.info(f"📝 First 500 chars: {generated_text[:500]}")
            
            # Parse JSON from generated text
            from app.llm.local_llm import _robust_json_load
            try:
                obj = _robust_json_load(generated_text)
            except json.JSONDecodeError as e:
                logger.error(f"❌ JSON parsing failed: {e}")
                logger.error(f"Generated text (first 1000 chars):\n{generated_text[:1000]}")
                raise ValueError(f"Model did not return valid JSON: {e}")
            
            logger.info(f"✅ SageMaker generated valid JSON with domains: {obj.get('risk', {}).get('domains', 'N/A')}")
            
        except Exception as e:
            logger.error(f"❌ SageMaker inference failed: {e}")
            obj = self._create_fallback_object(f"SageMaker error: {e}")
        
        # Repair and return
        from app.llm.repair import repair_extraction_obj
        return repair_extraction_obj(obj, input_text, schema_json)
    
    def _create_fallback_object(self, error_msg: str) -> dict:
        """Create a fallback object when extraction fails"""
        return {
            "risk": {
                "risk_title": "SageMaker Extraction Failed",
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
                "article_context": f"SageMaker error occurred: {error_msg}",
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
_sagemaker_client: Optional[SageMakerLLM] = None


def get_sagemaker_client() -> SageMakerLLM:
    """Get or create SageMaker client singleton"""
    global _sagemaker_client
    
    if _sagemaker_client is None:
        endpoint_name = os.getenv("SAGEMAKER_ENDPOINT_NAME")
        region = os.getenv("AWS_REGION", "us-east-1")
        
        if not endpoint_name:
            raise ValueError(
                "SAGEMAKER_ENDPOINT_NAME not set in environment. "
                "Add to .env: SAGEMAKER_ENDPOINT_NAME=your-endpoint-name"
            )
        
        _sagemaker_client = SageMakerLLM(
            endpoint_name=endpoint_name,
            region_name=region
        )
    
    return _sagemaker_client


def generate_json(
    input_text: str,
    schema_json: dict,
    max_new_tokens: int = 4096,
    **kwargs
) -> dict:
    """
    Convenience function that matches local_llm.generate_json() signature.
    """
    client = get_sagemaker_client()
    return client.generate_json(
        input_text,
        schema_json,
        max_new_tokens=max_new_tokens,
        **kwargs
    )
