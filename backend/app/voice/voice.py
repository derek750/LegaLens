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
    """Base URL for the QA service (Agents app). Thinking runs only when user is done talking."""
    return os.getenv("LEGALENS_QA_BASE_URL", "http://localhost:8000")


async def run_qa_remote(session_id: str, question: str) -> str:
    """
    Call the QA endpoint (Gemini + Backboard). Used after STT so we only
    run thinking when the user has finished speaking.
    """
    base = get_qa_base_url().rstrip("/")
    url = f"{base}/qa/{session_id}"
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(url, json={"question": question})
        resp.raise_for_status()
        data = resp.json()
        return data.get("answer", "")

