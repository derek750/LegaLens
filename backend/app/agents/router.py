"""FastAPI router for the document-analysis pipeline (upload, analyze, qa, history).

Pipeline (after PDF/doc is parsed on upload):
  1. Extract — run_extractor: find legal clauses
  2. Analyze — run_analyst: score against Canadian law
  3. Summarize — run_summarizer: executive summary, top risks, bottom line
All steps use a single Backboard thread created at upload (thread_store[session_id]).
"""

import json
import uuid
from typing import AsyncGenerator

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from langchain_community.vectorstores import FAISS
from pydantic import BaseModel

from app.agents.analyst import run_analyst
from app.agents.backboard import (
    backboard_create_thread,
    backboard_get_history,
    backboard_save,
)
from app.agents.documents import (
    build_faiss,
    detect_document_type,
    extract_docx,
    extract_pdf,
)
from app.agents.extractor import run_extractor
from app.agents.summarizer import run_qa, run_summarizer
from app.agents.validator import run_validator

router = APIRouter(prefix="/agents", tags=["agents"])

# In-memory stores for the document pipeline (session_id keyed).
# One Backboard thread per session: created on upload, reused for extract → analyze → summarize.
document_store: dict[str, dict] = {}
vector_store: dict[str, FAISS] = {}
result_store: dict[str, dict] = {}
thread_store: dict[str, str] = {}


async def register_document_from_bytes(
    file_bytes: bytes,
    filename: str,
    session_id: str,
    is_pdf: bool = True,
) -> None:
    """
    Register a document in the pipeline stores (used by upload or by stored-doc analyze).
    Parses text, creates Backboard thread, builds vector store.
    """
    text = extract_pdf(file_bytes) if is_pdf else extract_docx(file_bytes)
    if len(text) < 100:
        raise ValueError("Could not extract enough text from the document.")
    doc_type = detect_document_type(text)
    document_store[session_id] = {"text": text, "name": filename, "type": doc_type}
    thread_id = await backboard_create_thread(filename)
    thread_store[session_id] = thread_id or ""
    if thread_id:
        await backboard_save(thread_id, "user", f"Document uploaded: {filename} ({doc_type})")
    try:
        vector_store[session_id] = build_faiss(text)
    except Exception as e:
        print(f"Vector store failed: {e}")


async def run_analysis_stream(session_id: str) -> AsyncGenerator[str, None]:
    """Run the full pipeline (validator → extract → analyze → summarize) and yield SSE events."""
    def sse(d):
        return f"data: {json.dumps(d)}\n\n"

    if session_id not in document_store:
        yield sse({"event": "error", "message": "Session not found."})
        return

    doc = document_store[session_id]
    thread_id = thread_store.get(session_id, "")

    try:
        yield sse({"event": "progress", "agent": "validator", "message": "Checking if this is a legal document..."})
        validation = await run_validator(doc["text"], thread_id)

        if not validation.get("is_legal_document", True):
            yield sse({
                "event": "rejected",
                "reason": validation.get("reason", "This does not appear to be a legal document."),
                "document_category": validation.get("document_category", "Unknown"),
                "suggestion": "Please upload a legal contract, NDA, lease, waiver, terms of service, or similar legal document.",
            })
            return

        if validation.get("suggested_type") and validation["suggested_type"] != "N/A":
            doc["type"] = validation["suggested_type"]

        yield sse({"event": "progress", "agent": "extractor", "message": "Scanning for legal clauses..."})
        clauses = await run_extractor(doc["text"], doc["name"], doc["type"], thread_id)

        yield sse({
            "event": "progress",
            "agent": "analyst",
            "message": f"Analyzing {len(clauses)} clauses against Canadian law...",
        })
        analyzed = await run_analyst(clauses, doc["name"], doc["type"], thread_id)

        yield sse({"event": "progress", "agent": "summarizer", "message": "Writing executive summary..."})
        summary = await run_summarizer(analyzed, doc["name"], doc["type"], thread_id)

        result = {
            "session_id": session_id,
            "thread_id": thread_id,
            "document_name": doc["name"],
            "document_type": doc["type"],
            "overall_risk_score": summary.get("overall_risk_score"),
            "executive_summary": summary.get("executive_summary"),
            "top_risks": summary.get("top_risks"),
            "bottom_line": summary.get("bottom_line"),
            "analyzed_clauses": analyzed,
            "clause_count": len(analyzed),
        }
        result_store[session_id] = result
        print("[Pipeline complete] Backboard thread_id:", thread_id)
        print("[Pipeline output]", json.dumps(result, indent=2, default=str))
        yield sse({"event": "complete", "result": result})
    except Exception as e:
        yield sse({"event": "error", "message": str(e)})


@router.get("/health")
def health():
    return {"status": "ok", "service": "LegalLens API"}


@router.post("/upload")
async def upload(file: UploadFile = File(...)):
    allowed = [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]
    if file.content_type not in allowed:
        raise HTTPException(400, "Only PDF and DOCX supported.")

    data = await file.read()
    text = extract_pdf(data) if "pdf" in file.content_type else extract_docx(data)

    if len(text) < 100:
        raise HTTPException(400, "Could not extract text. Is this a scanned image?")

    session_id = str(uuid.uuid4())
    doc_type = detect_document_type(text)
    document_store[session_id] = {"text": text, "name": file.filename, "type": doc_type}

    # Single Backboard thread for this document; used for extract → analyze → summarize.
    thread_id = await backboard_create_thread(file.filename)
    thread_store[session_id] = thread_id
    if thread_id:
        await backboard_save(
            thread_id, "user", f"Document uploaded: {file.filename} ({doc_type})"
        )

    try:
        vector_store[session_id] = build_faiss(text)
    except Exception as e:
        print(f"Vector store failed: {e}")

    return {
        "session_id": session_id,
        "document_name": file.filename,
        "document_type": doc_type,
        "char_count": len(text),
        "thread_id": thread_id,
    }


@router.get("/analyze/{session_id}")
async def analyze(session_id: str):
    if session_id not in document_store:
        raise HTTPException(404, "Session not found. Upload a document first.")
    return StreamingResponse(
        run_analysis_stream(session_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/result/{session_id}")
def get_result(session_id: str):
    if session_id not in result_store:
        raise HTTPException(404, "No result yet. Run /analyze/{session_id} first.")
    return result_store[session_id]


class QARequest(BaseModel):
    question: str


@router.post("/qa/{session_id}")
async def ask(session_id: str, req: QARequest):
    if session_id not in result_store:
        raise HTTPException(404, "No analysis found. Run /analyze first.")
    if session_id not in vector_store:
        raise HTTPException(400, "Vector store unavailable.")

    docs = vector_store[session_id].similarity_search(req.question, k=4)
    chunks = [d.page_content for d in docs]
    thread_id = thread_store.get(session_id, "")
    doc_name = result_store[session_id]["document_name"]

    answer = await run_qa(doc_name, req.question, chunks, thread_id)
    return {"question": req.question, "answer": answer}


@router.get("/history/{session_id}")
async def get_history(session_id: str):
    """
    Returns everything Backboard has stored for this session —
    all agent results, Q&A pairs, and the full analysis trail.
    """
    if session_id not in thread_store:
        raise HTTPException(404, "No session found.")

    thread_id = thread_store[session_id]
    if not thread_id:
        raise HTTPException(
            400,
            "No Backboard thread for this session — check your BACKBOARD_API_KEY.",
        )

    messages = await backboard_get_history(thread_id)

    sections = {
        "upload": [],
        "extractor": [],
        "analyst": [],
        "summary": [],
        "qa": [],
        "other": [],
    }
    for msg in messages:
        c = msg.get("content", "")
        if c.startswith("Document uploaded"):
            sections["upload"].append(c)
        elif c.startswith("EXTRACTOR:"):
            sections["extractor"].append(c)
        elif c.startswith("ANALYST:"):
            sections["analyst"].append(c)
        elif c.startswith("SUMMARY:"):
            sections["summary"].append(c)
        elif c.startswith("Q&A"):
            sections["qa"].append(c)
        else:
            sections["other"].append(c)

    return {
        "session_id": session_id,
        "thread_id": thread_id,
        "message_count": len(messages),
        "sections": sections,
        "raw_messages": messages,
    }
