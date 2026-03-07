import os

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel

from app.voice.voice import create_voice_session_internal
from app.agents.backboard import (
    backboard_create_thread,
    backboard_save,
    backboard_get_history,
)


router = APIRouter(prefix="/voice", tags=["voice"])


async def _verify_internal_api_key(
    x_api_key: str = Header(..., alias="X-API-Key"),
) -> None:
    """
    Lightweight guard so only trusted clients (e.g. your own frontend
    or hotword listener process) can start a voice session or call
    Backboard tools exposed for ElevenLabs thinking.
    """
    expected = os.getenv("VOICE_AGENT_API_KEY", "dev-voice-agent-key")
    if x_api_key != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key",
        )


@router.post("/session")
async def create_voice_session(
    _: None = Depends(_verify_internal_api_key),
) -> dict:
    """
    Create a short-lived ElevenLabs conversational session and return
    connection details for the caller.

    Typical flow:
    - a hotword listener detects "Hey Assistant"
    - it calls this endpoint
    - the frontend then uses the returned data with the ElevenLabs
      Conversational AI SDK to open a WebRTC / WebSocket connection
      and run the actual audio conversation loop.
    """
    return await create_voice_session_internal()


class CreateBackboardThreadBody(BaseModel):
    """Request body for creating a Backboard thread for voice / thinking."""

    name: str


class SaveBackboardMessageBody(BaseModel):
    """Request body for appending a message to a Backboard thread."""

    thread_id: str
    role: str
    content: str


@router.post("/backboard/thread")
async def create_backboard_thread(
    body: CreateBackboardThreadBody,
    _: None = Depends(_verify_internal_api_key),
) -> dict:
    """
    Create a Backboard thread that ElevenLabs voice / thinking can use
    as persistent memory for a conversation.
    """
    thread_id = await backboard_create_thread(body.name)
    if not thread_id:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to create Backboard thread.",
        )
    return {"thread_id": thread_id}


@router.post("/backboard/message")
async def save_backboard_message(
    body: SaveBackboardMessageBody,
    _: None = Depends(_verify_internal_api_key),
) -> dict:
    """
    Append a single message to a Backboard thread.

    Intended to be called from ElevenLabs tools with the current
    conversation turn (role + content).
    """
    await backboard_save(body.thread_id, body.role, body.content)
    return {"status": "ok"}


@router.get("/backboard/history/{thread_id}")
async def get_backboard_history_for_voice(
    thread_id: str,
    _: None = Depends(_verify_internal_api_key),
) -> dict:
    """
    Fetch the full Backboard history for a given thread so the
    ElevenLabs agent can ground its thinking in prior context.
    """
    messages = await backboard_get_history(thread_id)
    return {"thread_id": thread_id, "messages": messages}


