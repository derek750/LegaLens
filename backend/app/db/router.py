import json
import uuid

from fastapi import APIRouter, UploadFile, HTTPException, Depends, Body
from fastapi.responses import StreamingResponse

from app.db.storage import (
    upload_pdf,
    list_files_cached,
    get_signed_url_cached,
    delete_file,
    get_document_by_path_cached,
    download_file,
)
from app.db.analyses import get_analysis_by_document_id_cached, get_document_stats, result_from_analysis_row
from app.auth.dependencies import get_current_user
from app.services.pdf_parser import extract_text_from_pdf
from app.agents.router import (
    register_document_from_bytes,
    run_analysis_stream,
    document_store,
    result_store,
)

router = APIRouter(prefix="/documents", tags=["documents"])


@router.post("/upload")
async def upload_document(file: UploadFile, user: dict = Depends(get_current_user)):
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="Only PDF files are accepted.")

    contents = await file.read()
    result = upload_pdf(contents, file.filename, user["user_id"])

    extracted_text = extract_text_from_pdf(contents)

    return {"message": "File uploaded successfully", "extracted_text": extracted_text, **result}


@router.get("/")
async def list_documents(user: dict = Depends(get_current_user)):
    files = list_files_cached(user["user_id"])
    return {"files": files}


@router.get("/stats")
async def document_stats(user: dict = Depends(get_current_user)):
    """Return aggregate stats: total scanned, clauses flagged, clean documents."""
    files = list_files_cached(user["user_id"])
    doc_ids = [f["id"] for f in files if f.get("id")]
    return get_document_stats(doc_ids)


@router.get("/url")
async def get_document_url(path: str, user: dict = Depends(get_current_user)):
    url = get_signed_url_cached(path)
    return {"url": url}


def _stream_cached_analysis(session_id: str, result: dict):
    """Yield a single SSE 'complete' event for a cached analysis."""
    def sse(d):
        return f"data: {json.dumps(d)}\n\n"
    yield sse({"event": "complete", "result": result})


@router.post("/analyze")
async def analyze_document(
    body: dict = Body(...),
    user: dict = Depends(get_current_user),
):
    """
    Run the full pipeline (parse → extract → analyze → summarize) for a stored document.
    Body: { "path": "<bucket_path>" }. If the document was already analyzed, returns cached result.
    Otherwise verifies ownership, downloads file, runs pipeline, saves to DB, and streams SSE.
    """
    path = body.get("path")
    if not path or not isinstance(path, str):
        raise HTTPException(status_code=400, detail="Missing or invalid 'path' in body.")

    doc = get_document_by_path_cached(path, user["user_id"])
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found or access denied.")

    document_id = doc.get("id")
    cached = get_analysis_by_document_id_cached(document_id) if document_id else None
    if cached:
        session_id = str(uuid.uuid4())
        result = {
            "session_id": session_id,
            "thread_id": "",
            **result_from_analysis_row(cached),
        }
        result_store[session_id] = result
        document_store[session_id] = {
            "text": "",
            "name": doc.get("filename", "document.pdf"),
            "type": cached.get("document_type", ""),
            "page_map": [],
            "document_id": document_id,
            "bucket_path": doc.get("bucket_path", ""),
        }
        return StreamingResponse(
            _stream_cached_analysis(session_id, result),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    try:
        file_bytes = download_file(path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to download document: {e}")

    filename = doc.get("filename", "document.pdf")
    is_pdf = filename.lower().endswith(".pdf")
    session_id = str(uuid.uuid4())

    try:
        await register_document_from_bytes(file_bytes, filename, session_id, is_pdf=is_pdf)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    document_store[session_id]["document_id"] = document_id

    return StreamingResponse(
        run_analysis_stream(session_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.delete("/")
async def delete_document(path: str, user: dict = Depends(get_current_user)):
    delete_file(path, user["user_id"])
    return {"message": "File deleted successfully"}
