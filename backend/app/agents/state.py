"""
LegalLens — Shared Agent State
================================
Single state object that flows through the LangGraph pipeline.
"""

from typing import TypedDict, Annotated, Optional
import operator


class Clause(TypedDict):
    """A single clause extracted from the document."""
    id: str
    type: str
    raw_text: str
    location: str


class AnalyzedClause(TypedDict):
    """A clause after the Analyst agent has processed it."""
    id: str
    type: str
    raw_text: str
    location: str
    severity: str
    severity_reason: str
    plain_english: str
    baseline_comparison: str
    negotiation_tip: str


class AgentState(TypedDict):
    """
    Full pipeline state. Flows through:
      Extractor → Analyst → Summarizer
    """
    document_text: str
    document_name: str
    document_type: str
    clauses: Annotated[list[Clause], operator.add]
    analyzed_clauses: Annotated[list[AnalyzedClause], operator.add]
    executive_summary: Optional[str]
    top_risks: Optional[list[str]]
    bottom_line: Optional[str]
    overall_risk_score: Optional[str]
    retrieved_chunks: Annotated[list[str], operator.add]
    qa_question: Optional[str]
    qa_answer: Optional[str]
    errors: Annotated[list[str], operator.add]
    current_agent: Optional[str]
