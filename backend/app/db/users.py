from datetime import datetime, timezone

from app.db.client import supabase


def upsert_profile(user_id: str, email: str) -> dict:
    """Insert or update the user profile on every authenticated request (e.g. first sign-in or upload)."""
    now = datetime.now(timezone.utc).isoformat()
    result = (
        supabase.table("profiles")
        .upsert(
            {"id": user_id, "email": email, "last_seen_at": now},
            on_conflict="id",
        )
        .execute()
    )
    return result.data[0] if result.data else {}
