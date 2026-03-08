import asyncio
import os
import re as _re

from langchain_core.messages import HumanMessage
from langchain_google_genai import ChatGoogleGenerativeAI


class GeminiQuotaExceededError(Exception):
    """Raised when Gemini API returns 429 RESOURCE_EXHAUSTED (quota/billing limit)."""


def extractor_llm():
    return ChatGoogleGenerativeAI(
        model="gemini-2.5-flash",
        temperature=0.1,
        max_tokens=8192,
        google_api_key=os.environ["GEMINI_KEY_EXTRACTOR"],
    )


def analyst_llm():
    return ChatGoogleGenerativeAI(
        model="gemini-2.5-flash",
        temperature=0.2,
        max_tokens=8192,
        google_api_key=os.environ["GEMINI_KEY_ANALYST"],
    )


def summarizer_llm():
    return ChatGoogleGenerativeAI(
        model="gemini-2.5-flash",
        temperature=0.3,
        max_tokens=2048,
        google_api_key=os.environ["GEMINI_KEY_SUMMARIZER"],
    )


def _extract_retry_delay(err_str: str) -> float:
    """Try to parse the server-recommended retry delay from the error message."""
    m = _re.search(r"retry\s+in\s+([\d.]+)\s*s", err_str, _re.IGNORECASE)
    if m:
        return min(float(m.group(1)), 90.0)
    return 45.0


async def call_llm(llm, prompt: str, retries: int = 2) -> str:
    """
    Invoke the LLM with automatic retry for 429 / rate-limit errors.
    Waits the server-recommended delay (or 45 s) between attempts.
    After all retries are exhausted, raises GeminiQuotaExceededError.
    """
    last_exc = None
    for attempt in range(1 + retries):
        try:
            response = llm.invoke([HumanMessage(content=prompt)])
            return response.content.strip()
        except Exception as e:
            err_str = str(e).upper()
            is_quota = "429" in err_str or "RESOURCE_EXHAUSTED" in err_str or "QUOTA" in err_str
            if not is_quota:
                raise
            last_exc = e
            if attempt < retries:
                delay = _extract_retry_delay(str(e))
                print(f"  -> Rate limited (attempt {attempt + 1}/{1 + retries}), waiting {delay:.0f}s …")
                await asyncio.sleep(delay)

    raise GeminiQuotaExceededError(
        "Gemini API quota exceeded. Check your plan and billing at "
        "https://ai.google.dev/gemini-api/docs/rate-limits or try again later."
    ) from last_exc

