import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { useApp } from '../context/AppContext';

export default function Negotiate() {
    const navigate = useNavigate();
    const {
        analysisResult, negotiationResult, negotiationLoading, negotiationError,
        handleNegotiate, hasBadClauses,
    } = useApp();

    useEffect(() => {
        if (!analysisResult) return;
        if (!negotiationResult && !negotiationLoading && !negotiationError) {
            handleNegotiate();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [analysisResult]);

    if (!analysisResult || !hasBadClauses) {
        return (
            <Layout>
                <div className="w-full max-w-6xl mx-auto">
                    <div className="relative">
                        <div className="absolute inset-0 translate-x-[4px] translate-y-[4px] bg-[#17282E]/25" />
                        <div className="relative glass-panel border border-[#604B42]/25 p-12 text-center">
                            <h2 className="text-2xl font-semibold text-[#17282E] mb-3">No analysis available</h2>
                            <p className="text-sm text-[#604B42] mb-6">
                                Analyze a document first from the Viewer to generate negotiation strategies.
                            </p>
                            <button
                                type="button"
                                onClick={() => navigate('/viewer')}
                                className="px-6 py-2.5 pixel-button text-sm font-medium bg-[#17282E] text-[#EBE6E3] hover:bg-[#17282E]/90 transition-colors"
                            >
                                Go to Viewer
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
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h2 className="text-3xl font-semibold text-[#17282E] tracking-tight">Negotiation Strategy</h2>
                        <p className="text-sm text-[#604B42] mt-1">Bad clauses rewritten into fair alternatives you can propose.</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={() => navigate('/viewer')}
                            className="px-4 py-2 pixel-button text-sm font-medium border border-[#604B42]/30 text-[#604B42] bg-[#F5F0EC] hover:bg-[#E8E0D9] transition-colors"
                        >
                            Back to Viewer
                        </button>
                        {negotiationResult && (
                            <button
                                type="button"
                                onClick={() => navigate('/edit')}
                                className="px-5 py-2 pixel-button text-sm font-medium bg-[#17282E] text-[#EBE6E3] hover:bg-[#17282E]/90 transition-colors"
                            >
                                Apply &amp; Edit Document
                            </button>
                        )}
                    </div>
                </div>

                {negotiationLoading && (
                    <div className="flex items-center justify-center py-24">
                        <div className="text-center">
                            <div className="inline-block w-10 h-10 border-2 border-[#604B42]/30 border-t-[#17282E] rounded-full animate-spin mb-4" />
                            <p className="text-sm text-[#604B42] animate-pulse">{`Building negotiation strategy\u2026`}</p>
                        </div>
                    </div>
                )}

                {negotiationError && !negotiationLoading && (
                    <div className="relative mb-6">
                        <div className="absolute inset-0 translate-x-[4px] translate-y-[4px] bg-[#17282E]/25" />
                        <div className="relative glass-panel border border-red-300 bg-red-50 p-6 text-center">
                            <p className="text-sm text-red-700 mb-4">{negotiationError}</p>
                            <button
                                type="button"
                                onClick={handleNegotiate}
                                className="px-5 py-2 pixel-button text-sm font-medium bg-[#17282E] text-[#EBE6E3] hover:bg-[#17282E]/90 transition-colors"
                            >
                                Try Again
                            </button>
                        </div>
                    </div>
                )}

                {negotiationResult && (
                    <div className="space-y-6">
                        <div className="flex gap-3 text-xs font-medium">
                            <span className="px-2.5 py-1 bg-red-100 text-red-700 border border-red-200">
                                Must Fight: {negotiationResult.must_fight.length}
                            </span>
                            <span className="px-2.5 py-1 bg-amber-100 text-amber-700 border border-amber-200">
                                Should Push Back: {negotiationResult.should_push.length}
                            </span>
                            <span className="px-2.5 py-1 bg-[#F5F0EC] text-[#604B42] border border-[#604B42]/25">
                                Accept If Needed: {negotiationResult.accept_if_needed.length}
                            </span>
                        </div>

                        {[
                            { label: 'Must Fight', items: negotiationResult.must_fight, accent: 'border-red-400', headerBg: 'bg-red-50', badgeColor: 'bg-red-500', textColor: 'text-red-700' },
                            { label: 'Should Push Back', items: negotiationResult.should_push, accent: 'border-amber-400', headerBg: 'bg-amber-50', badgeColor: 'bg-amber-400', textColor: 'text-amber-700' },
                            { label: 'Accept If Needed', items: negotiationResult.accept_if_needed, accent: 'border-[#604B42]/30', headerBg: 'bg-[#F5F0EC]', badgeColor: 'bg-[#604B42]/50', textColor: 'text-[#604B42]' },
                        ].filter(g => g.items.length > 0).map(group => (
                            <div key={group.label}>
                                <div className="flex items-center gap-2 mb-3">
                                    <span className={`w-2.5 h-2.5 ${group.badgeColor}`} />
                                    <h4 className={`text-sm font-semibold ${group.textColor}`}>{group.label}</h4>
                                </div>
                                <div className="space-y-4">
                                    {group.items.map(clause => (
                                        <div key={clause.id} className="relative">
                                            <div className="absolute inset-0 translate-x-[3px] translate-y-[3px] bg-[#17282E]/20" />
                                            <div className={`relative border ${group.accent} bg-white overflow-hidden`}>
                                                <div className={`px-4 py-2.5 ${group.headerBg} border-b ${group.accent}`}>
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-sm font-semibold text-[#17282E]">{clause.type}</span>
                                                        <span className={`text-[10px] font-bold ${group.textColor}`}>{clause.severity}</span>
                                                    </div>
                                                </div>
                                                <div className="p-4 space-y-4">
                                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                                        <div>
                                                            <p className="text-[10px] uppercase font-bold text-red-500 mb-1.5 tracking-wider">Original (Problematic)</p>
                                                            <div className="text-xs text-[#604B42] bg-red-50/60 border border-red-200 p-3 leading-relaxed">
                                                                {clause.original_text}
                                                            </div>
                                                        </div>
                                                        <div>
                                                            <p className="text-[10px] uppercase font-bold text-emerald-600 mb-1.5 tracking-wider">Rewritten (Fair)</p>
                                                            <div className="text-xs text-[#17282E] bg-emerald-50/60 border border-emerald-200 p-3 leading-relaxed">
                                                                {clause.rewritten_clause}
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="border-t border-[#604B42]/10 pt-3 space-y-2.5">
                                                        <div>
                                                            <p className="text-[10px] uppercase font-bold text-[#604B42]/60 mb-1 tracking-wider">What to Say</p>
                                                            <p className="text-xs text-[#17282E] italic leading-relaxed">&ldquo;{clause.negotiation_script}&rdquo;</p>
                                                        </div>
                                                        <div className="flex flex-col sm:flex-row gap-3">
                                                            <div className="flex-1">
                                                                <p className="text-[10px] uppercase font-bold text-[#604B42]/60 mb-1 tracking-wider">Your Leverage</p>
                                                                <p className="text-xs text-[#604B42]">{clause.leverage}</p>
                                                            </div>
                                                            <div className="flex-1">
                                                                <p className="text-[10px] uppercase font-bold text-[#604B42]/60 mb-1 tracking-wider">Fallback Position</p>
                                                                <p className="text-xs text-[#604B42]">{clause.fallback_position}</p>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </Layout>
    );
}
