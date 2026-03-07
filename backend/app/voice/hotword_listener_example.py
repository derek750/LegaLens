"""
Minimal hotword listener sketch that shows how to
hand off to the ElevenLabs voice session endpoint.

This intentionally leaves out low-level microphone wiring
so you can plug in your preferred audio stack (PyAudio,
sounddevice, etc.) while keeping the wake-word → session
hand-off clear.
"""

import asyncio
import os
from typing import List, Optional

import httpx
import pvporcupine
import sounddevice as sd


VOICE_SESSION_URL = os.getenv(
    "VOICE_SESSION_URL",
    "http://localhost:8000/api/voice/session",
)
INTERNAL_API_KEY = os.getenv("VOICE_AGENT_API_KEY", "dev-voice-agent-key")

# Lazily-created global input stream so we only open the microphone once.
_audio_stream: Optional[sd.InputStream] = None


def _ensure_audio_stream(sample_rate: int, frame_length: int) -> sd.InputStream:
    """
    Create and start a shared sounddevice.InputStream if it doesn't exist yet.
    """
    global _audio_stream

    if _audio_stream is None:
        _audio_stream = sd.InputStream(
            samplerate=sample_rate,
            channels=1,
            dtype="int16",
            blocksize=frame_length,
        )
        _audio_stream.start()

    return _audio_stream


def read_single_frame_from_microphone(
    frame_length: int,
    sample_rate: int,
) -> List[int]:
    """
    Capture a single frame of 16‑bit PCM audio from the default microphone.

    Returns a list[int] with length == frame_length suitable for Porcupine.
    """
    stream = _ensure_audio_stream(sample_rate=sample_rate, frame_length=frame_length)

    # sounddevice returns a NumPy array of shape (frame_length, channels)
    frames, _ = stream.read(frame_length)
    mono = frames[:, 0]  # first (and only) channel
    return mono.astype("int16").tolist()


async def trigger_voice_session() -> None:
    """
    Call the FastAPI /voice/session endpoint to create a new
    ElevenLabs conversational session.

    In a typical architecture, this runs on the same machine
    as the hotword listener, and the response is forwarded to
    the UI layer that owns the actual audio conversation loop.
    """
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            VOICE_SESSION_URL,
            headers={"X-API-Key": INTERNAL_API_KEY},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        print("Started ElevenLabs voice session:", data)

        # At this point you would:
        # - in a browser: use @elevenlabs/client with data["webrtc_token"]
        #   and data["agent_id"] to start the WebRTC conversation.
        # - in a native client: use the ElevenLabs Conversational AI SDK
        #   for your platform to open the audio session.


async def hotword_listener_loop() -> None:
    """
    Idle loop that blocks until Porcupine detects the hotword,
    then asks the backend to create a new ElevenLabs session.
    """
    access_key = os.environ["PICOVOICE_ACCESS_KEY"]

    # For a real "Hey Assistant" experience you would export a custom
    # keyword from Picovoice Console and pass its .ppn path via
    # the PORCUPINE_KEYWORD_PATH env var.
    keyword_path = os.getenv("PORCUPINE_KEYWORD_PATH")
    if keyword_path:
        porcupine = pvporcupine.create(
            access_key=access_key,
            keyword_paths=[keyword_path],
        )
        hotword_label = "Hey Consultant"
    else:
        porcupine = pvporcupine.create(
            access_key=access_key,
            keywords=["porcupine"],
        )
        hotword_label = "Porcupine"

    print(f"Hotword listener idle. Say '{hotword_label}' to wake the agent.")

    try:
        while True:
            pcm = read_single_frame_from_microphone(
                frame_length=porcupine.frame_length,
                sample_rate=porcupine.sample_rate,
            )
            keyword_index = porcupine.process(pcm)

            if keyword_index >= 0:
                print(f"Hotword '{hotword_label}' detected.")
                await trigger_voice_session()
    finally:
        porcupine.delete()
        # Clean up audio resources if we created a stream.
        global _audio_stream
        if _audio_stream is not None:
            _audio_stream.stop()
            _audio_stream.close()
            _audio_stream = None


if __name__ == "__main__":
    asyncio.run(hotword_listener_loop())

