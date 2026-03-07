from fastapi import APIRouter, UploadFile, HTTPException

from db.storage import upload_pdf, list_files, get_signed_url, delete_file

router = APIRouter(prefix="/documents", tags=["documents"])

@router.post("/upload")
async def upload_document(file: UploadFile):
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="Only PDF files are accepted.")

    contents = await file.read()
    result = upload_pdf(contents, file.filename)
    return {"message": "File uploaded successfully", **result}


@router.get("/")
async def list_documents():
    files = list_files()
    return {"files": files}


@router.get("/url")
async def get_document_url(path: str):
    url = get_signed_url(path)
    return {"url": url}


@router.delete("/")
async def delete_document(path: str):
    delete_file(path)
    return {"message": "File deleted successfully"}
