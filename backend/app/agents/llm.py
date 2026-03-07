import os

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


async def call_llm(llm, prompt: str) -> str:
    """
    One pipeline run uses multiple Gemini calls: validator (1) + extractor (1)
    + analyst (ceil(clauses/5) batches) + summarizer (1). Quota errors are
    raised as GeminiQuotaExceededError so we fail fast instead of retrying.
    """
    try:
        response = llm.invoke([HumanMessage(content=prompt)])
        return response.content.strip()
    except Exception as e:
        err_str = str(e).upper()
        if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str or "QUOTA" in err_str:
            raise GeminiQuotaExceededError(
                "Gemini API quota exceeded. Check your plan and billing at "
                "https://ai.google.dev/gemini-api/docs/rate-limits or try again later."
            ) from e
        raise

