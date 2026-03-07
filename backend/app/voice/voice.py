import os

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

