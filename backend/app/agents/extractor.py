"""
LegalLens — Agent 1: The Extractor
Responsibility: Read the raw document and identify every clause worth examining.
"""

import json
import re
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import SystemMessage, HumanMessage

from app.agents.state import AgentState, Clause


CLAUSE_TYPES = [
    "Liability Waiver",
    "IP Assignment",
    "Non-Compete",
    "Arbitration",
    "Auto-Renewal",
    "Data & Privacy",
    "Termination for Cause",
    "Indemnification",
    "Force Majeure",
    "Governing Law",
    "Amendment / Unilateral Change",
    "Photo & Media Rights",
    "Confidentiality / NDA",
    "Payment Terms",
    "Limitation of Liability",
    "Warranty Disclaimer",
]

EXTRACTOR_SYSTEM_PROMPT = """You are a legal document clause extraction engine.

Your ONLY job is to identify and extract legal clauses from the document provided.
Do NOT analyze, score, or judge clauses. Do NOT explain anything. Just find them.

For each clause you find, output a JSON object with these exact fields:
- "id": a unique string like "clause_001", "clause_002", etc.
- "type": the clause type from the provided list (pick the closest match)
- "raw_text": the EXACT verbatim text of the clause from the document (do not paraphrase)
- "location": where in the document this appears (e.g. "Section 3", "Paragraph 4", "Article II")

Known clause types to look for:
{clause_types}

Rules:
1. Extract ALL instances of these clause types you find. Be thorough.
2. If a clause spans multiple sentences, include the full relevant passage.
3. Keep raw_text verbatim from the document — do not modify or shorten it.
4. If a clause type appears multiple times, extract each occurrence separately.
5. If you cannot identify the location precisely, use "Unknown location".

Output ONLY a valid JSON array of clause objects. No preamble, no explanation, no markdown.
"""

EXTRACTOR_USER_PROMPT = """Here is the legal document to analyze:

DOCUMENT NAME: {document_name}
DOCUMENT TYPE: {document_type}

--- DOCUMENT START ---
{document_text}
--- DOCUMENT END ---

Extract all legal clauses from this document and return them as a JSON array.
"""


def extractor_agent(state: AgentState) -> AgentState:
    """
    Agent 1: Extracts all clauses from the document.
    Reads: document_text, document_name, document_type
    Writes: clauses
    """
    print("[Extractor] Scanning document for legal clauses...")
    llm = ChatGoogleGenerativeAI(
        model="gemini-2.0-flash",
        temperature=0.1,
        max_tokens=8192,
    )

    system_prompt = EXTRACTOR_SYSTEM_PROMPT.format(
        clause_types="\n".join(f"- {ct}" for ct in CLAUSE_TYPES)
    )

    user_prompt = EXTRACTOR_USER_PROMPT.format(
        document_name=state["document_name"],
        document_type=state["document_type"],
        document_text=state["document_text"][:50000],
    )

    try:
        response = llm.invoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt),
        ])

        raw_output = response.content.strip()
        raw_output = re.sub(r"^```(?:json)?\s*", "", raw_output)
        raw_output = re.sub(r"\s*```$", "", raw_output)

        clauses_raw = json.loads(raw_output)
        clauses: list[Clause] = []
        for item in clauses_raw:
            if not all(k in item for k in ["id", "type", "raw_text", "location"]):
                continue
            clauses.append(Clause(
                id=item["id"],
                type=item["type"],
                raw_text=item["raw_text"],
                location=item["location"],
            ))

        print(f"[Extractor] Found {len(clauses)} clauses.")
        return {
            **state,
            "clauses": clauses,
            "current_agent": "extractor",
            "errors": [],
        }

    except json.JSONDecodeError as e:
        error_msg = f"Extractor JSON parse error: {e}"
        return {
            **state,
            "clauses": [],
            "current_agent": "extractor",
            "errors": [error_msg],
        }
    except Exception as e:
        error_msg = f"Extractor agent failed: {e}"
        return {
            **state,
            "clauses": [],
            "current_agent": "extractor",
            "errors": [error_msg],
        }
