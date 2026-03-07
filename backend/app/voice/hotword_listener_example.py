"""
Minimal hotword listener sketch: wake word triggers the voice flow.

Brain = Gemini + Backboard (POST /qa/{session_id} with the user's question).
Speech = ElevenLabs TTS only (POST /api/voice/tts with response text).

This example leaves out low-level microphone wiring so you can plug in
your preferred audio stack (PyAudio, sounddevice, etc.).
"""

import asyncio
import os
from typing import List, Optional

import httpx
import pvporcupine
import sounddevice as sd


VOICE_TTS_URL = os.getenv(
    "VOICE_TTS_URL",
    "http://localhost:8000/api/voice/tts",
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


async def trigger_voice_flow() -> None:
    """
    Wake word detected. In a full flow you would:
    1. Capture user speech and run STT (e.g. Whisper or client-side).
    2. Send the question to Gemini + Backboard: POST /qa/{session_id} with body {"question": "..."}.
    3. Send the answer text to TTS: POST /api/voice/tts with body {"text": answer}.
    4. Play the returned MP3.

    This example just requests a short TTS clip to confirm the pipeline works.
    """
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            VOICE_TTS_URL,
            headers={"X-API-Key": INTERNAL_API_KEY},
            json={"text": "Ready. Ask your question about the document."},
            timeout=15,
        )
        resp.raise_for_status()
        # resp.content is MP3 bytes; play with your audio stack or forward to UI
        print(f"TTS returned {len(resp.content)} bytes (audio/mpeg)")


async def hotword_listener_loop() -> None:
    """
    Idle loop: on hotword, trigger the voice flow (Gemini+Backboard = brain, ElevenLabs = TTS).
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
                await trigger_voice_flow()
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

