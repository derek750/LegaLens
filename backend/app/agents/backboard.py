import os
from typing import Any, Dict, List

import httpx


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


async def backboard_save(thread_id: str, role: str, content: str) -> None:
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


async def backboard_get_history(thread_id: str) -> List[Dict[str, Any]]:
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

