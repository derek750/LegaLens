import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { jsPDF } from 'jspdf';
import Layout from '../components/Layout';
import { useApp } from '../context/AppContext';
import { getEditedText } from '../api.ts';

function escapeHtml(str) {
    return str
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

const HEADER_RE = /^(?:ARTICLE|SECTION|SCHEDULE|PART|EXHIBIT|APPENDIX)\b/i;

function insertBreaks(text) {
    const B = '\u0000';
    return text
        .replace(/\s+(?=\d{1,3}\.\s+[A-Z])/g, B)
        .replace(/\s+(?=\([a-z]+\)\s)/g, B)
        .replace(/\s+(?=(?:ARTICLE|SECTION|SCHEDULE|PART)\s)/gi, B)
        .replace(/\s+(?=(?:WHEREAS|APPENDIX|EXHIBIT)\s)/gi, B)
        .replace(/\s+(?=(?:NOW,?\s*THEREFORE|IN WITNESS WHEREOF|RECITALS?)\b)/gi, B)
        .split(B).map(p => p.trim()).filter(Boolean);
}

function splitLongParagraph(para) {
    const blocks = [];
    let buf = '';
    for (const s of para.split(/(?<=[.!?;])\s+(?=[A-Z(])/)) {
        buf += (buf ? ' ' : '') + s;
        if (buf.length > 500) { blocks.push(buf); buf = ''; }
    }
    if (buf) blocks.push(buf);
    return blocks;
}

function formatParagraph(para) {
    const isHeader = HEADER_RE.test(para) || /^\d{1,3}\.\s+[A-Z]/.test(para);
    if (isHeader) {
        const dotIdx = para.search(/(?<=[.:])\s/);
        if (dotIdx > 0 && dotIdx < 80) {
            const title = para.slice(0, dotIdx + 1).trim();
            const body = para.slice(dotIdx + 1).trim();
            const items = [{ html: `<strong>${escapeHtml(title)}</strong>`, isTitle: true }];
            if (body) items.push({ html: escapeHtml(body), isTitle: false });
            return items;
        }
    }
    if (para.length > 900) {
        return splitLongParagraph(para).map(b => ({ html: escapeHtml(b), isTitle: false }));
    }
    return [{ html: escapeHtml(para), isTitle: false }];
}

function textToDocumentHtml(raw) {
    const text = raw.replace(/\s+/g, ' ').trim();
    if (!text) return '';
    const blocks = insertBreaks(text).flatMap(formatParagraph);
    return blocks
        .map(b => b.isTitle ? `<p class="doc-title">${b.html}</p>` : `<p>${b.html}</p>`)
        .join('');
}

export default function EditDocument() {
    const navigate = useNavigate();
    const { analysisResult, negotiationResult } = useApp();
    const editorRef = useRef(null);

    const [editedText, setEditedText] = useState('');
    const [documentName, setDocumentName] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [replacements, setReplacements] = useState(0);

    useEffect(() => {
        if (!analysisResult?.session_id) return;
        setLoading(true);
        setError('');
        getEditedText(analysisResult.session_id)
            .then((data) => {
                setEditedText(data.edited_text);
                setDocumentName(data.document_name);
                setReplacements(data.replacements);
            })
            .catch((err) => setError(err.message))
            .finally(() => setLoading(false));
    }, [analysisResult]);

    const documentHtml = useMemo(() => {
        if (!editedText) return '';
        return textToDocumentHtml(editedText);
    }, [editedText]);

    const getCurrentText = useCallback(() => {
        if (editorRef.current) return editorRef.current.innerText;
        return editedText;
    }, [editedText]);

    const handleDownload = useCallback(() => {
        const text = getCurrentText();
        const pdf = new jsPDF({ unit: 'pt', format: 'letter' });
        const margin = 56;
        const pageWidth = pdf.internal.pageSize.getWidth() - margin * 2;
        const pageHeight = pdf.internal.pageSize.getHeight();
        const lineHeight = 15;
        let y = margin + 10;

        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(10.5);

        const lines = pdf.splitTextToSize(text, pageWidth);
        for (const line of lines) {
            if (y + lineHeight > pageHeight - margin) {
                pdf.addPage();
                y = margin + 10;
            }
            pdf.text(line, margin, y);
            y += lineHeight;
        }

        const baseName = documentName.replace(/\.[^.]+$/, '');
        pdf.save(`${baseName || 'document'}-edited.pdf`);
    }, [getCurrentText, documentName]);

    if (!analysisResult || !negotiationResult) {
        return (
            <Layout>
                <div className="w-full max-w-6xl mx-auto">
                    <div className="relative">
                        <div className="absolute inset-0 translate-x-[4px] translate-y-[4px] bg-[#17282E]/25" />
                        <div className="relative glass-panel border border-[#604B42]/25 p-12 text-center">
                            <h2 className="text-2xl font-semibold text-[#17282E] mb-3">No negotiation available</h2>
                            <p className="text-sm text-[#604B42] mb-6">
                                Generate a negotiation strategy first to apply edits.
                            </p>
                            <button
                                type="button"
                                onClick={() => navigate('/negotiate')}
                                className="px-6 py-2.5 pixel-button text-sm font-medium bg-[#17282E] text-[#EBE6E3] hover:bg-[#17282E]/90 transition-colors"
                            >
                                Go to Negotiations
                            </button>
                        </div>
                    </div>
                </div>
            </Layout>
        );
    }

    return (
        <Layout>
            <div className="w-full max-w-6xl mx-auto">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
                    <div>
                        <h2 className="text-3xl font-semibold text-[#17282E] tracking-tight">Edited Document</h2>
                        <p className="text-sm text-[#604B42] mt-1">
                            {replacements > 0
                                ? `${replacements} clause${replacements === 1 ? '' : 's'} replaced with fair alternatives. Review and download.`
                                : 'Review your document below and download when ready.'}
                        </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                        <button
                            type="button"
                            onClick={() => navigate('/viewer')}
                            className="px-4 py-2 pixel-button text-sm font-medium border border-[#604B42]/30 text-[#604B42] bg-[#F5F0EC] hover:bg-[#E8E0D9] transition-colors"
                        >
                            Viewer
                        </button>
                        <button
                            type="button"
                            onClick={() => navigate('/negotiate')}
                            className="px-4 py-2 pixel-button text-sm font-medium border border-[#604B42]/30 text-[#604B42] bg-[#F5F0EC] hover:bg-[#E8E0D9] transition-colors"
                        >
                            Negotiations
                        </button>
                        <button
                            type="button"
                            onClick={handleDownload}
                            disabled={loading || !editedText}
                            className="px-5 py-2 pixel-button text-sm font-medium bg-[#17282E] text-[#EBE6E3] hover:bg-[#17282E]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Download PDF
                        </button>
                    </div>
                </div>

                {loading && (
                    <div className="flex items-center justify-center py-24">
                        <div className="text-center">
                            <div className="inline-block w-10 h-10 border-2 border-[#604B42]/30 border-t-[#17282E] rounded-full animate-spin mb-4" />
                            <p className="text-sm text-[#604B42] animate-pulse">Applying negotiated clauses&hellip;</p>
                        </div>
                    </div>
                )}

                {error && !loading && (
                    <div className="relative mb-6">
                        <div className="absolute inset-0 translate-x-[4px] translate-y-[4px] bg-[#17282E]/25" />
                        <div className="relative glass-panel border border-red-300 bg-red-50 p-6 text-center">
                            <p className="text-sm text-red-700">{error}</p>
                        </div>
                    </div>
                )}

                {!loading && editedText && (
                    <div className="flex justify-center">
                        <div className="relative w-full" style={{ maxWidth: 816 }}>
                            <div className="absolute inset-0 translate-x-[5px] translate-y-[5px] bg-[#17282E]/20" />
                            <div className="relative bg-white border border-[#604B42]/25 shadow-lg">
                                <div className="flex items-center justify-between px-5 py-2 bg-[#D9CFC8] border-b border-[#604B42]/25">
                                    <span className="text-xs font-semibold text-[#604B42] uppercase tracking-wide">
                                        {documentName || 'Document'}
                                    </span>
                                    <span className="text-[10px] text-[#604B42]/70">
                                        Click anywhere to edit &bull; Changes reflect in downloaded PDF
                                    </span>
                                </div>
                                <div
                                    ref={editorRef}
                                    contentEditable
                                    suppressContentEditableWarning
                                    className="outline-none document-editor text-[13px] text-[#1a1a1a] leading-[1.85] selection:bg-[#C7D9FF]/50"
                                    style={{
                                        padding: '60px 72px',
                                        minHeight: '90vh',
                                        fontFamily: '"Times New Roman", "Noto Serif", Georgia, serif',
                                    }}
                                    dangerouslySetInnerHTML={{ __html: documentHtml }}
                                />
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <style>{`
                .document-editor p {
                    margin: 0 0 0.7em;
                    text-align: justify;
                }
                .document-editor p:last-child {
                    margin-bottom: 0;
                }
                .document-editor p.doc-title {
                    margin-top: 1.3em;
                    margin-bottom: 0.3em;
                    text-align: left;
                    font-weight: 700;
                    font-size: 14px;
                    text-transform: uppercase;
                    letter-spacing: 0.02em;
                }
                .document-editor p.doc-title:first-child {
                    margin-top: 0;
                }
            `}</style>
        </Layout>
    );
}
