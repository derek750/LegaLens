"""
Pretty-print analysis results to the console for readability.
"""

from app.agents.state import AgentState


def log_analysis_result(state: AgentState) -> None:
    """Print a readable summary of the pipeline result to the console."""
    doc_name = state.get("document_name") or "Document"
    doc_type = state.get("document_type") or "Legal Contract"
    overall = state.get("overall_risk_score") or "—"
    summary = state.get("executive_summary") or ""
    top_risks = state.get("top_risks") or []
    bottom_line = state.get("bottom_line") or ""
    analyzed = state.get("analyzed_clauses", [])
    errors = state.get("errors", [])

    high = sum(1 for c in analyzed if c.get("severity") == "HIGH")
    med = sum(1 for c in analyzed if c.get("severity") == "MEDIUM")
    low = sum(1 for c in analyzed if c.get("severity") == "LOW")

    sep = "=" * 70
    print()
    print(sep)
    print("  LEGALLENS — ANALYSIS RESULT")
    print(sep)
    print(f"  Document: {doc_name}")
    print(f"  Type:     {doc_type}")
    print(f"  Overall risk: {overall}")
    print()
    if summary:
        print("  — Executive summary —")
        for line in summary.strip().split("\n"):
            print(f"    {line.strip()}")
        print()
    if top_risks:
        print("  — Top risks —")
        for i, risk in enumerate(top_risks[:5], 1):
            print(f"    {i}. {risk}")
        print()
    if bottom_line:
        print("  — Bottom line —")
        print(f"    {bottom_line}")
        print()
    print("  — Clause counts —")
    print(f"    HIGH: {high}   MEDIUM: {med}   LOW: {low}   (total: {len(analyzed)})")
    print()
    if analyzed:
        print("  — Analyzed clauses (type | severity | plain English) —")
        for c in analyzed[:15]:  # cap so console stays readable
            severity = c.get("severity", "?")
            clause_type = c.get("type", "?")
            plain = (c.get("plain_english") or "")[:120]
            if len(plain) >= 120:
                plain = plain + "..."
            print(f"    [{severity}] {clause_type}")
            print(f"        {plain}")
            tip = (c.get("negotiation_tip") or "")[:100]
            if tip:
                print(f"        Tip: {tip}...")
            print()
        if len(analyzed) > 15:
            print(f"    ... and {len(analyzed) - 15} more clauses.")
        print()
    if errors:
        print("  — Errors —")
        for e in errors:
            print(f"    • {e}")
        print()
    print(sep)
    print()
