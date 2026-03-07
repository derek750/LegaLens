import json
import re
from typing import Dict, Any

from .llm import extractor_llm, call_llm


VALIDATOR_PROMPT = """You are a document type classifier. Determine whether the text
below is a legal contract or legal document worth analyzing for clauses and obligations.

Respond with ONLY a JSON object with exactly these fields:
- "is_legal_document": true or false
- "confidence": "HIGH", "MEDIUM", or "LOW"
- "document_category": one of "Legal Contract", "Government Form", "Terms of Service",
  "Policy Document", "Not a Legal Document"
- "reason": one sentence explaining your decision
- "suggested_type": type of legal doc e.g. "Employment Contract", "NDA", "Lease Agreement".
  If not a legal document write "N/A"

IS a legal document: contracts, NDAs, leases, waivers, terms of service,
employment agreements, settlement agreements, privacy policies, liability releases.

NOT a legal document: receipts, invoices, essays, news articles, resumes, emails,
meeting notes, product manuals, school assignments, random text.

Text to classify (first 3000 characters):
{document_text}"""


async def run_validator(document_text: str) -> Dict[str, Any]:
    """Check if document is actually a legal contract before running the pipeline."""
    print("Agent 0 (Validator): Checking document relevance...")
    prompt = VALIDATOR_PROMPT.format(document_text=document_text[:3000])
    try:
        raw = await call_llm(extractor_llm(), prompt)
        raw = re.sub(r"^[`]{3}(?:json)?\s*|\s*[`]{3}$", "", raw)
        result = json.loads(raw)
        is_legal = result.get("is_legal_document", False)
        print(f"  -> is_legal: {is_legal} ({result.get('confidence')}) — {result.get('reason')}")
        return result
    except Exception as e:
        print(f"  -> Validator error: {e} — defaulting to allow")
        return {
            "is_legal_document": True,
            "confidence": "LOW",
            "document_category": "Unknown",
            "reason": "Validation failed — proceeding anyway.",
            "suggested_type": "Legal Contract",
        }

