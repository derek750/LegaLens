import os

from fastapi import APIRouter, Depends, Header, HTTPException, Response, status
from pydantic import BaseModel

from app.voice.voice import text_to_speech_internal

router = APIRouter(prefix="/voice", tags=["voice"])


async def _verify_internal_api_key(
    x_api_key: str = Header(..., alias="X-API-Key"),
) -> None:
    """
    Lightweight guard so only trusted clients (e.g. your own frontend
    or hotword listener) can use voice endpoints.
    """
    expected = os.getenv("VOICE_AGENT_API_KEY", "dev-voice-agent-key")
    if x_api_key != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key",
        )


class TTSRequest(BaseModel):
    """Request body for text-to-speech. ElevenLabs is TTS only; Gemini + Backboard is the brain."""

    text: str
    voice_id: str | None = None


@router.post("/tts")
async def text_to_speech(
    body: TTSRequest,
    _: None = Depends(_verify_internal_api_key),
):
    """
    Convert text to speech using ElevenLabs (TTS only). Returns MP3 audio.

    Conversation brain: use Gemini + Backboard (e.g. POST /qa/{session_id} with
    the user's question), then send the answer text here to get speech.
    """
    audio_bytes = await text_to_speech_internal(
        text=body.text,
        voice_id=body.voice_id,
    )
    return Response(
        content=audio_bytes,
        media_type="audio/mpeg",
    )


