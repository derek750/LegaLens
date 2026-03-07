import os

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Response, UploadFile, status
from pydantic import BaseModel

from app.agents.backboard import backboard_create_thread
from app.voice.voice import (
    create_voice_session_internal,
    run_qa_remote,
    run_voice_think,
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


@router.post("/session")
async def create_voice_session(
    _: None = Depends(_verify_internal_api_key),
):
    """
    Create a new ElevenLabs WebRTC voice session for the configured agent.

    Returns:
      { \"agent_id\", \"webrtc_token\", \"connection_type\" }
    which the frontend passes to @elevenlabs/client Conversation.startSession.
    """
    session = await create_voice_session_internal()
    return session


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


# --- Voice consultant: Backboard thread + Gemini + global law → text output to ElevenLabs ---

class BackboardThreadRequest(BaseModel):
    """Create a new Backboard thread for the voice consultant (conversation memory)."""
    name: str


@router.post("/backboard/thread")
async def create_backboard_thread(
    body: BackboardThreadRequest,
    _: None = Depends(_verify_internal_api_key),
):
    """
    Create a new Backboard thread for the voice consultant.
    Frontend calls this before starting the ElevenLabs conversation so the agent
    has a thread for memory; then each turn uses POST /voice/think with this thread_id.
    """
    thread_id = await backboard_create_thread(body.name or "LegaLens Voice Consultant")
    if not thread_id:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not create Backboard thread. Check BACKBOARD_API_KEY.",
        )
    return {"thread_id": thread_id}


class VoiceThinkRequest(BaseModel):
    """Run Gemini + Backboard for one user utterance; output text is for ElevenLabs TTS."""
    thread_id: str
    user_utterance: str
    session_id: str | None = None


@router.post("/think")
async def voice_think(
    body: VoiceThinkRequest,
    _: None = Depends(_verify_internal_api_key),
):
    """
    Speech → Gemini + Backboard (this thread + global law) → answer text → ElevenLabs.
    Backboard: uses the given thread (new conversation) and the global law context.
    Returns { answer } so the caller (e.g. ElevenLabs get_legal_answer tool) can speak it via TTS.
    """
    answer = await run_voice_think(
        thread_id=body.thread_id,
        user_utterance=body.user_utterance,
        session_id=body.session_id,
    )
    return {"answer": answer}
