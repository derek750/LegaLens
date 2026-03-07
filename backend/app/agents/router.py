"""
Routes for the LegalLens agent pipeline: upload, analyze (by session or body), result, Q&A.
"""

import json
import uuid
from typing import AsyncGenerator

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.agents.document_utils import build_faiss, detect_document_type
from app.agents.pipeline import run_analysis, run_qa
from app.agents.state import AgentState
from app.services.pdf_parser import extract_text_from_pdf
from app.services.docx_parser import extract_text_from_docx

router = APIRouter(prefix="/agents", tags=["agents"])

# Session-based storage (in-memory). Upload stores doc + optional FAISS; analyze stores result.
document_store: dict[str, dict] = {}
vector_store: dict = {}  # session_id -> FAISS
result_store: dict[str, AgentState] = {}


# ─── Request/Response models ─────────────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    document_text: str
    document_name: str
    document_type: str = "Legal Contract"


class AnalyzeResponse(BaseModel):
    document_name: str
    document_type: str
    overall_risk_score: str | None
    executive_summary: str | None
    top_risks: list[str] | None
    bottom_line: str | None
    analyzed_clauses: list[dict]
    clause_count: int
    errors: list[str]


class QARequest(BaseModel):
    question: str
    retrieved_chunks: list[str] = []
    document_name: str = ""
    document_type: str = "Legal Contract"
    analyzed_clauses: list[dict] | None = None


class QAResponse(BaseModel):
    question: str
    answer: str


# ─── Session-based flow: upload → analyze → result → qa ──────────────────────

ALLOWED_UPLOAD_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


@router.post("/upload")
async def upload(file: UploadFile = File(...)):
    """
    Upload a PDF or DOCX; extract text, detect type, build FAISS for RAG.
    Returns session_id for use with /analyze/{session_id}, /result/{session_id}, /qa/{session_id}.
    """
    if file.content_type not in ALLOWED_UPLOAD_TYPES:
        raise HTTPException(400, "Only PDF and DOCX supported.")

    data = await file.read()
    if file.content_type == "application/pdf":
        text = extract_text_from_pdf(data)
    else:
        text = extract_text_from_docx(data)

    if len(text.strip()) < 100:
        raise HTTPException(400, "Could not extract enough text. Is the file scanned or empty?")

    session_id = str(uuid.uuid4())
    doc_type = detect_document_type(text)
    document_store[session_id] = {"text": text, "name": file.filename or "document", "type": doc_type}

    faiss = build_faiss(text)
    if faiss is not None:
        vector_store[session_id] = faiss

    return {
        "session_id": session_id,
        "document_name": document_store[session_id]["name"],
        "document_type": doc_type,
        "char_count": len(text),
    }


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


@router.get("/analyze/{session_id}")
async def analyze_by_session(session_id: str):
    """
    Run the full analysis pipeline for an uploaded document (SSE stream).
    Call POST /agents/upload first to get session_id.
    """
    if session_id not in document_store:
        raise HTTPException(404, "Session not found. Upload a document first.")

    doc = document_store[session_id]

    async def stream() -> AsyncGenerator[str, None]:
        try:
            yield _sse({"event": "progress", "agent": "extractor", "message": "Scanning for legal clauses..."})
            result = await run_analysis(
                document_text=doc["text"],
                document_name=doc["name"],
                document_type=doc["type"],
            )
            yield _sse({"event": "progress", "agent": "analyst", "message": f"Scoring {len(result.get('clauses', []))} clauses..."})
            yield _sse({"event": "progress", "agent": "summarizer", "message": "Writing executive summary..."})
            result_store[session_id] = result
            yield _sse({
                "event": "complete",
                "result": {
                    "session_id": session_id,
                    "document_name": result["document_name"],
                    "document_type": result["document_type"],
                    "overall_risk_score": result.get("overall_risk_score"),
                    "executive_summary": result.get("executive_summary"),
                    "top_risks": result.get("top_risks"),
                    "bottom_line": result.get("bottom_line"),
                    "analyzed_clauses": result.get("analyzed_clauses", []),
                    "errors": result.get("errors", []),
                },
            })
        except Exception as e:
            yield _sse({"event": "error", "message": str(e)})

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/result/{session_id}")
def get_result(session_id: str):
    """Return the stored analysis for a session. Run GET /agents/analyze/{session_id} first."""
    if session_id not in result_store:
        raise HTTPException(404, "No result yet. Run analyze for this session first.")
    r = result_store[session_id]
    return {
        **r,
        "session_id": session_id,
        "clause_count": len(r.get("analyzed_clauses", [])),
    }


class QABySessionRequest(BaseModel):
    question: str


@router.post("/qa/{session_id}", response_model=QAResponse)
async def ask_by_session(session_id: str, body: QABySessionRequest) -> QAResponse:
    """
    Answer a question about a previously analyzed document (session-based).
    Uses FAISS retrieval built at upload; run analyze first so result state exists.
    """
    if session_id not in result_store:
        raise HTTPException(404, "No analysis found. Run analyze for this session first.")
    if session_id not in vector_store:
        raise HTTPException(400, "Vector store unavailable for this session (e.g. COHERE_API_KEY not set).")

    result = result_store[session_id]
    docs = vector_store[session_id].similarity_search(body.question, k=4)
    chunks = [d.page_content for d in docs]

    try:
        answer = await run_qa(state=result, question=body.question, retrieved_chunks=chunks)
    except Exception as e:
        raise HTTPException(500, f"Q&A failed: {str(e)}") from e

    return QAResponse(question=body.question, answer=answer)


# ─── Stateless: analyze from body, qa with explicit chunks ───────────────────

@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze_document(body: AnalyzeRequest) -> AnalyzeResponse:
    """
    Run the full analysis pipeline on document text (no session).
    Use this when you already have extracted text (e.g. from /services/parse-pdf).
    """
    if len(body.document_text.strip()) < 100:
        raise HTTPException(
            status_code=400,
            detail="Document text too short. Extract at least 100 characters from PDF/DOCX first.",
        )
    try:
        result = await run_analysis(
            document_text=body.document_text,
            document_name=body.document_name,
            document_type=body.document_type,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}") from e

    return AnalyzeResponse(
        document_name=result["document_name"],
        document_type=result["document_type"],
        overall_risk_score=result.get("overall_risk_score"),
        executive_summary=result.get("executive_summary"),
        top_risks=result.get("top_risks"),
        bottom_line=result.get("bottom_line"),
        analyzed_clauses=result.get("analyzed_clauses", []),
        clause_count=len(result.get("analyzed_clauses", [])),
        errors=result.get("errors", []),
    )


@router.post("/qa", response_model=QAResponse)
async def ask_question(body: QARequest) -> QAResponse:
    """
    Answer a follow-up question with explicit retrieved_chunks (no session).
    Use when you do your own retrieval (e.g. from a different vector store).
    """
    if not body.question.strip():
        raise HTTPException(status_code=400, detail="question is required.")
    if not body.retrieved_chunks:
        raise HTTPException(
            status_code=400,
            detail="At least one retrieved_chunk is required. Run similarity search on document text first.",
        )

    state: AgentState = {
        "document_text": "",
        "document_name": body.document_name or "Document",
        "document_type": body.document_type,
        "clauses": [],
        "analyzed_clauses": body.analyzed_clauses or [],
        "executive_summary": None,
        "top_risks": None,
        "bottom_line": None,
        "overall_risk_score": None,
        "retrieved_chunks": [],
        "qa_question": None,
        "qa_answer": None,
        "errors": [],
        "current_agent": None,
    }

    try:
        answer = await run_qa(
            state=state,
            question=body.question,
            retrieved_chunks=body.retrieved_chunks,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Q&A failed: {str(e)}") from e

    return QAResponse(question=body.question, answer=answer)
