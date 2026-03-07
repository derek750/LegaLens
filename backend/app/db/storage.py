import uuid
from app.db.client import supabase

BUCKET_NAME = "legal documents"

def ensure_bucket_exists() -> None:
    """Create the storage bucket if it doesn't already exist."""
    existing = [b.name for b in supabase.storage.list_buckets()]
    if BUCKET_NAME not in existing:
        supabase.storage.create_bucket(BUCKET_NAME, options={"public": False})


def upload_pdf(file_bytes: bytes, original_filename: str, user_id: str) -> dict:
    """Upload a PDF to the documents bucket scoped to the user."""
    file_id = uuid.uuid4().hex
    storage_path = f"{user_id}/{file_id}/{original_filename}"

    ensure_bucket_exists()

    supabase.storage.from_(BUCKET_NAME).upload(
        path=storage_path,
        file=file_bytes,
        file_options={"content-type": "application/pdf"},
    )

    return {"bucket": BUCKET_NAME, "path": storage_path}


def list_files(user_id: str) -> list[dict]:
    """List all files belonging to a specific user in the bucket."""
    ensure_bucket_exists()
    storage = supabase.storage.from_(BUCKET_NAME)

    # Top-level entries under the user folder are sub-folders (file_id UUIDs)
    folders = storage.list(path=user_id)
    files: list[dict] = []
    for folder in folders:
        folder_name = folder.get("name", "")
        if not folder_name:
            continue
        sub_path = f"{user_id}/{folder_name}"
        items = storage.list(path=sub_path)
        for item in items:
            if item.get("name"):
                item["path"] = f"{sub_path}/{item['name']}"
                files.append(item)
    return files


def get_signed_url(path: str, expires_in: int = 3600) -> str:
    """Generate a temporary signed URL for a stored file."""
    res = supabase.storage.from_(BUCKET_NAME).create_signed_url(path, expires_in)
    return res["signedURL"]


def delete_file(path: str) -> None:
    """Delete a file from the bucket."""
    supabase.storage.from_(BUCKET_NAME).remove([path])
