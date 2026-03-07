# ═══════════════════════════════════════════════════════════════════════════════
# AGENT 4 — NEGOTIATOR
# Looks at every HIGH and MEDIUM clause from the Analyst's output and produces:
# 1. A rewritten version of the clause that's fair and reasonable
# 2. A negotiation script — what to actually say to the other party
# 3. A ranked list of what to fight for vs what to let go
# Uses its own Gemini key so it never touches the other agents' quotas.
# ═══════════════════════════════════════════════════════════════════════════════

def negotiator_llm():
    return ChatGoogleGenerativeAI(
        model="gemini-2.0-flash",
        temperature=0.4,   # slightly higher — negotiation language needs to feel natural
        max_tokens=8192,
        google_api_key=os.environ["GEMINI_KEY_NEGOTIATOR"],
    )

NEGOTIATOR_PROMPT = """You are an expert Canadian contract negotiator. You help everyday
people push back on unfair contract clauses in plain, confident language.

You will receive a list of HIGH and MEDIUM severity clauses from a {document_type}
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
  MUST FIGHT = clause is severely one-sided or potentially unenforceable in Canada
  SHOULD PUSH BACK = unusual but negotiable
  ACCEPT IF NEEDED = not ideal but common in Canadian contracts
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

    # Only negotiate HIGH and MEDIUM clauses — no point negotiating LOW risk ones
    clauses_to_negotiate = [
        c for c in analyzed_clauses
        if c.get("severity") in ("HIGH", "MEDIUM")
    ]

    if not clauses_to_negotiate:
        print("  -> No HIGH/MEDIUM clauses to negotiate.")
        return []

    print(f"  -> Negotiating {len(clauses_to_negotiate)} clauses "
          f"({sum(1 for c in clauses_to_negotiate if c['severity']=='HIGH')} HIGH, "
          f"{sum(1 for c in clauses_to_negotiate if c['severity']=='MEDIUM')} MEDIUM)")

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
            required = ["id","type","severity","original_text","rewritten_clause",
                        "negotiation_script","priority","leverage","fallback_position"]
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

    must_fight   = sum(1 for c in all_negotiations if c["priority"] == "MUST FIGHT")
    should_push  = sum(1 for c in all_negotiations if c["priority"] == "SHOULD PUSH BACK")
    print(f"  -> MUST FIGHT: {must_fight}  SHOULD PUSH BACK: {should_push}")

    # Save to Backboard so negotiation history is persistent
    await backboard_save(thread_id, "assistant",
        f"NEGOTIATOR: Strategy for {len(all_negotiations)} clauses.\n{json.dumps(all_negotiations)}")

    return all_negotiations

@app.get("/negotiate/{session_id}")
async def negotiate(session_id: str):
    """
    Returns a full negotiation strategy for every HIGH and MEDIUM clause.
    Each clause gets: rewritten version, negotiation script, priority,
    leverage points, and a fallback position.

    Call this after /analyze/{session_id} completes.
    """
    if session_id not in result_store:
        raise HTTPException(404, "No analysis found. Run /analyze first.")

    result    = result_store[session_id]
    thread_id = thread_store.get(session_id, "")

    negotiations = await run_negotiator(
        result["analyzed_clauses"],
        result["document_name"],
        result["document_type"],
        thread_id,
    )

    return {
        "session_id":     session_id,
        "document_name":  result["document_name"],
        "must_fight":     [n for n in negotiations if n["priority"] == "MUST FIGHT"],
        "should_push":    [n for n in negotiations if n["priority"] == "SHOULD PUSH BACK"],
        "accept_if_needed": [n for n in negotiations if n["priority"] == "ACCEPT IF NEEDED"],
        "total":          len(negotiations),
    }