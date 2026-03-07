import asyncio
import json
import re
from typing import Any, Dict, List

import httpx

from .backboard import (
    backboard_save,
    backboard_get_history,
    backboard_find_global_law_context,
)
from .llm import analyst_llm, call_llm

# Global in-process cache; actual persistence is via Backboard.
_GLOBAL_LAW_CONTEXT: str | None = None


ANALYST_PROMPT = """You are a senior legal analyst specializing in Canadian contract law.

Analyze each clause below from a {document_type} called "{document_name}".
Use the Canadian law reference provided to inform your analysis.

For EVERY clause return a JSON object with ALL these fields:
- "id", "type", "raw_text", "location" — copy exactly from input
- "severity": "LOW", "MEDIUM", or "HIGH"
    HIGH = significant risk or likely unenforceable / violates Canadian law
    MEDIUM = unusual, more restrictive than Canadian standard, worth negotiating
    LOW = normal, standard clause in Canadian contracts
- "severity_reason": 1-2 plain-English sentences explaining the score
- "plain_english": what this clause actually means for the person signing (no jargon)
- "canadian_law": which Canadian law or legal principle applies to this clause
- "baseline_comparison": is this normal for Canadian contracts?
- "negotiation_tip": specific advice on what to push back on under Canadian law

{canadian_law}

Output ONLY a valid JSON array — one object per clause. No markdown.

Clauses to analyze:
{clauses_json}"""


CANLII_SEARCH_TERMS = {
    "Non-Compete": "non-compete restrictive covenant employment",
    "IP Assignment": "intellectual property assignment copyright employment",
    "Data & Privacy": "PIPEDA personal information protection privacy",
    "Arbitration": "arbitration mandatory binding employment",
    "Liability Waiver": "liability waiver negligence release",
    "Termination for Cause": "termination cause employment Canada Labour Code",
    "Indemnification": "indemnification indemnity contract",
    "Auto-Renewal": "automatic renewal consumer protection",
    "Photo & Media Rights": "likeness commercial use copyright publicity",
    "Confidentiality / NDA": "confidentiality non-disclosure agreement",
    "Amendment / Unilateral Change": "unilateral contract amendment consumer protection",
    "Governing Law": "choice of law governing jurisdiction",
    "Payment Terms": "payment terms commercial contract",
    "Limitation of Liability": "limitation liability clause enforceability",
    "Warranty Disclaimer": "warranty disclaimer consumer protection",
    "Force Majeure": "force majeure frustrated contract Canada",
}


async def scrape_canlii(clause_type: str) -> str:
    """Search CanLII public site for relevant Canadian law. No API key needed."""
    keywords = CANLII_SEARCH_TERMS.get(clause_type, "")
    if not keywords:
        return ""
    try:
        async with httpx.AsyncClient(timeout=8, follow_redirects=True) as client:
            res = await client.get(
                "https://www.canlii.org/en/",
                params={"text": keywords, "type": "legislation"},
                headers={"User-Agent": "Mozilla/5.0 (compatible; LegalLens/1.0)"},
            )
            if res.status_code == 200:
                import re as _re

                matches = _re.findall(
                    r'<span class="title"[^>]*>([^<]{10,100})</span>', res.text
                )
                if matches:
                    return f"CanLII: {matches[0].strip()} (canlii.org)"
    except Exception as e:
        print(f"  CanLII scrape failed for {clause_type}: {e}")
    return ""


async def get_live_canadian_law(
    clauses: List[Dict[str, Any]],
    thread_id: str,
) -> str:
    """
    Canadian law context for analysis (same global thread as other agents).
    Reads from current thread or backboard_find_global_law_context; if missing,
    scrapes CanLII and persists LAW_CONTEXT to Backboard for all agents to use.
    """
    global _GLOBAL_LAW_CONTEXT

    # 1) In-process cache (fast path)
    if _GLOBAL_LAW_CONTEXT:
        return _GLOBAL_LAW_CONTEXT

    # 2) Check current thread's history (if any) for LAW_CONTEXT
    if thread_id:
        try:
            history = await backboard_get_history(thread_id)
            for msg in reversed(history):
                content = msg.get("content", "")
                if isinstance(content, str) and content.startswith("LAW_CONTEXT:"):
                    cached = content[len("LAW_CONTEXT:") :].lstrip()
                    _GLOBAL_LAW_CONTEXT = cached
                    return cached
        except Exception as e:
            print(f"  -> Backboard law context lookup (thread) failed: {e}")

    # 3) Global Backboard scan: any LAW_CONTEXT across assistant threads
    try:
        global_ctx = await backboard_find_global_law_context()
        if global_ctx:
            _GLOBAL_LAW_CONTEXT = global_ctx
            return global_ctx
    except Exception as e:
        print(f"  -> Backboard global law context scan failed: {e}")

    unique_types = list(set(c["type"] for c in clauses))
    live_refs = []
    print(f"  -> Querying CanLII for {len(unique_types)} clause types...")
    for clause_type in unique_types:
        result = await scrape_canlii(clause_type)
        if result:
            live_refs.append(f"- {clause_type}: {result}")
        await asyncio.sleep(0.3)
    if live_refs:
        context = "LIVE CANLII REFERENCES (from canlii.org):\n" + "\n".join(live_refs)
    else:
        context = (
            "No live CanLII results found. Use your training knowledge of Canadian law "
            "to analyze these clauses."
        )

    # Persist the context into Backboard so future processes can recover it
    _GLOBAL_LAW_CONTEXT = context
    if thread_id:
        try:
            await backboard_save(thread_id, "assistant", f"LAW_CONTEXT: {context}")
        except Exception as e:
            print(f"  -> Backboard law context save failed: {e}")

    return context


async def run_analyst(
    clauses: List[Dict[str, Any]],
    document_name: str,
    document_type: str,
    thread_id: str,
) -> List[Dict[str, Any]]:
    print("Agent 2 (Analyst): Scoring risk against Canadian law...")
    if not clauses:
        return []

    canadian_law_context = await get_live_canadian_law(clauses, thread_id)

    all_analyzed: List[Dict[str, Any]] = []
    clause_index: Dict[str, Dict[str, Any]] = {
        c["id"]: c for c in clauses if isinstance(c, dict) and "id" in c
    }
    # Single analysis call over all clauses instead of batching.
    prompt = ANALYST_PROMPT.format(
        document_name=document_name,
        document_type=document_type,
        canadian_law=canadian_law_context,
        clauses_json=json.dumps(clauses, indent=2),
    )
    try:
        raw = await call_llm(analyst_llm(), prompt)
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw)
        required = [
            "id",
            "type",
            "raw_text",
            "location",
            "severity",
            "severity_reason",
            "plain_english",
            "canadian_law",
            "baseline_comparison",
            "negotiation_tip",
        ]
        for item in json.loads(raw):
            if not all(k in item for k in required):
                continue
            merged: Dict[str, Any] = {k: item[k] for k in required}

            # Carry through source-text location info from extractor so the
            # frontend can highlight issues directly on the original PDF.
            original = clause_index.get(merged["id"])
            if isinstance(original, dict):
                for extra_key in ("line_start", "line_end", "char_start", "char_end"):
                    if extra_key in original and extra_key not in merged:
                        merged[extra_key] = original[extra_key]

            all_analyzed.append(merged)
    except Exception as e:
        print(f"  -> Analyst error: {e}")
        for clause in clauses:
            all_analyzed.append(
                {
                    **clause,
                    "severity": "UNKNOWN",
                    "severity_reason": "Analysis failed for this clause.",
                    "plain_english": "N/A",
                    "canadian_law": "N/A",
                    "baseline_comparison": "N/A",
                    "negotiation_tip": "N/A",
                }
            )

    all_analyzed.sort(
        key=lambda c: {"HIGH": 0, "MEDIUM": 1, "LOW": 2}.get(c.get("severity", ""), 3)
    )

    high = sum(1 for c in all_analyzed if c["severity"] == "HIGH")
    med = sum(1 for c in all_analyzed if c["severity"] == "MEDIUM")
    low = sum(1 for c in all_analyzed if c["severity"] == "LOW")
    print(f"  -> HIGH: {high}  MEDIUM: {med}  LOW: {low}")

    await backboard_save(
        thread_id,
        "assistant",
        f"ANALYST: Scored {len(all_analyzed)} clauses.\n{json.dumps(all_analyzed)}",
    )
    return all_analyzed

