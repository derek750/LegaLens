import os

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Response, UploadFile, status
from pydantic import BaseModel

from app.agents.backboard import backboard_create_thread
from app.agents.documents import detect_document_type, extract_docx, extract_pdf
from app.agents.extractor import run_extractor
from app.agents.analyst import run_analyst
from app.db.storage import download_file
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


class ContextDocumentRequest(BaseModel):
    """
    Add a stored document as context into an existing Backboard thread.

    The document is downloaded from storage, parsed, and passed through the
    extractor + analyst agents, which both write into the SAME Backboard thread
    used by the voice consultant. This gives the AI clause-level context for
    that document without creating a new thread.
    """

    thread_id: str
    bucket_path: str


@router.post("/context/document")
async def add_context_document_to_thread(
    body: ContextDocumentRequest,
    _: None = Depends(_verify_internal_api_key),
):
    """
    Run extractor + analyst on a stored document and save results into an
    existing Backboard thread (voice consultant memory).
    """
    thread_id = body.thread_id.strip()
    if not thread_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="thread_id is required.",
        )
    try:
        file_bytes = download_file(body.bucket_path)
    except Exception as e:  # pragma: no cover - storage errors are rare and environment-specific
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to download context document: {e}",
        ) from e

    filename = body.bucket_path.rsplit("/", 1)[-1] or "document"
    is_pdf = filename.lower().endswith(".pdf")
    text = extract_pdf(file_bytes) if is_pdf else extract_docx(file_bytes)
    if len(text) < 100:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not extract enough text from the context document.",
        )

    doc_type = detect_document_type(text)

    # Save document identity so the consultant prompt can say "the contract is X"
    from app.agents.backboard import backboard_save
    await backboard_save(
        thread_id,
        "assistant",
        f"CONTEXT_DOCUMENT: {filename} ({doc_type})",
    )

    # 1) Extract clauses into this existing Backboard thread
    clauses = await run_extractor(text, filename, doc_type, thread_id)

    # 2) Analyze clauses against Canadian law into the same thread
    analyzed = await run_analyst(clauses, filename, doc_type, thread_id)

    return {
        "document_name": filename,
        "document_type": doc_type,
        "clause_count": len(analyzed),
    }
