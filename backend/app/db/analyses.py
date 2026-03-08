"""Persist and retrieve document analysis results (post-pipeline)."""

from app.cache.redis_cache import (
    TTL_ANALYSIS,
    get_cached,
    invalidate_analysis,
    key_analysis,
)
from app.db.client import supabase

TABLE = "document_analyses"


def save_analysis(document_id: str, result: dict) -> dict:
    """
    Upsert analysis for a document. Call after the pipeline completes.
    result must include: document_name, document_type, overall_risk_score,
    executive_summary, top_risks, bottom_line, analyzed_clauses, clause_count.
    """
    row = {
        "document_id": document_id,
        "document_name": result.get("document_name"),
        "document_type": result.get("document_type"),
        "overall_risk_score": result.get("overall_risk_score"),
        "executive_summary": result.get("executive_summary"),
        "top_risks": result.get("top_risks") or [],
        "bottom_line": result.get("bottom_line"),
        "analyzed_clauses": result.get("analyzed_clauses") or [],
        "clause_count": result.get("clause_count", 0),
    }
    r = (
        supabase.table(TABLE)
        .upsert(row, on_conflict="document_id")
        .execute()
    )
    invalidate_analysis(document_id)
    return r.data[0] if r.data else {}


def get_analysis_by_document_id(document_id: str) -> dict | None:
    """Return the latest analysis for a document, or None if not yet analyzed."""
    r = (
        supabase.table(TABLE)
        .select("*")
        .eq("document_id", document_id)
        .limit(1)
        .execute()
    )
    rows = r.data or []
    return rows[0] if rows else None


def get_analysis_by_document_id_cached(document_id: str) -> dict | None:
    """Return analysis for a document with Redis cache."""
    return get_cached(
        key_analysis(document_id),
        lambda: get_analysis_by_document_id(document_id),
        TTL_ANALYSIS,
    )


def get_document_stats(document_ids: list[str]) -> dict:
    """Compute aggregate stats across all analyzed documents for a user."""
    if not document_ids:
        return {"total_scanned": 0, "clauses_flagged": 0, "clean_documents": 0}

    r = (
        supabase.table(TABLE)
        .select("document_id, analyzed_clauses")
        .in_("document_id", document_ids)
        .execute()
    )
    rows = r.data or []

    flagged_severities = {"HIGH", "MEDIUM", "UNKNOWN"}
    total_flagged = 0
    clean_count = 0

    analyzed_doc_ids = set()
    for row in rows:
        analyzed_doc_ids.add(row["document_id"])
        clauses = row.get("analyzed_clauses") or []
        doc_flagged = sum(1 for c in clauses if c.get("severity") in flagged_severities)
        total_flagged += doc_flagged
        if doc_flagged == 0:
            clean_count += 1

    return {
        "total_scanned": len(document_ids),
        "clauses_flagged": total_flagged,
        "clean_documents": clean_count,
    }


def result_from_analysis_row(row: dict) -> dict:
    """Convert a document_analyses row to the pipeline result shape (session_id set by caller)."""
    return {
        "document_name": row.get("document_name"),
        "document_type": row.get("document_type"),
        "overall_risk_score": row.get("overall_risk_score"),
        "executive_summary": row.get("executive_summary"),
        "top_risks": row.get("top_risks") or [],
        "bottom_line": row.get("bottom_line"),
        "analyzed_clauses": row.get("analyzed_clauses") or [],
        "clause_count": row.get("clause_count", 0),
    }
