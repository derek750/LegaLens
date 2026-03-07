import json
import re
from typing import Any, Dict, List

from .backboard import backboard_get_history, backboard_save
from .llm import summarizer_llm, call_llm


SUMMARIZER_PROMPT = """You are a legal document summarizer writing for non-lawyers in Canada.

Document: "{document_name}" ({document_type})
Clauses: {total} total — HIGH: {high}, MEDIUM: {med}, LOW: {low}

Analyzed clauses:
{clauses_json}

Output a JSON object with EXACTLY these fields:
- "executive_summary": 3-5 plain-English sentences. What is this document,
  what does it govern, and what should a Canadian signing it know? No jargon.
- "top_risks": array of EXACTLY 3 strings each starting with severity.
  Example: "HIGH: Under the Canada Labour Code, this termination clause gives you fewer rights than the law requires."
- "bottom_line": one sentence verdict starting with one of:
  "Sign with caution —" / "Do not sign without a lawyer —" /
  "This is a fairly standard Canadian contract —" / "Seek legal advice before signing —"
- "overall_risk_score": "LOW", "MEDIUM", "HIGH", or "CRITICAL"

Be direct. Reference Canadian law where relevant. Raw JSON only."""


QA_PROMPT = """You are a Canadian legal document assistant.
Answer questions using ONLY the document excerpts provided.
Reference relevant Canadian law where applicable (PIPEDA, Canada Labour Code, etc.).
Plain English, 2-4 sentences. If the document doesn't address it, say so clearly.
Never invent information.

Document: {document_name}

{history}Excerpts:
{chunks}

Question: {question}"""


async def run_summarizer(
    analyzed_clauses: List[Dict[str, Any]],
    document_name: str,
    document_type: str,
    thread_id: str,
) -> Dict[str, Any]:
    print("Agent 3 (Summarizer): Writing summary...")
    high = sum(1 for c in analyzed_clauses if c.get("severity") == "HIGH")
    med = sum(1 for c in analyzed_clauses if c.get("severity") == "MEDIUM")
    low = sum(1 for c in analyzed_clauses if c.get("severity") == "LOW")

    if not analyzed_clauses:
        return {
            "executive_summary": "No clauses could be extracted from this document.",
            "top_risks": ["Unable to analyze — no clauses found."],
            "bottom_line": "Sign with caution — document could not be fully analyzed.",
            "overall_risk_score": "MEDIUM",
        }

    prompt = SUMMARIZER_PROMPT.format(
        document_name=document_name,
        document_type=document_type,
        total=len(analyzed_clauses),
        high=high,
        med=med,
        low=low,
        clauses_json=json.dumps(analyzed_clauses, indent=2)[:20000],
    )
    try:
        raw = await call_llm(summarizer_llm(), prompt)
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw)
        data = json.loads(raw)
        print(f"  -> Overall risk: {data.get('overall_risk_score')}")
        await backboard_save(thread_id, "assistant", f"SUMMARY: {json.dumps(data)}")
        return data
    except Exception as e:
        print(f"  -> Summarizer error: {e}")
        return {
            "executive_summary": "Summary generation failed — review clauses manually.",
            "top_risks": [
                f"HIGH: {c['type']} — {c.get('severity_reason','')}"
                for c in analyzed_clauses[:3]
                if c.get("severity") == "HIGH"
            ]
            or ["Review clauses manually."],
            "bottom_line": "Sign with caution — automated summary failed.",
            "overall_risk_score": "HIGH" if high > 0 else "MEDIUM",
        }


async def run_qa(
    document_name: str,
    question: str,
    chunks: List[str],
    thread_id: str,
) -> str:
    print("Agent 3 (Q&A): Answering question...")
    if not chunks:
        return "No relevant sections found. Try rephrasing your question."

    history_str = ""
    history = await backboard_get_history(thread_id)
    past_qa = [m["content"] for m in history if m.get("content", "").startswith("Q&A")]
    if past_qa:
        history_str = (
            "Previous questions about this document:\n"
            + "\n".join(past_qa[-3:])
            + "\n\n"
        )

    prompt = QA_PROMPT.format(
        document_name=document_name,
        history=history_str,
        chunks="\n\n---\n\n".join(chunks)[:8000],
        question=question,
    )
    try:
        answer = await call_llm(summarizer_llm(), prompt)
        await backboard_save(thread_id, "user", f"Q&A — Question: {question}")
        await backboard_save(thread_id, "assistant", f"Q&A — Answer: {answer}")
        return answer
    except Exception as e:
        return f"Error answering question: {e}"

