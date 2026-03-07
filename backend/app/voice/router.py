import os
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Response, UploadFile, status
from pydantic import BaseModel

from app.voice.voice import (
    run_qa_remote,
    speech_to_text_internal,
    text_to_speech_internal,
)

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


@router.post("/turn")
async def voice_turn(
    session_id: str = Form(..., description="Document session ID for QA (Gemini + Backboard)."),
    audio: UploadFile = File(..., description="Recorded audio (user utterance). Send only after user stops talking."),
    language_code: str | None = Form(None),
    _: None = Depends(_verify_internal_api_key),
):
    """
    One voice turn: STT on the uploaded audio → Gemini + Backboard (QA) → TTS.

    Call this only when the user has **finished speaking** (e.g. after silence).
    Thinking runs once per turn, not while the user is still talking.
    """
    audio_bytes = await audio.read()
    transcript = await speech_to_text_internal(
        audio_bytes,
        language_code=language_code,
    )
    if not transcript:
        fallback = "I didn't catch that. Try again when you're ready."
        audio_bytes = await text_to_speech_internal(text=fallback)
        return Response(content=audio_bytes, media_type="audio/mpeg")
    answer = await run_qa_remote(session_id, transcript)
    if not answer:
        answer = "I couldn't get an answer for that."
    audio_bytes = await text_to_speech_internal(text=answer)
    return Response(content=audio_bytes, media_type="audio/mpeg")


