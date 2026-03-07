"""
LegalLens — Agent 2: The Analyst
Responsibility: Score and explain each clause; compare to baselines; negotiation tips.
"""

import json
import re
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import SystemMessage, HumanMessage

from app.agents.state import AgentState, Clause, AnalyzedClause


BASELINE_KNOWLEDGE = """
INDUSTRY BASELINES FOR COMMON CLAUSES:
- Non-Compete: Standard is 6-12 months, limited geographic scope. Anything over 2 years or nationwide is aggressive.
- IP Assignment: Standard assigns work done ON company time WITH company resources. Assigning ALL inventions including personal projects is predatory.
- Arbitration: Standard includes right to appeal and neutral arbitrator selection. Mandatory binding arbitration with no class action waiver is aggressive.
- Liability Waiver: Standard limits liability for ordinary negligence. Waiving gross negligence or intentional misconduct is unusual and risky.
- Auto-Renewal: Standard requires 30-day notice to cancel. Under 7 days notice is aggressive.
- Data & Privacy: Standard limits data sharing to service providers. Selling data to third parties or indefinite retention is a red flag.
- Termination for Cause: Standard requires notice and cure period. Immediate termination for minor infractions is aggressive.
- Indemnification: Standard is mutual (both parties indemnify each other). One-sided indemnification strongly favoring the other party is a red flag.
- Photo & Media Rights: Standard requires explicit consent per use. Blanket lifetime commercial rights with no compensation is aggressive.
"""

ANALYST_SYSTEM_PROMPT = """You are a senior legal analyst specializing in contract review.

You will receive a list of extracted legal clauses. For EACH clause, you must:
1. Assign a severity score: "LOW", "MEDIUM", or "HIGH"
2. Explain in 1-2 sentences WHY you assigned that severity (plain English, no jargon)
3. Translate the clause into plain English (what does it actually mean for the person signing?)
4. Compare it to the industry baseline (is this clause normal, aggressive, or unusually favorable?)
5. Give a specific negotiation tip (what could they push back on and exactly how?)

Use this baseline knowledge to inform your comparison:
{baseline_knowledge}

Severity scoring guide:
- HIGH: Could cause significant financial harm, loss of rights, or legal liability.
- MEDIUM: Unusual or more restrictive than standard, but not immediately dangerous.
- LOW: Normal, standard clause. May still be worth knowing about but poses minimal risk.

Output ONLY a valid JSON array. Each object must have ALL of these fields:
- "id", "type", "raw_text", "location" (preserve from input)
- "severity": "LOW", "MEDIUM", or "HIGH"
- "severity_reason", "plain_english", "baseline_comparison", "negotiation_tip"

No preamble, no explanation, no markdown fences. Raw JSON array only.
"""

ANALYST_USER_PROMPT = """Analyze the following {count} clauses extracted from a {document_type} called "{document_name}".

CLAUSES TO ANALYZE:
{clauses_json}

Return a JSON array with one analyzed object per clause. Preserve all original fields and add the analysis fields.
"""


def analyst_agent(state: AgentState) -> AgentState:
    """
    Agent 2: Analyzes every extracted clause for risk and meaning.
    Reads: clauses, document_name, document_type
    Writes: analyzed_clauses
    """
    clauses = state.get("clauses", [])
    print(f"[Analyst] Analyzing {len(clauses)} clauses (risk + baseline + tips)...")
    if not clauses:
        return {
            **state,
            "analyzed_clauses": [],
            "current_agent": "analyst",
            "errors": state.get("errors", []) + ["Analyst: no clauses to analyze"],
        }

    llm = ChatGoogleGenerativeAI(
        model="gemini-2.0-flash",
        temperature=0.2,
        max_tokens=8192,
    )

    BATCH_SIZE = 8
    all_analyzed: list[AnalyzedClause] = []

    for i in range(0, len(clauses), BATCH_SIZE):
        batch = clauses[i : i + BATCH_SIZE]
        system_prompt = ANALYST_SYSTEM_PROMPT.format(
            baseline_knowledge=BASELINE_KNOWLEDGE
        )
        user_prompt = ANALYST_USER_PROMPT.format(
            count=len(batch),
            document_type=state["document_type"],
            document_name=state["document_name"],
            clauses_json=json.dumps(batch, indent=2),
        )

        try:
            response = llm.invoke([
                SystemMessage(content=system_prompt),
                HumanMessage(content=user_prompt),
            ])

            raw_output = response.content.strip()
            raw_output = re.sub(r"^```(?:json)?\s*", "", raw_output)
            raw_output = re.sub(r"\s*```$", "", raw_output)
            analyzed_batch = json.loads(raw_output)

            for item in analyzed_batch:
                required_fields = [
                    "id", "type", "raw_text", "location",
                    "severity", "severity_reason", "plain_english",
                    "baseline_comparison", "negotiation_tip"
                ]
                if not all(k in item for k in required_fields):
                    continue
                all_analyzed.append(AnalyzedClause(
                    id=item["id"],
                    type=item["type"],
                    raw_text=item["raw_text"],
                    location=item["location"],
                    severity=item["severity"].upper(),
                    severity_reason=item["severity_reason"],
                    plain_english=item["plain_english"],
                    baseline_comparison=item["baseline_comparison"],
                    negotiation_tip=item["negotiation_tip"],
                ))

        except json.JSONDecodeError as e:
            error_msg = f"Analyst JSON parse error: {e}"
            return {
                **state,
                "analyzed_clauses": all_analyzed,
                "current_agent": "analyst",
                "errors": state.get("errors", []) + [error_msg],
            }
        except Exception as e:
            error_msg = f"Analyst agent failed: {e}"
            return {
                **state,
                "analyzed_clauses": all_analyzed,
                "current_agent": "analyst",
                "errors": state.get("errors", []) + [error_msg],
            }

    severity_order = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}
    all_analyzed.sort(key=lambda c: severity_order.get(c["severity"], 3))

    high_c = sum(1 for c in all_analyzed if c["severity"] == "HIGH")
    med_c = sum(1 for c in all_analyzed if c["severity"] == "MEDIUM")
    low_c = sum(1 for c in all_analyzed if c["severity"] == "LOW")
    print(f"[Analyst] Done. HIGH: {high_c}  MEDIUM: {med_c}  LOW: {low_c}")

    return {
        **state,
        "analyzed_clauses": all_analyzed,
        "current_agent": "analyst",
        "errors": state.get("errors", []),
    }
