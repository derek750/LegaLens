import asyncio
import io
import json
import os
import re
import uuid
from typing import AsyncGenerator, Optional

import PyPDF2
import docx as python_docx
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_community.embeddings import FakeEmbeddings
from langchain_community.vectorstores import FAISS
from langchain_core.messages import HumanMessage
from langchain_google_genai import ChatGoogleGenerativeAI
from pydantic import BaseModel

load_dotenv()


# ═══════════════════════════════════════════════════════════════════════════════
# GEMINI — one LLM per agent, each with its own API key and its own rate limit
# ═══════════════════════════════════════════════════════════════════════════════

def extractor_llm():
    return ChatGoogleGenerativeAI(
        model="gemini-2.0-flash",
        temperature=0.1,
        max_tokens=8192,
        google_api_key=os.environ["GEMINI_KEY_EXTRACTOR"],
    )

def analyst_llm():
    return ChatGoogleGenerativeAI(
        model="gemini-2.0-flash",
        temperature=0.2,
        max_tokens=8192,
        google_api_key=os.environ["GEMINI_KEY_ANALYST"],
    )

def summarizer_llm():
    return ChatGoogleGenerativeAI(
        model="gemini-2.0-flash",
        temperature=0.3,
        max_tokens=2048,
        google_api_key=os.environ["GEMINI_KEY_SUMMARIZER"],
    )

async def call_llm(llm, prompt: str) -> str:
    response = llm.invoke([HumanMessage(content=prompt)])
    return response.content.strip()


# ═══════════════════════════════════════════════════════════════════════════════
# BACKBOARD — persistent memory across sessions
# Each upload creates a thread. Results are saved so they survive restarts.
# ═══════════════════════════════════════════════════════════════════════════════

BACKBOARD_BASE = "https://api.backboard.io/v1"

async def backboard_create_thread(document_name: str) -> str:
    try:
        async with httpx.AsyncClient() as client:
            res = await client.post(
                f"{BACKBOARD_BASE}/threads",
                headers={"Authorization": f"Bearer {os.environ['BACKBOARD_API_KEY']}"},
                json={"name": f"LegalLens: {document_name}"},
                timeout=10,
            )
            return res.json().get("thread_id", "")
    except Exception as e:
        print(f"Backboard thread creation failed (non-fatal): {e}")
        return ""

async def backboard_save(thread_id: str, role: str, content: str):
    if not thread_id:
        return
    try:
        async with httpx.AsyncClient() as client:
            await client.post(
                f"{BACKBOARD_BASE}/threads/{thread_id}/messages",
                headers={"Authorization": f"Bearer {os.environ['BACKBOARD_API_KEY']}"},
                json={"role": role, "content": content},
                timeout=10,
            )
    except Exception as e:
        print(f"Backboard save failed (non-fatal): {e}")

async def backboard_get_history(thread_id: str) -> list[dict]:
    if not thread_id:
        return []
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(
                f"{BACKBOARD_BASE}/threads/{thread_id}/messages",
                headers={"Authorization": f"Bearer {os.environ['BACKBOARD_API_KEY']}"},
                timeout=10,
            )
            return res.json().get("messages", [])
    except Exception as e:
        print(f"Backboard history fetch failed (non-fatal): {e}")
        return []



# ═══════════════════════════════════════════════════════════════════════════════
# AGENT 0 — VALIDATOR
# Runs before everything else. Checks if the uploaded document is actually
# a legal contract worth analyzing. Rejects receipts, essays, images, etc.
# ═══════════════════════════════════════════════════════════════════════════════

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

async def run_validator(document_text: str) -> dict:
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

# ═══════════════════════════════════════════════════════════════════════════════
# AGENT 1 — EXTRACTOR
# Reads raw document text, outputs a structured list of clauses.
# ═══════════════════════════════════════════════════════════════════════════════

EXTRACTOR_PROMPT = """You are a legal clause extraction engine for Canadian contracts.

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

async def run_extractor(
    document_text: str,
    document_name: str,
    document_type: str,
    thread_id: str,
) -> list[dict]:
    print("Agent 1 (Extractor): Finding clauses...")
    prompt = EXTRACTOR_PROMPT.format(
        document_name=document_name,
        document_type=document_type,
        document_text=document_text[:50000],
    )
    try:
        raw = await call_llm(extractor_llm(), prompt)
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw)
        clauses = [
            {"id": c["id"], "type": c["type"], "raw_text": c["raw_text"], "location": c["location"]}
            for c in json.loads(raw)
            if all(k in c for k in ["id", "type", "raw_text", "location"])
        ]
        print(f"  -> Found {len(clauses)} clauses")
        await backboard_save(thread_id, "assistant", f"EXTRACTOR: Found {len(clauses)} clauses.\n{json.dumps(clauses)}")
        return clauses
    except Exception as e:
        print(f"  -> Extractor error: {e}")
        return []


# ═══════════════════════════════════════════════════════════════════════════════
# AGENT 2 — ANALYST
# Scores every clause for risk using hardcoded Canadian law knowledge.
# ═══════════════════════════════════════════════════════════════════════════════

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

# ── CanLII live scraper (no API key needed) ──────────────────────────────────

CANLII_SEARCH_TERMS = {
    "Non-Compete":                   "non-compete restrictive covenant employment",
    "IP Assignment":                 "intellectual property assignment copyright employment",
    "Data & Privacy":                "PIPEDA personal information protection privacy",
    "Arbitration":                   "arbitration mandatory binding employment",
    "Liability Waiver":              "liability waiver negligence release",
    "Termination for Cause":         "termination cause employment Canada Labour Code",
    "Indemnification":               "indemnification indemnity contract",
    "Auto-Renewal":                  "automatic renewal consumer protection",
    "Photo & Media Rights":          "likeness commercial use copyright publicity",
    "Confidentiality / NDA":         "confidentiality non-disclosure agreement",
    "Amendment / Unilateral Change": "unilateral contract amendment consumer protection",
    "Governing Law":                 "choice of law governing jurisdiction",
    "Payment Terms":                 "payment terms commercial contract",
    "Limitation of Liability":       "limitation liability clause enforceability",
    "Warranty Disclaimer":           "warranty disclaimer consumer protection",
    "Force Majeure":                 "force majeure frustrated contract Canada",
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
                # Pull first legislation title out of the HTML response
                matches = _re.findall(r'<span class="title"[^>]*>([^<]{10,100})</span>', res.text)
                if matches:
                    return f"CanLII: {matches[0].strip()} (canlii.org)"
    except Exception as e:
        print(f"  CanLII scrape failed for {clause_type}: {e}")
    return ""

async def get_live_canadian_law(clauses: list[dict]) -> str:
    """
    Scrapes CanLII for live law references for each clause type.
    Falls back to Gemini training knowledge if scraping fails.
    """
    unique_types = list(set(c["type"] for c in clauses))
    live_refs = []
    print(f"  -> Querying CanLII for {len(unique_types)} clause types...")
    for clause_type in unique_types:
        result = await scrape_canlii(clause_type)
        if result:
            live_refs.append(f"- {clause_type}: {result}")
        await asyncio.sleep(0.3)  # gentle on the server
    if live_refs:
        return "LIVE CANLII REFERENCES (from canlii.org):\n" + "\n".join(live_refs)
    return "No live CanLII results found. Use your training knowledge of Canadian law to analyze these clauses."


async def run_analyst(
    clauses: list[dict],
    document_name: str,
    document_type: str,
    thread_id: str,
) -> list[dict]:
    print("Agent 2 (Analyst): Scoring risk against Canadian law...")
    if not clauses:
        return []

    # Try live CanLII lookup first, fall back to hardcoded knowledge
    canadian_law_context = await get_live_canadian_law(clauses)

    all_analyzed = []
    BATCH = 5

    for i in range(0, len(clauses), BATCH):
        batch = clauses[i:i + BATCH]
        print(f"  -> Batch {i//BATCH + 1}/{(len(clauses) + BATCH - 1)//BATCH}")
        prompt = ANALYST_PROMPT.format(
            document_name=document_name,
            document_type=document_type,
            canadian_law=canadian_law_context,
            clauses_json=json.dumps(batch, indent=2),
        )
        try:
            raw = await call_llm(analyst_llm(), prompt)
            raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw)
            required = ["id","type","raw_text","location","severity","severity_reason",
                        "plain_english","canadian_law","baseline_comparison","negotiation_tip"]
            for item in json.loads(raw):
                if all(k in item for k in required):
                    all_analyzed.append({k: item[k] for k in required})
        except Exception as e:
            print(f"  -> Batch error: {e}")
            for clause in batch:
                all_analyzed.append({
                    **clause,
                    "severity": "UNKNOWN",
                    "severity_reason": "Analysis failed for this clause.",
                    "plain_english": "N/A",
                    "canadian_law": "N/A",
                    "baseline_comparison": "N/A",
                    "negotiation_tip": "N/A",
                })

        if i + BATCH < len(clauses):
            await asyncio.sleep(2)

    all_analyzed.sort(key=lambda c: {"HIGH": 0, "MEDIUM": 1, "LOW": 2}.get(c.get("severity", ""), 3))

    high = sum(1 for c in all_analyzed if c["severity"] == "HIGH")
    med  = sum(1 for c in all_analyzed if c["severity"] == "MEDIUM")
    low  = sum(1 for c in all_analyzed if c["severity"] == "LOW")
    print(f"  -> HIGH: {high}  MEDIUM: {med}  LOW: {low}")

    await backboard_save(thread_id, "assistant", f"ANALYST: Scored {len(all_analyzed)} clauses.\n{json.dumps(all_analyzed)}")
    return all_analyzed


# ═══════════════════════════════════════════════════════════════════════════════
# AGENT 3 — SUMMARIZER + Q&A
# Writes the executive summary. Answers follow-up questions with memory.
# ═══════════════════════════════════════════════════════════════════════════════

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
    analyzed_clauses: list[dict],
    document_name: str,
    document_type: str,
    thread_id: str,
) -> dict:
    print("Agent 3 (Summarizer): Writing summary...")
    high = sum(1 for c in analyzed_clauses if c.get("severity") == "HIGH")
    med  = sum(1 for c in analyzed_clauses if c.get("severity") == "MEDIUM")
    low  = sum(1 for c in analyzed_clauses if c.get("severity") == "LOW")

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
        total=len(analyzed_clauses), high=high, med=med, low=low,
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
            "top_risks": [f"HIGH: {c['type']} — {c.get('severity_reason','')}" for c in analyzed_clauses[:3] if c.get("severity") == "HIGH"] or ["Review clauses manually."],
            "bottom_line": "Sign with caution — automated summary failed.",
            "overall_risk_score": "HIGH" if high > 0 else "MEDIUM",
        }

async def run_qa(
    document_name: str,
    question: str,
    chunks: list[str],
    thread_id: str,
) -> str:
    print("Agent 3 (Q&A): Answering question...")
    if not chunks:
        return "No relevant sections found. Try rephrasing your question."

    # Pull past Q&A from Backboard so repeat questions have context
    history_str = ""
    history = await backboard_get_history(thread_id)
    past_qa = [m["content"] for m in history if m.get("content","").startswith("Q&A")]
    if past_qa:
        history_str = "Previous questions about this document:\n" + "\n".join(past_qa[-3:]) + "\n\n"

    prompt = QA_PROMPT.format(
        document_name=document_name,
        history=history_str,
        chunks="\n\n---\n\n".join(chunks)[:8000],
        question=question,
    )
    try:
        answer = await call_llm(summarizer_llm(), prompt)
        await backboard_save(thread_id, "user",      f"Q&A — Question: {question}")
        await backboard_save(thread_id, "assistant", f"Q&A — Answer: {answer}")
        return answer
    except Exception as e:
        return f"Error answering question: {e}"


# ═══════════════════════════════════════════════════════════════════════════════
# DOCUMENT HELPERS
# ═══════════════════════════════════════════════════════════════════════════════

def detect_document_type(text: str) -> str:
    t = text.lower()
    if any(w in t for w in ["non-disclosure", "nda"]):                     return "Non-Disclosure Agreement (NDA)"
    if any(w in t for w in ["employment", "employee", "salary"]):          return "Employment Contract"
    if any(w in t for w in ["lease", "tenant", "landlord"]):               return "Residential Lease Agreement"
    if any(w in t for w in ["terms of service", "terms and conditions"]):  return "Terms of Service"
    if any(w in t for w in ["privacy policy", "personal data", "pipeda"]): return "Privacy Policy"
    if any(w in t for w in ["waiver", "release of liability"]):            return "Liability Waiver"
    if any(w in t for w in ["contractor", "independent contractor"]):      return "Contractor Agreement"
    return "Legal Contract"

def extract_pdf(data: bytes) -> str:
    reader = PyPDF2.PdfReader(io.BytesIO(data))
    return "".join(p.extract_text() or "" for p in reader.pages).strip()

def extract_docx(data: bytes) -> str:
    doc = python_docx.Document(io.BytesIO(data))
    return "\n".join(p.text for p in doc.paragraphs).strip()

def build_faiss(text: str) -> FAISS:
    chunks = RecursiveCharacterTextSplitter(chunk_size=512, chunk_overlap=50).split_text(text)
    return FAISS.from_texts(chunks, FakeEmbeddings(size=512))


# ═══════════════════════════════════════════════════════════════════════════════
# FASTAPI
# ═══════════════════════════════════════════════════════════════════════════════

app = FastAPI(title="LegalLens API", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

document_store: dict[str, dict]  = {}
vector_store:   dict[str, FAISS] = {}
result_store:   dict[str, dict]  = {}
thread_store:   dict[str, str]   = {}


@app.get("/health")
def health():
    return {"status": "ok", "service": "LegalLens API"}


@app.post("/upload")
async def upload(file: UploadFile = File(...)):
    allowed = [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ]
    if file.content_type not in allowed:
        raise HTTPException(400, "Only PDF and DOCX supported.")

    data = await file.read()
    text = extract_pdf(data) if "pdf" in file.content_type else extract_docx(data)

    if len(text) < 100:
        raise HTTPException(400, "Could not extract text. Is this a scanned image?")

    session_id = str(uuid.uuid4())
    doc_type   = detect_document_type(text)
    document_store[session_id] = {"text": text, "name": file.filename, "type": doc_type}

    thread_id = await backboard_create_thread(file.filename)
    thread_store[session_id] = thread_id
    if thread_id:
        await backboard_save(thread_id, "user", f"Document uploaded: {file.filename} ({doc_type})")

    try:
        vector_store[session_id] = build_faiss(text)
    except Exception as e:
        print(f"Vector store failed: {e}")

    return {
        "session_id":    session_id,
        "document_name": file.filename,
        "document_type": doc_type,
        "char_count":    len(text),
        "thread_id":     thread_id,
    }


@app.get("/analyze/{session_id}")
async def analyze(session_id: str):
    if session_id not in document_store:
        raise HTTPException(404, "Session not found. Upload a document first.")

    doc       = document_store[session_id]
    thread_id = thread_store.get(session_id, "")

    async def stream() -> AsyncGenerator[str, None]:
        def sse(d): return f"data: {json.dumps(d)}\n\n"
        try:
            # Agent 0 — Validate before running anything else
            yield sse({"event": "progress", "agent": "validator", "message": "Checking if this is a legal document..."})
            validation = await run_validator(doc["text"])

            if not validation.get("is_legal_document", True):
                yield sse({
                    "event": "rejected",
                    "reason": validation.get("reason", "This does not appear to be a legal document."),
                    "document_category": validation.get("document_category", "Unknown"),
                    "suggestion": "Please upload a legal contract, NDA, lease, waiver, terms of service, or similar legal document.",
                })
                return

            # Use validator suggested type if better than heuristic detection
            if validation.get("suggested_type") and validation["suggested_type"] != "N/A":
                doc["type"] = validation["suggested_type"]

            yield sse({"event": "progress", "agent": "extractor",  "message": "Scanning for legal clauses..."})
            clauses  = await run_extractor(doc["text"], doc["name"], doc["type"], thread_id)

            yield sse({"event": "progress", "agent": "analyst",    "message": f"Analyzing {len(clauses)} clauses against Canadian law..."})
            analyzed = await run_analyst(clauses, doc["name"], doc["type"], thread_id)

            yield sse({"event": "progress", "agent": "summarizer", "message": "Writing executive summary..."})
            summary  = await run_summarizer(analyzed, doc["name"], doc["type"], thread_id)

            result = {
                "session_id":         session_id,
                "thread_id":          thread_id,
                "document_name":      doc["name"],
                "document_type":      doc["type"],
                "overall_risk_score": summary.get("overall_risk_score"),
                "executive_summary":  summary.get("executive_summary"),
                "top_risks":          summary.get("top_risks"),
                "bottom_line":        summary.get("bottom_line"),
                "analyzed_clauses":   analyzed,
                "clause_count":       len(analyzed),
            }
            result_store[session_id] = result
            yield sse({"event": "complete", "result": result})

        except Exception as e:
            yield sse({"event": "error", "message": str(e)})

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/result/{session_id}")
def get_result(session_id: str):
    if session_id not in result_store:
        raise HTTPException(404, "No result yet. Run /analyze/{session_id} first.")
    return result_store[session_id]


class QARequest(BaseModel):
    question: str

@app.post("/qa/{session_id}")
async def ask(session_id: str, req: QARequest):
    if session_id not in result_store:
        raise HTTPException(404, "No analysis found. Run /analyze first.")
    if session_id not in vector_store:
        raise HTTPException(400, "Vector store unavailable.")

    docs      = vector_store[session_id].similarity_search(req.question, k=4)
    chunks    = [d.page_content for d in docs]
    thread_id = thread_store.get(session_id, "")
    doc_name  = result_store[session_id]["document_name"]

    answer = await run_qa(doc_name, req.question, chunks, thread_id)
    return {"question": req.question, "answer": answer}



@app.get("/history/{session_id}")
async def get_history(session_id: str):
    """
    Returns everything Backboard has stored for this session —
    all agent results, Q&A pairs, and the full analysis trail.
    """
    if session_id not in thread_store:
        raise HTTPException(404, "No session found.")

    thread_id = thread_store[session_id]
    if not thread_id:
        raise HTTPException(400, "No Backboard thread for this session — check your BACKBOARD_API_KEY.")

    messages = await backboard_get_history(thread_id)

    # Sort messages into readable buckets
    sections = {"upload": [], "extractor": [], "analyst": [], "summary": [], "qa": [], "other": []}
    for msg in messages:
        c = msg.get("content", "")
        if c.startswith("Document uploaded"):   sections["upload"].append(c)
        elif c.startswith("EXTRACTOR:"):         sections["extractor"].append(c)
        elif c.startswith("ANALYST:"):           sections["analyst"].append(c)
        elif c.startswith("SUMMARY:"):           sections["summary"].append(c)
        elif c.startswith("Q&A"):               sections["qa"].append(c)
        else:                                    sections["other"].append(c)

    return {
        "session_id":    session_id,
        "thread_id":     thread_id,
        "message_count": len(messages),
        "sections":      sections,
        "raw_messages":  messages,
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)