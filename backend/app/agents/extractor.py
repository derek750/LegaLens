import json
import re
from typing import List, Dict, Any

from .backboard import backboard_save, backboard_get_global_law_context
from .llm import extractor_llm, call_llm


EXTRACTOR_PROMPT = """You are a legal clause extraction engine for Canadian contracts.

Canadian law context (use for relevance and clause types):
{canadian_law}

Read the document below and find every legal clause worth examining.
Output ONLY a valid JSON array. Each object must have exactly these fields:
- "id": unique string like "clause_001"
- "type": one of — Liability Waiver, IP Assignment, Non-Compete, Arbitration,
  Auto-Renewal, Data & Privacy, Termination for Cause, Indemnification,
  Force Majeure, Governing Law, Amendment / Unilateral Change, Photo & Media Rights,
  Confidentiality / NDA, Payment Terms, Limitation of Liability, Warranty Disclaimer
- "raw_text": EXACT verbatim text from the document (never paraphrase or shorten)
- "location": where it appears e.g. "Section 3", "Article IV", "Paragraph 2"

Rules:
- Extract ALL instances. Be thorough.
- If a clause type appears multiple times, extract each one separately.
- No explanation, no markdown fences. Raw JSON array only.

Document: {document_name} ({document_type})
--- START ---
{document_text}
--- END ---"""


def _compute_line_and_char_span(
    document_text: str, snippet: str
) -> Dict[str, int] | None:
    """
    Best-effort mapping of a clause's raw_text back to the original
    extracted document text so the frontend can highlight it.

    Returns a dict with:
    - line_start / line_end: 1-based line numbers within document_text
    - char_start / char_end: 0-based character offsets within document_text
    """
    if not snippet:
        return None

    char_start = document_text.find(snippet)
    if char_start == -1:
        return None

    char_end = char_start + len(snippet)
    line_start = document_text.count("\n", 0, char_start) + 1
    line_end = document_text.count("\n", 0, char_end) + 1

    return {
        "line_start": line_start,
        "line_end": line_end,
        "char_start": char_start,
        "char_end": char_end,
    }


async def run_extractor(
    document_text: str,
    document_name: str,
    document_type: str,
    thread_id: str,
) -> List[Dict[str, Any]]:
    print("Agent 1 (Extractor): Finding clauses...")
    canadian_law = await backboard_get_global_law_context(thread_id)
    prompt = EXTRACTOR_PROMPT.format(
        canadian_law=canadian_law,
        document_name=document_name,
        document_type=document_type,
        document_text=document_text[:50000],
    )
    try:
        raw = await call_llm(extractor_llm(), prompt)
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw)
        parsed = json.loads(raw)
        clauses: List[Dict[str, Any]] = []
        for c in parsed:
            if not all(k in c for k in ["id", "type", "raw_text", "location"]):
                continue
            clause: Dict[str, Any] = {
                "id": c["id"],
                "type": c["type"],
                "raw_text": c["raw_text"],
                "location": c["location"],
            }
            span = _compute_line_and_char_span(document_text, clause["raw_text"])
            if span:
                clause.update(span)
            clauses.append(clause)

        print(f"  -> Found {len(clauses)} clauses")
        await backboard_save(
            thread_id,
            "assistant",
            f"EXTRACTOR: Found {len(clauses)} clauses.\n{json.dumps(clauses)}",
        )
        return clauses
    except Exception as e:
        print(f"  -> Extractor error: {e}")
        return []

