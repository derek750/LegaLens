"""
LegalLens — LangGraph Pipeline
Orchestrates Extractor → Analyst → Summarizer; Q&A sub-graph.
"""

from langgraph.graph import StateGraph, END

from app.agents.console_log import log_analysis_result
from app.agents.state import AgentState
from app.agents.extractor import extractor_agent
from app.agents.analyst import analyst_agent
from app.agents.summarizer import summarizer_agent, qa_agent


def should_continue_after_extraction(state: AgentState) -> str:
    """If no clauses found, skip analyst and go to summarizer."""
    clauses = state.get("clauses", [])
    if not clauses:
        return "summarizer"
    return "analyst"


def build_analysis_graph() -> StateGraph:
    """Full document analysis: extractor → analyst → summarizer."""
    graph = StateGraph(AgentState)
    graph.add_node("extractor", extractor_agent)
    graph.add_node("analyst", analyst_agent)
    graph.add_node("summarizer", summarizer_agent)
    graph.set_entry_point("extractor")
    graph.add_conditional_edges(
        "extractor",
        should_continue_after_extraction,
        {"analyst": "analyst", "summarizer": "summarizer"},
    )
    graph.add_edge("analyst", "summarizer")
    graph.add_edge("summarizer", END)
    return graph.compile()


def build_qa_graph() -> StateGraph:
    """Q&A sub-graph: single qa node."""
    graph = StateGraph(AgentState)
    graph.add_node("qa", qa_agent)
    graph.set_entry_point("qa")
    graph.add_edge("qa", END)
    return graph.compile()


_analysis_graph = None
_qa_graph = None


def get_analysis_graph():
    global _analysis_graph
    if _analysis_graph is None:
        _analysis_graph = build_analysis_graph()
    return _analysis_graph


def get_qa_graph():
    global _qa_graph
    if _qa_graph is None:
        _qa_graph = build_qa_graph()
    return _qa_graph


async def run_analysis(
    document_text: str,
    document_name: str,
    document_type: str = "Legal Contract",
) -> AgentState:
    """Run the full 3-agent analysis pipeline on a document."""
    graph = get_analysis_graph()
    initial_state: AgentState = {
        "document_text": document_text,
        "document_name": document_name,
        "document_type": document_type,
        "clauses": [],
        "analyzed_clauses": [],
        "executive_summary": None,
        "top_risks": None,
        "bottom_line": None,
        "overall_risk_score": None,
        "retrieved_chunks": [],
        "qa_question": None,
        "qa_answer": None,
        "errors": [],
        "current_agent": None,
    }
    final_state = await graph.ainvoke(initial_state)
    log_analysis_result(final_state)
    return final_state


async def run_qa(
    state: AgentState,
    question: str,
    retrieved_chunks: list[str],
) -> str:
    """Run the Q&A agent on a user question with retrieved chunks."""
    graph = get_qa_graph()
    qa_state: AgentState = {
        **state,
        "qa_question": question,
        "retrieved_chunks": retrieved_chunks,
        "qa_answer": None,
    }
    result = await graph.ainvoke(qa_state)
    return result.get("qa_answer", "Unable to generate an answer.")
