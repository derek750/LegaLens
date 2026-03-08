# ═══════════════════════════════════════════════════════════════════════════════
# AGENT 4 — NEGOTIATOR
# Looks at every HIGH clause from the Analyst's output and produces:
# 1. A rewritten version of the clause that's fair and reasonable
# 2. A negotiation script — what to actually say to the other party
# 3. A ranked list of what to fight for vs what to let go
# ═══════════════════════════════════════════════════════════════════════════════

import asyncio
import json
import os
import re

from langchain_google_genai import ChatGoogleGenerativeAI

from app.agents.backboard import backboard_save
from app.agents.llm import call_llm


def negotiator_llm():
    return ChatGoogleGenerativeAI(
        model="gemini-2.5-flash",
        temperature=0.4,   # slightly higher — negotiation language needs to feel natural
        max_tokens=8192,
        google_api_key=os.environ["GEMINI_API_KEY"],
    )


NEGOTIATOR_PROMPT = """You are an expert Canadian contract negotiator. You help everyday
people push back on unfair contract clauses in plain, confident language.

You will receive a list of HIGH severity clauses from a {document_type}
called "{document_name}". For each clause, produce a negotiation package.

Output ONLY a valid JSON array. Each object must have ALL these fields:
- "id": same id as input clause
- "type": same type as input
- "severity": same severity as input
- "original_text": the original raw_text (copy exactly)
- "rewritten_clause": a fair, plain-English rewrite of this clause that protects
  the signer. Should be something they could realistically propose as an alternative.
- "negotiation_script": exactly what to say to the other party. Write it as a
  short spoken script — confident but not aggressive. 2-4 sentences.
  Example: "I noticed Section 4 assigns all intellectual property including work
  done on my own time. I'd like to limit this to work done using company resources
  during work hours. This is standard practice and I'm happy to provide examples."
- "priority": "MUST FIGHT", "SHOULD PUSH BACK", or "ACCEPT IF NEEDED"
  MUST FIGHT = clause is severely one-sided, potentially unenforceable, or violates Canadian law
  SHOULD PUSH BACK = clause is unfavorable and worth negotiating but not a dealbreaker
  ACCEPT IF NEEDED = clause is below standard but you can live with it if they won't budge
- "leverage": one sentence on what leverage the signer has e.g. "This clause is
  routinely struck down by Canadian courts — mentioning this gives you strong leverage."
- "fallback_position": if they won't budge on the full rewrite, what's the minimum
  acceptable change? One sentence.

This is general negotiation information — not legal advice.

Clauses to negotiate:
{clauses_json}"""


async def run_negotiator(
    analyzed_clauses: list[dict],
    document_name: str,
    document_type: str,
    thread_id: str,
) -> list[dict]:
    print("Agent 4 (Negotiator): Building negotiation strategy...")

    clauses_to_negotiate = [
        c for c in analyzed_clauses
        if c.get("severity") == "HIGH"
    ]

    if not clauses_to_negotiate:
        print("  -> No HIGH clauses to negotiate.")
        return []

    print(f"  -> Negotiating {len(clauses_to_negotiate)} HIGH clauses")

    all_negotiations = []
    BATCH = 4  # smaller batch — negotiation output is verbose

    for i in range(0, len(clauses_to_negotiate), BATCH):
        batch = clauses_to_negotiate[i:i + BATCH]
        print(f"  -> Batch {i//BATCH + 1}/{(len(clauses_to_negotiate) + BATCH - 1)//BATCH}")

        prompt = NEGOTIATOR_PROMPT.format(
            document_name=document_name,
            document_type=document_type,
            clauses_json=json.dumps(batch, indent=2),
        )

        try:
            raw = await call_llm(negotiator_llm(), prompt)
            raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw)
            required = ["id", "type", "severity", "original_text", "rewritten_clause",
                        "negotiation_script", "priority", "leverage", "fallback_position"]
            for item in json.loads(raw):
                if all(k in item for k in required):
                    all_negotiations.append({k: item[k] for k in required})
        except Exception as e:
            print(f"  -> Batch error: {e}")

        if i + BATCH < len(clauses_to_negotiate):
            await asyncio.sleep(2)

    # Sort: MUST FIGHT first, then SHOULD PUSH BACK, then ACCEPT IF NEEDED
    priority_order = {"MUST FIGHT": 0, "SHOULD PUSH BACK": 1, "ACCEPT IF NEEDED": 2}
    all_negotiations.sort(key=lambda c: priority_order.get(c.get("priority", ""), 3))

    must_fight = sum(1 for c in all_negotiations if c["priority"] == "MUST FIGHT")
    should_push = sum(1 for c in all_negotiations if c["priority"] == "SHOULD PUSH BACK")
    print(f"  -> MUST FIGHT: {must_fight}  SHOULD PUSH BACK: {should_push}")

    # Save to Backboard so negotiation history is persistent
    await backboard_save(thread_id, "assistant",
        f"NEGOTIATOR: Strategy for {len(all_negotiations)} clauses.\n{json.dumps(all_negotiations)}")

    return all_negotiations
