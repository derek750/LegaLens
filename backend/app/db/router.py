import uuid

from fastapi import APIRouter, UploadFile, HTTPException, Depends, Body
from fastapi.responses import StreamingResponse

from app.db.storage import upload_pdf, list_files, get_signed_url, delete_file, get_document_by_path, download_file
from app.auth.dependencies import get_current_user
from app.services.pdf_parser import extract_text_from_pdf
from app.agents.router import register_document_from_bytes, run_analysis_stream

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
    files = list_files(user["user_id"])
    return {"files": files}


@router.get("/url")
async def get_document_url(path: str, user: dict = Depends(get_current_user)):
    url = get_signed_url(path)
    return {"url": url}


@router.post("/analyze")
async def analyze_document(
    body: dict = Body(...),
    user: dict = Depends(get_current_user),
):
    """
    Run the full pipeline (parse → extract → analyze → summarize) for a stored document.
    Body: { "path": "<bucket_path>" }. Verifies ownership, downloads file, then streams SSE.
    """
    path = body.get("path")
    if not path or not isinstance(path, str):
        raise HTTPException(status_code=400, detail="Missing or invalid 'path' in body.")

    doc = get_document_by_path(path, user["user_id"])
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found or access denied.")

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

    return StreamingResponse(
        run_analysis_stream(session_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.delete("/")
async def delete_document(path: str, user: dict = Depends(get_current_user)):
    delete_file(path)
    return {"message": "File deleted successfully"}
