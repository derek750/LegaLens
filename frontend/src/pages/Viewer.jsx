import React from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import PdfHighlightViewer from '../components/PdfHighlightViewer';
import { useApp } from '../context/AppContext';

function formatBytes(bytes) {
    if (!bytes) return '\u2014';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Viewer() {
    const navigate = useNavigate();
    const {
        viewerDoc, viewerUrl,
        analysisLoading, analysisProgress, analysisResult, analysisError,
        negotiationLoading, negotiationResult, negotiationError,
        hasBadClauses, handleNegotiate,
    } = useApp();

    const onNegotiate = async () => {
        await handleNegotiate();
        navigate('/negotiate');
    };

    if (!viewerDoc) {
        return (
            <Layout>
                <div className="w-full max-w-6xl mx-auto">
                    <div className="relative">
                        <div className="absolute inset-0 translate-x-[4px] translate-y-[4px] bg-[#17282E]/25" />
                        <div className="relative glass-panel border border-[#604B42]/25 p-12 text-center">
                            <h2 className="text-2xl font-semibold text-[#17282E] mb-3">No document selected</h2>
                            <p className="text-sm text-[#604B42] mb-6">
                                Go to <span className="font-semibold text-[#17282E]">Documents</span> and click <span className="font-semibold text-[#17282E]">View & Analyze</span> on a document.
                            </p>
                            <button
                                type="button"
                                onClick={() => navigate('/documents')}
                                className="px-6 py-2.5 pixel-button text-sm font-medium bg-[#17282E] text-[#EBE6E3] hover:bg-[#17282E]/90 transition-colors"
                            >
                                Go to Documents
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
                <div className="relative">
                    <div className="absolute inset-0 translate-x-[4px] translate-y-[4px] bg-[#17282E]/25" />
                    <div className="relative glass-panel border border-[#604B42]/25 p-8">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
                            <div>
                                <h3 className="text-xl font-semibold text-[#17282E]">
                                    {viewerDoc.filename}
                                </h3>
                                <p className="text-xs text-[#604B42] mt-1">
                                    Risky clauses are{' '}
                                    <span className="inline-block w-3 h-2 rounded-sm align-middle" style={{ backgroundColor: 'rgba(239,68,68,0.35)' }} />{' '}
                                    highlighted in red.
                                </p>
                            </div>
                            <div className="flex items-center gap-4">
                                <div className="text-xs text-right text-[#604B42] space-y-1">
                                    <p>
                                        Uploaded:{' '}
                                        {viewerDoc.created_at
                                            ? new Date(viewerDoc.created_at).toLocaleString()
                                            : '\u2014'}
                                    </p>
                                    <p>Size: {formatBytes(viewerDoc.size_bytes)}</p>
                                </div>
                                {/* Fixed negotiate button at top-right */}
                                {hasBadClauses && !analysisLoading && (
                                    <button
                                        type="button"
                                        onClick={onNegotiate}
                                        disabled={negotiationLoading}
                                        className="px-5 py-2.5 pixel-button text-sm font-semibold bg-[#17282E] text-[#EBE6E3] hover:bg-[#17282E]/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
                                    >
                                        {negotiationLoading
                                            ? 'Building strategy\u2026'
                                            : negotiationResult
                                                ? 'View Negotiation'
                                                : 'Generate Negotiation'}
                                    </button>
                                )}
                            </div>
                        </div>

                        {negotiationError && (
                            <p className="text-xs text-red-600 mb-3">{negotiationError}</p>
                        )}

                        <div className="flex flex-col lg:flex-row gap-6">
                            <div className="flex-1 h-[650px] border border-[#604B42]/30 bg-white overflow-hidden">
                                {viewerUrl ? (
                                    <PdfHighlightViewer
                                        url={viewerUrl}
                                        clauses={analysisResult?.analyzed_clauses}
                                        className="w-full h-full"
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-sm text-[#604B42] px-6 text-center">
                                        {`Loading document\u2026`}
                                    </div>
                                )}
                            </div>

                            <div className="w-full lg:w-80 border border-[#604B42]/30 bg-[#F5F0EC]/80 px-4 py-3 text-xs text-[#604B42] overflow-y-auto max-h-[650px] space-y-3">
                                <p className="font-semibold text-[#17282E]">Analysis</p>
                                {analysisLoading && (
                                    <p className="text-[#604B42] animate-pulse">{analysisProgress || 'Running pipeline\u2026'}</p>
                                )}
                                {analysisError && (
                                    <p className="text-red-600">{analysisError}</p>
                                )}
                                {analysisResult && !analysisLoading && (
                                    <div className="space-y-3">
                                        <p className="font-medium text-[#17282E]">{analysisResult.bottom_line}</p>
                                        <p className="text-[11px]">{analysisResult.executive_summary}</p>
                                        <p>
                                            <span className="font-medium">Risk: </span>
                                            <span className={
                                                analysisResult.overall_risk_score === 'HIGH' || analysisResult.overall_risk_score === 'CRITICAL'
                                                    ? 'text-red-600 font-semibold'
                                                    : 'text-[#604B42]'
                                            }>
                                                {analysisResult.overall_risk_score}
                                            </span>
                                            {' \u00b7 '}{analysisResult.clause_count} clauses
                                        </p>

                                        {analysisResult.analyzed_clauses?.filter(c => c.severity === 'HIGH').length > 0 && (
                                            <div className="border-t border-[#604B42]/20 pt-3">
                                                <p className="font-semibold text-[#17282E] mb-2">Flagged clauses</p>
                                                <div className="space-y-2">
                                                    {analysisResult.analyzed_clauses
                                                        .filter(c => c.severity === 'HIGH')
                                                        .map(clause => (
                                                            <div key={clause.id} className="p-2 border rounded border-red-300 bg-red-50">
                                                                <div className="flex items-center gap-1.5 mb-1">
                                                                    <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
                                                                    <span className="font-semibold text-[#17282E]">{clause.type}</span>
                                                                    <span className="ml-auto text-[10px] font-bold text-red-600">
                                                                        {clause.severity}
                                                                        {clause.page_start ? ` \u00b7 p.${clause.page_start}` : ''}
                                                                    </span>
                                                                </div>
                                                                {clause.plain_english && clause.plain_english !== 'N/A' && <p className="text-[11px] text-[#604B42] mb-1">{clause.plain_english}</p>}
                                                                {clause.severity_reason && clause.severity_reason !== 'N/A' && <p className="text-[10px] text-[#604B42]/80 italic">{clause.severity_reason}</p>}
                                                                {clause.negotiation_tip && clause.negotiation_tip !== 'N/A' && (
                                                                    <p className="text-[10px] text-[#17282E] mt-1"><span className="font-semibold">Tip:</span> {clause.negotiation_tip}</p>
                                                                )}
                                                            </div>
                                                        ))}
                                                </div>
                                            </div>
                                        )}

                                        {analysisResult.top_risks?.length > 0 && (
                                            <div className="border-t border-[#604B42]/20 pt-3">
                                                <p className="font-semibold text-[#17282E] mb-1">Top risks</p>
                                                <ul className="list-disc list-inside space-y-0.5">
                                                    {analysisResult.top_risks.map((r, i) => (
                                                        <li key={i}>{r}</li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}
                                    </div>
                                )}
                                {!analysisResult && !analysisLoading && !analysisError && (
                                    <p className="text-[11px]">Open a document from Documents to run the analysis pipeline.</p>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </Layout>
    );
}
