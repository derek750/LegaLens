import uuid
from app.db.client import supabase

BUCKET_NAME = "legal documents"


def _safe_user_id(user_id: str) -> str:
    """Replace characters invalid in storage paths."""
    return user_id.replace("|", "_")

def ensure_bucket_exists() -> None:
    """Create the storage bucket if it doesn't already exist."""
    existing = [b.name for b in supabase.storage.list_buckets()]
    if BUCKET_NAME not in existing:
        supabase.storage.create_bucket(BUCKET_NAME, options={"public": False})


def upload_pdf(file_bytes: bytes, original_filename: str, user_id: str) -> dict:
    """Upload a PDF to the documents bucket scoped to the user."""
    safe_id = _safe_user_id(user_id)
    file_id = uuid.uuid4().hex
    storage_path = f"{safe_id}/{file_id}/{original_filename}"

    ensure_bucket_exists()

    supabase.storage.from_(BUCKET_NAME).upload(
        path=storage_path,
        file=file_bytes,
        file_options={"content-type": "application/pdf"},
    )

    # Record metadata in the documents table
    supabase.table("documents").insert({
        "user_id": user_id,
        "bucket_path": storage_path,
        "filename": original_filename,
        "size_bytes": len(file_bytes),
    }).execute()

    return {"bucket": BUCKET_NAME, "path": storage_path}


def list_files(user_id: str) -> list[dict]:
    """List all documents belonging to a specific user from the database."""
    result = (
        supabase.table("documents")
        .select("id, filename, bucket_path, size_bytes, created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )
    return result.data or []


def get_signed_url(path: str, expires_in: int = 3600) -> str:
    """Generate a temporary signed URL for a stored file."""
    res = supabase.storage.from_(BUCKET_NAME).create_signed_url(path, expires_in)
    return res["signedURL"]


def delete_file(path: str) -> None:
    """Delete a file from the bucket and its database record."""
    supabase.storage.from_(BUCKET_NAME).remove([path])
    supabase.table("documents").delete().eq("bucket_path", path).execute()
