"""
Document helpers for the agents flow: type detection and FAISS vector store for RAG.
"""

import os
import logging
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_cohere import CohereEmbeddings
from langchain_community.vectorstores import FAISS

logger = logging.getLogger(__name__)


def detect_document_type(text: str) -> str:
    """Heuristic document type from text content."""
    t = text.lower()
    if any(w in t for w in ["non-disclosure", "confidential information", "nda"]):
        return "Non-Disclosure Agreement (NDA)"
    if any(w in t for w in ["employment", "employee", "employer", "salary"]):
        return "Employment Contract"
    if any(w in t for w in ["lease", "tenant", "landlord", "rent", "premises"]):
        return "Residential Lease Agreement"
    if any(w in t for w in ["terms of service", "terms and conditions"]):
        return "Terms of Service"
    if any(w in t for w in ["privacy policy", "personal data", "gdpr"]):
        return "Privacy Policy"
    if any(w in t for w in ["waiver", "release of liability"]):
        return "Liability Waiver"
    if any(w in t for w in ["contractor", "independent contractor"]):
        return "Contractor Agreement"
    return "Legal Contract"


def build_faiss(text: str):
    """
    Build in-memory FAISS index from document text for RAG retrieval.
    Requires COHERE_API_KEY. Returns FAISS instance or None on failure.
    """
    if not os.environ.get("COHERE_API_KEY"):
        logger.warning("COHERE_API_KEY not set; vector store will not be built.")
        return None
    try:
        splitter = RecursiveCharacterTextSplitter(chunk_size=512, chunk_overlap=50)
        chunks = splitter.split_text(text)
        embeddings = CohereEmbeddings(
            model="embed-english-v3.0",
            cohere_api_key=os.environ["COHERE_API_KEY"],
        )
        return FAISS.from_texts(chunks, embeddings)
    except Exception as e:
        logger.exception("Vector store build failed: %s", e)
        return None
