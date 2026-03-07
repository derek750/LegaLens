import os
from typing import Any, Dict, List

import httpx

# Official Backboard API (https://docs.backboard.io): app.backboard.io, X-API-Key auth.
# Override BACKBOARD_BASE_URL in env if you use a different endpoint.
BACKBOARD_BASE = os.getenv("BACKBOARD_BASE_URL", "https://app.backboard.io/api")
DEFAULT_ASSISTANT_NAME = os.getenv("BACKBOARD_ASSISTANT_NAME", "LegaLens Assistant")


def _headers() -> Dict[str, str]:
    key = os.environ.get("BACKBOARD_API_KEY")
    if not key:
        raise ValueError("BACKBOARD_API_KEY is not set")
    return {"X-API-Key": key}


async def _get_or_create_assistant_id() -> str:
    """
    Resolve the Backboard assistant_id to use.

    - If BACKBOARD_ASSISTANT_ID is set, always use that.
    - Otherwise, look for an assistant with DEFAULT_ASSISTANT_NAME.
    - If none exists, create one and return its id.
    """
    explicit = os.environ.get("BACKBOARD_ASSISTANT_ID")
    if explicit:
        return explicit

    try:
        async with httpx.AsyncClient() as client:
            # 1) Try to find an existing assistant by name to avoid duplicates
            try:
                res = await client.get(
                    f"{BACKBOARD_BASE}/assistants",
                    headers=_headers(),
                    timeout=15,
                )
                res.raise_for_status()
                data = res.json()
                assistants = data.get("assistants") if isinstance(data, dict) else data
                if isinstance(assistants, list):
                    for a in assistants:
                        if (
                            isinstance(a, dict)
                            and a.get("name") == DEFAULT_ASSISTANT_NAME
                            and a.get("assistant_id")
                        ):
                            return str(a["assistant_id"])
            except httpx.HTTPError as e:
                print(f"Backboard assistant list failed (non-fatal): {e}")

            # 2) Not found — create a single default assistant
            try:
                res = await client.post(
                    f"{BACKBOARD_BASE}/assistants",
                    headers=_headers(),
                    json={
                        "name": DEFAULT_ASSISTANT_NAME,
                        "system_prompt": (
                            "You are a Canadian legal information assistant for the LegaLens app. "
                            "You explain contracts, clauses, and risks in plain English for non-lawyers. "
                            "You are not a lawyer and do not provide formal legal advice."
                        ),
                    },
                    timeout=15,
                )
                res.raise_for_status()
                created = res.json()
                assistant_id = created.get("assistant_id", "")
                if assistant_id:
                    print(
                        f"Created Backboard assistant '{DEFAULT_ASSISTANT_NAME}' "
                        f"with id {assistant_id}. Set BACKBOARD_ASSISTANT_ID in your env to pin it."
                    )
                return str(assistant_id)
            except httpx.HTTPError as e:
                print(f"Backboard assistant creation failed (non-fatal): {e}")
    except ValueError as e:
        print(f"Backboard config error: {e}")

    return ""


async def backboard_create_thread(document_name: str) -> str:
    try:
        assistant_id = await _get_or_create_assistant_id()
        async with httpx.AsyncClient() as client:
            if assistant_id:
                # Official API: create thread under an assistant
                res = await client.post(
                    f"{BACKBOARD_BASE}/assistants/{assistant_id}/threads",
                    headers=_headers(),
                    json={},
                    timeout=15,
                )
            else:
                # Fallback: some setups use a direct POST /threads (e.g. custom or legacy)
                res = await client.post(
                    f"{BACKBOARD_BASE}/threads",
                    headers=_headers(),
                    json={"name": f"LegalLens: {document_name}"},
                    timeout=15,
                )
            res.raise_for_status()
            data = res.json()
            return data.get("thread_id", "")
    except httpx.HTTPError as e:
        print(f"Backboard thread creation failed (non-fatal): {e}")
        return ""
    except ValueError as e:
        print(f"Backboard config error: {e}")
        return ""


async def backboard_save(thread_id: str, role: str, content: str) -> None:
    if not thread_id:
        return
    try:
        async with httpx.AsyncClient() as client:
            # Try JSON body (role+content); if API expects form data only, fall back to content-only.
            res = await client.post(
                f"{BACKBOARD_BASE}/threads/{thread_id}/messages",
                headers=_headers(),
                json={"role": role, "content": content},
                timeout=15,
            )
            res.raise_for_status()
    except httpx.HTTPError as e:
        # Some Backboard setups only accept form data and user content; save is best-effort.
        print(f"Backboard save failed (non-fatal): {e}")
    except ValueError as e:
        print(f"Backboard config error: {e}")


async def backboard_get_history(thread_id: str) -> List[Dict[str, Any]]:
    if not thread_id:
        return []
    try:
        async with httpx.AsyncClient() as client:
            # Official API: GET /threads/{id} returns the thread with a "messages" array
            res = await client.get(
                f"{BACKBOARD_BASE}/threads/{thread_id}",
                headers=_headers(),
                timeout=15,
            )
            res.raise_for_status()
            data = res.json()
            return data.get("messages", [])
    except httpx.HTTPError as e:
        print(f"Backboard history fetch failed (non-fatal): {e}")
        return []
    except ValueError as e:
        print(f"Backboard config error: {e}")
        return []


# Default context when no LAW_CONTEXT is stored yet (e.g. before analyst runs).
# All agents use the global Canadian law thread; this fallback keeps them aligned.
DEFAULT_CANADIAN_LAW_CONTEXT = (
    "Apply Canadian federal and provincial contract law, including PIPEDA, "
    "Canada Labour Code, consumer protection legislation, and common law principles where relevant."
)


async def backboard_get_global_law_context(thread_id: str) -> str:
    """
    Return Canadian law context for agent prompts. Used by all agents so they share
    the same global thread context (from BACKBOARD_LAW_THREAD_ID or any LAW_CONTEXT in Backboard).
    """
    if thread_id:
        try:
            history = await backboard_get_history(thread_id)
            for msg in reversed(history):
                content = msg.get("content", "")
                if isinstance(content, str) and content.startswith("LAW_CONTEXT:"):
                    return content[len("LAW_CONTEXT:") :].lstrip()
        except Exception as e:
            print(f"Backboard get global law context (thread) failed (non-fatal): {e}")
    try:
        global_ctx = await backboard_find_global_law_context()
        if global_ctx:
            return global_ctx
    except Exception as e:
        print(f"Backboard get global law context (global scan) failed (non-fatal): {e}")
    return DEFAULT_CANADIAN_LAW_CONTEXT


async def backboard_find_global_law_context() -> str | None:
    """
    Scan Backboard for any LAW_CONTEXT message across threads.

    This lets us treat the scraped Canadian law references as a global
    cache persisted in Backboard instead of on disk. We only need to
    find it once per process; the caller will memoize in memory.
    """
    # Fast path: user can optionally pin a dedicated law thread
    law_thread_id = os.environ.get("BACKBOARD_LAW_THREAD_ID")
    try:
        async with httpx.AsyncClient() as client:
            if law_thread_id:
                try:
                    res = await client.get(
                        f"{BACKBOARD_BASE}/threads/{law_thread_id}",
                        headers=_headers(),
                        timeout=20,
                    )
                    res.raise_for_status()
                    data = res.json()
                    messages = data.get("messages", [])
                    for msg in messages:
                        content = msg.get("content", "")
                        if isinstance(content, str) and content.startswith("LAW_CONTEXT:"):
                            return content[len("LAW_CONTEXT:") :].lstrip()
                except httpx.HTTPError as e:
                    print(f"Backboard law thread lookup failed (non-fatal): {e}")

            # Fallback: list all threads and look for any LAW_CONTEXT message
            try:
                res = await client.get(
                    f"{BACKBOARD_BASE}/threads",
                    headers=_headers(),
                    timeout=30,
                )
                res.raise_for_status()
                data = res.json()
                threads = data.get("threads") if isinstance(data, dict) else data
                if not isinstance(threads, list):
                    return None

                for t in threads:
                    if not isinstance(t, dict):
                        continue
                    tid = t.get("thread_id")
                    if not tid:
                        continue
                    try:
                        tres = await client.get(
                            f"{BACKBOARD_BASE}/threads/{tid}",
                            headers=_headers(),
                            timeout=15,
                        )
                        tres.raise_for_status()
                        tdata = tres.json()
                        messages = tdata.get("messages", [])
                        for msg in messages:
                            content = msg.get("content", "")
                            if isinstance(content, str) and content.startswith("LAW_CONTEXT:"):
                                return content[len("LAW_CONTEXT:") :].lstrip()
                    except httpx.HTTPError as e:
                        print(f"Backboard thread scan failed for {tid} (non-fatal): {e}")
            except httpx.HTTPError as e:
                print(f"Backboard list threads failed (non-fatal): {e}")
    except ValueError as e:
        print(f"Backboard config error: {e}")

    return None
