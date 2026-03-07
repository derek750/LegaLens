"""
Hotword listener: after wake word, user is in constant voice conversation.

Thinking (Gemini + Backboard) runs only when the user **stops talking**
(silence-based end-of-speech). Until then we just record; no LLM calls.
"""

import asyncio
import os
import platform
import struct
import subprocess
import tempfile
from typing import List, Optional

import httpx
import numpy as np
import pvporcupine
import sounddevice as sd


VOICE_TTS_URL = os.getenv(
    "VOICE_TTS_URL",
    "http://localhost:8000/api/voice/tts",
)
VOICE_TURN_URL = os.getenv(
    "VOICE_TURN_URL",
    "http://localhost:8000/api/voice/turn",
)
VOICE_SESSION_ID = os.getenv("VOICE_SESSION_ID", "")
INTERNAL_API_KEY = os.getenv("VOICE_AGENT_API_KEY", "dev-voice-agent-key")

# Only run thinking after user stops talking: silence for this long = end of utterance
SILENCE_DURATION_SEC = float(os.getenv("VOICE_SILENCE_DURATION_SEC", "1.2"))
SILENCE_ENERGY_THRESHOLD = float(os.getenv("VOICE_SILENCE_ENERGY_THRESHOLD", "0.01"))
MIN_UTTERANCE_SEC = float(os.getenv("VOICE_MIN_UTTERANCE_SEC", "0.3"))

# Default to the bundled "Hey Consultant" Porcupine keyword file if present.
_DEFAULT_KEYWORD_PATH = os.path.join(
    os.path.dirname(__file__),
    "Hey-Consultant_en_wasm_v4_0_0.ppn",
)

# Lazily-created global input stream so we only open the microphone once.
_audio_stream: Optional[sd.InputStream] = None


def _pcm_to_wav(pcm_int16: List[int], sample_rate: int) -> bytes:
    """Build a minimal WAV file from 16-bit mono PCM for STT upload."""
    n = len(pcm_int16)
    data = struct.pack(f"<{n}h", *pcm_int16)
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + len(data),
        b"WAVE",
        b"fmt ",
        16,
        1,
        1,
        sample_rate,
        sample_rate * 2,
        2,
        16,
        b"data",
        len(data),
    )
    return header + data


def _rms(samples: List[int]) -> float:
    """Energy (RMS) of a chunk; used for silence detection."""
    if not samples:
        return 0.0
    total = sum((s / 32768.0) ** 2 for s in samples)
    return (total / len(samples)) ** 0.5


def _record_until_silence_sync(
    sample_rate: int,
    frame_length: int,
    silence_sec: float = SILENCE_DURATION_SEC,
    energy_threshold: float = SILENCE_ENERGY_THRESHOLD,
) -> List[int]:
    """
    Record from the default mic until we see enough continuous silence.
    Returns PCM int16 list. Call from a thread so we don't block the event loop.
    """
    blocks_for_silence = max(1, int(silence_sec * sample_rate / frame_length))
    stream = _ensure_audio_stream(sample_rate, frame_length)
    chunks: List[List[int]] = []
    silence_count = 0
    while True:
        frames, _ = stream.read(frame_length)
        mono = np.asarray(frames[:, 0], dtype=np.int16).tolist()
        chunks.append(mono)
        rms = _rms(mono)
        if rms < energy_threshold:
            silence_count += 1
            if silence_count >= blocks_for_silence:
                break
        else:
            silence_count = 0
    return [s for chunk in chunks for s in chunk]


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


def _play_mp3_bytes(data: bytes) -> None:
    """Play MP3 bytes using system player (afplay on macOS, else ffplay/temp file)."""
    if not data:
        return
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
        f.write(data)
        path = f.name
    try:
        if platform.system() == "Darwin":
            subprocess.run(["afplay", path], check=True, capture_output=True)
        else:
            # Linux: try ffplay if available
            try:
                subprocess.run(
                    ["ffplay", "-nodisp", "-autoexit", "-loglevel", "quiet", path],
                    check=True,
                    capture_output=True,
                )
            except FileNotFoundError:
                print(f"Save response and play manually: {path}")
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


async def _one_turn(
    client: httpx.AsyncClient,
    session_id: str,
    sample_rate: int,
    frame_length: int,
) -> bool:
    """Record until silence, POST /turn, play response. Returns False if session_id missing."""
    if not session_id:
        print("Set VOICE_SESSION_ID to your document session for QA.")
        return False
    loop = asyncio.get_event_loop()
    pcm = await loop.run_in_executor(
        None,
        lambda: _record_until_silence_sync(sample_rate, frame_length),
    )
    min_samples = int(MIN_UTTERANCE_SEC * sample_rate)
    if len(pcm) < min_samples:
        return True
    wav_bytes = _pcm_to_wav(pcm, sample_rate)
    files = {"audio": ("utterance.wav", wav_bytes, "audio/wav")}
    data = {"session_id": session_id}
    resp = await client.post(
        VOICE_TURN_URL,
        headers={"X-API-Key": INTERNAL_API_KEY},
        files=files,
        data=data,
        timeout=60,
    )
    resp.raise_for_status()
    _play_mp3_bytes(resp.content)
    return True


async def conversation_loop(sample_rate: int, frame_length: int) -> None:
    """
    After hotword: play "Ready", then loop — record until user stops talking,
    send one turn (STT → QA → TTS), play response, repeat. Thinking runs only
    when the user is done speaking.
    """
    async with httpx.AsyncClient() as client:
        ready_resp = await client.post(
            VOICE_TTS_URL,
            headers={"X-API-Key": INTERNAL_API_KEY},
            json={"text": "Ready. Ask your question about the document."},
            timeout=15,
        )
        ready_resp.raise_for_status()
        _play_mp3_bytes(ready_resp.content)
    print("Listening. Speak your question, then pause. (Thinking runs after you stop.)")
    async with httpx.AsyncClient() as c:
        while True:
            await _one_turn(c, VOICE_SESSION_ID, sample_rate, frame_length)
            print("Listening for next question...")


async def trigger_voice_flow(sample_rate: int, frame_length: int) -> None:
    """
    Wake word detected: enter continuous voice conversation. Thinking runs
    only when the user stops talking (silence-based end-of-speech).
    """
    await conversation_loop(sample_rate, frame_length)


async def hotword_listener_loop() -> None:
    """
    Idle loop: on hotword, trigger the voice flow (Gemini+Backboard = brain, ElevenLabs = TTS).
    """
    access_key = os.environ["PICOVOICE_ACCESS_KEY"]

    # Prefer an explicit keyword path from the environment, otherwise fall back
    # to the bundled "Hey Consultant" keyword if it exists. As a last resort,
    # use the built-in "porcupine" keyword.
    keyword_path = os.getenv("PORCUPINE_KEYWORD_PATH") or _DEFAULT_KEYWORD_PATH

    if os.path.exists(keyword_path):
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
                await trigger_voice_flow(porcupine.sample_rate, porcupine.frame_length)
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

