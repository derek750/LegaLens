import os
import tempfile

import httpx
from elevenlabs.client import AsyncElevenLabs  # type: ignore[import-not-found]
from fastapi import HTTPException, status

# Default voice ID (Rachel) if ELEVENLABS_VOICE_ID is not set
DEFAULT_VOICE_ID = "8j7CWNNX7AHcdYYxls2E"


def _get_required_env(name: str) -> str:
    """Return a required environment variable or raise a 500 error."""
    value = os.getenv(name)
    if not value:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"{name} is not configured on the server.",
        )
    return value


def get_elevenlabs_client() -> AsyncElevenLabs:
    """
    Construct an AsyncElevenLabs client using the server-side API key.
    Keeping this on the backend avoids exposing the key to the browser.
    """
    api_key = _get_required_env("ELEVENLABS_API_KEY")
    return AsyncElevenLabs(api_key=api_key)


def get_tts_voice_id() -> str:
    """Return the voice ID for TTS (env ELEVENLABS_VOICE_ID or default)."""
    return os.getenv("ELEVENLABS_VOICE_ID", DEFAULT_VOICE_ID)


async def text_to_speech_internal(
    text: str,
    voice_id: str | None = None,
    model_id: str = "eleven_multilingual_v2",
    output_format: str = "mp3_44100_128",
) -> bytes:
    """
    Convert text to speech using ElevenLabs TTS only (no conversational session).
    Returns raw audio bytes (e.g. MP3). The brain (Gemini + Backboard) is separate.
    """
    if not text or not text.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Text is required for TTS.",
        )
    client = get_elevenlabs_client()
    vid = voice_id or get_tts_voice_id()
    response = await client.text_to_speech.convert(
        voice_id=vid,
        text=text.strip(),
        model_id=model_id,
        output_format=output_format,
    )
    # SDK may return bytes, a stream, or an httpx-like response
    if isinstance(response, bytes):
        return response
    if hasattr(response, "content"):
        return response.content
    if hasattr(response, "read"):
        return response.read()
    if hasattr(response, "__iter__") and not isinstance(response, (str, bytes)):
        return b"".join(response)
    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail="Unexpected TTS response format from ElevenLabs.",
    )


async def speech_to_text_internal(
    audio_bytes: bytes,
    *,
    language_code: str | None = None,
) -> str:
    """
    Transcribe audio using ElevenLabs STT. Returns the transcript text.
    """
    client = get_elevenlabs_client()
    # SDK typically expects a file path or file-like for multipart upload
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        f.write(audio_bytes)
        path = f.name
    try:
        with open(path, "rb") as f:
            response = await client.speech_to_text.convert(
                file=f,
                model_id="scribe_v2",
                language_code=language_code,
            )
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass
    # Response is typically an object with .text or similar
    if hasattr(response, "text"):
        return (response.text or "").strip()
    if isinstance(response, dict):
        return (response.get("text") or "").strip()
    if isinstance(response, str):
        return response.strip()
    return ""


def get_qa_base_url() -> str:
    """Base URL for the API (agents QA lives at /api/agents/qa/{session_id})."""
    return os.getenv("LEGALENS_QA_BASE_URL", "http://localhost:8000/api").rstrip("/")


async def run_qa_remote(session_id: str, question: str) -> str:
    """
    Call the QA endpoint (Gemini + Backboard). Used after STT so we only
    run thinking when the user has finished speaking.
    """
    base = get_qa_base_url()
    url = f"{base}/agents/qa/{session_id}"
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(url, json={"question": question})
        resp.raise_for_status()
        data = resp.json()
        return data.get("answer", "")


# Prompt for voice consultant when no document is in context (Gemini + Backboard, global law only).
CONSULTANT_PROMPT = """You are a Canadian legal information consultant for LegaLens (voice assistant).
Answer in plain English, 2–4 sentences. Be helpful and accurate; say when you are unsure.

Canadian law context:
{canadian_law}

{history}User question: {question}"""


async def run_voice_think(
    thread_id: str,
    user_utterance: str,
    session_id: str | None = None,
) -> str:
    """
    Voice consultant brain: Backboard thread (new conversation) + global law context → Gemini → answer.
    Output text is returned for ElevenLabs TTS (caller speaks it).
    - Uses the given Backboard thread for history and persists this turn there.
    - Uses global Canadian law context from Backboard (thread or BACKBOARD_LAW_THREAD_ID / scan).
    - If session_id is set and the agents app has that document, uses document QA; otherwise consultant-only.
    """
    from app.agents.backboard import (
        backboard_get_global_law_context,
        backboard_get_history,
        backboard_save,
    )
    from app.agents.llm import call_llm, summarizer_llm

    if not (thread_id and user_utterance and user_utterance.strip()):
        return "Please ask a legal question and I’ll do my best to help."

    # Document-specific path: use existing QA endpoint so document context + Backboard doc thread are used.
    if session_id and session_id.strip():
        answer = await run_qa_remote(session_id.strip(), user_utterance.strip())
        if answer:
            await backboard_save(thread_id, "user", f"Q&A — Question: {user_utterance.strip()}")
            await backboard_save(thread_id, "assistant", f"Q&A — Answer: {answer}")
        return answer or "I couldn’t get an answer for that document. Try rephrasing or select a document first."

    # Consultant path: global law + this Backboard thread only (new thread + global context).
    canadian_law = await backboard_get_global_law_context(thread_id)
    history = await backboard_get_history(thread_id)
    past_qa = [m.get("content", "") for m in history if isinstance(m.get("content"), str) and m["content"].startswith("Q&A")]
    history_str = ""
    if past_qa:
        history_str = "Previous exchange:\n" + "\n".join(past_qa[-3:]) + "\n\n"

    prompt = CONSULTANT_PROMPT.format(
        canadian_law=canadian_law,
        history=history_str,
        question=user_utterance.strip(),
    )
    try:
        answer = await call_llm(summarizer_llm(), prompt)
        await backboard_save(thread_id, "user", f"Q&A — Question: {user_utterance.strip()}")
        await backboard_save(thread_id, "assistant", f"Q&A — Answer: {answer}")
        return answer
    except Exception as e:
        return f"Sorry, I couldn’t complete that. ({e!s})"

