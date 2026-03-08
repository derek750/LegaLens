import io
from typing import Any, Dict

import PyPDF2
import docx as python_docx
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.embeddings import FakeEmbeddings
from langchain_community.vectorstores import FAISS


def detect_document_type(text: str) -> str:
    t = text.lower()
    if any(w in t for w in ["non-disclosure", "nda"]):
        return "Non-Disclosure Agreement (NDA)"
    if any(w in t for w in ["employment", "employee", "salary"]):
        return "Employment Contract"
    if any(w in t for w in ["lease", "tenant", "landlord"]):
        return "Residential Lease Agreement"
    if any(w in t for w in ["terms of service", "terms and conditions"]):
        return "Terms of Service"
    if any(w in t for w in ["privacy policy", "personal data", "pipeda"]):
        return "Privacy Policy"
    if any(w in t for w in ["waiver", "release of liability"]):
        return "Liability Waiver"
    if any(w in t for w in ["contractor", "independent contractor"]):
        return "Contractor Agreement"
    return "Legal Contract"


def extract_pdf(data: bytes) -> str:
    reader = PyPDF2.PdfReader(io.BytesIO(data))
    return "".join(p.extract_text() or "" for p in reader.pages).strip()


def extract_pdf_with_pages(data: bytes) -> tuple[str, list[dict]]:
    """Extract text and build a page boundary map so clauses can be pinned to PDF pages."""
    reader = PyPDF2.PdfReader(io.BytesIO(data))
    page_map: list[dict] = []
    full_text = ""
    for i, page in enumerate(reader.pages):
        page_text = page.extract_text() or ""
        start = len(full_text)
        full_text += page_text
        page_map.append({"page": i + 1, "char_start": start, "char_end": len(full_text)})
    return full_text.strip(), page_map


def extract_docx(data: bytes) -> str:
    doc = python_docx.Document(io.BytesIO(data))
    return "\n".join(p.text for p in doc.paragraphs).strip()


def build_faiss(text: str) -> FAISS:
    chunks = RecursiveCharacterTextSplitter(
        chunk_size=512, chunk_overlap=50
    ).split_text(text)
    return FAISS.from_texts(chunks, FakeEmbeddings(size=512))


DocumentStore = Dict[str, Dict[str, Any]]
VectorStore = Dict[str, FAISS]
ResultStore = Dict[str, Dict[str, Any]]
ThreadStore = Dict[str, str]

