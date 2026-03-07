import os

from langchain_core.messages import HumanMessage
from langchain_google_genai import ChatGoogleGenerativeAI


def extractor_llm():
    return ChatGoogleGenerativeAI(
        model="gemini-2.0-flash",
        temperature=0.1,
        max_tokens=8192,
        google_api_key=os.environ["GEMINI_KEY_EXTRACTOR"],
    )


def analyst_llm():
    return ChatGoogleGenerativeAI(
        model="gemini-2.0-flash",
        temperature=0.2,
        max_tokens=8192,
        google_api_key=os.environ["GEMINI_KEY_ANALYST"],
    )


def summarizer_llm():
    return ChatGoogleGenerativeAI(
        model="gemini-2.0-flash",
        temperature=0.3,
        max_tokens=2048,
        google_api_key=os.environ["GEMINI_KEY_SUMMARIZER"],
    )


async def call_llm(llm, prompt: str) -> str:
    response = llm.invoke([HumanMessage(content=prompt)])
    return response.content.strip()

