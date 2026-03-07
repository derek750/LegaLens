import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { DocumentTextIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import Layout from '../components/Layout';
import { listDocuments, getDocumentUrl } from '../api.ts';

function formatBytes(bytes) {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Dashboard() {
    const [documents, setDocuments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [activeTab, setActiveTab] = useState('overview');
    const [viewingId, setViewingId] = useState(null);
    const [viewError, setViewError] = useState('');
    const [consultantMessages, setConsultantMessages] = useState([]);
    const [consultantInput, setConsultantInput] = useState('');
    const [consultantSelectedDocId, setConsultantSelectedDocId] = useState('none');
    const [consultantSending, setConsultantSending] = useState(false);
    const [assistantSpeaking, setAssistantSpeaking] = useState(false);

    useEffect(() => {
        listDocuments()
            .then((data) => setDocuments(data.files || []))
            .catch((err) => setError(err.message))
            .finally(() => setLoading(false));
    }, []);

    const filtered = documents.filter((doc) =>
        doc.filename.toLowerCase().includes(search.toLowerCase())
    );

    const handleView = async (doc) => {
        setViewError('');
        setViewingId(doc.id);
        try {
            const data = await getDocumentUrl(doc.bucket_path);
            if (data.url) {
                window.open(data.url, '_blank', 'noopener');
            } else {
                setViewError('Could not generate a link for this document.');
            }
        } catch (err) {
            setViewError(err.message || 'Failed to open document');
        } finally {
            setViewingId(null);
        }
    };

    const handleConsultantSend = (e) => {
        e.preventDefault();
        const trimmed = consultantInput.trim();
        if (!trimmed) return;

        const selectedDoc =
            consultantSelectedDocId && consultantSelectedDocId !== 'none'
                ? documents.find((d) => d.id === consultantSelectedDocId)
                : null;

        const timestamp = new Date().toISOString();

        const userMessage = {
            id: `${timestamp}-user`,
            role: 'user',
            text: trimmed,
            docContext: selectedDoc
                ? { id: selectedDoc.id, filename: selectedDoc.filename }
                : null,
            createdAt: timestamp,
        };

        setConsultantMessages((prev) => [...prev, userMessage]);
        setConsultantInput('');
        setConsultantSending(true);
        setAssistantSpeaking(true);

        setTimeout(() => {
            const assistantText = selectedDoc
                ? `Placeholder answer using "${selectedDoc.filename}" as context. In the full version, an AI legal assistant would read this document and explain clauses, risks, and negotiation angles.`
                : 'Placeholder answer from your AI legal consultant. In the full version, this would contain a law-aware response tailored to your question.';

            const assistantMessage = {
                id: `${Date.now()}-assistant`,
                role: 'assistant',
                text: assistantText,
                docContext: selectedDoc
                    ? { id: selectedDoc.id, filename: selectedDoc.filename }
                    : null,
                createdAt: new Date().toISOString(),
            };

            setConsultantMessages((prev) => [...prev, assistantMessage]);
            setConsultantSending(false);
            setAssistantSpeaking(false);
        }, 700);
    };

    return (
        <Layout>
            <div className="w-full max-w-6xl mx-auto">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                    <div>
                        <h2 className="text-3xl font-semibold text-[#17282E] tracking-tight">Your documents</h2>
                        <p className="text-sm text-[#604B42] mt-1">Manage and review your previously scanned agreements.</p>
                    </div>

                    <div className="relative">
                            <MagnifyingGlassIcon className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-[#604B42]/60" />
                        <input
                            type="text"
                            placeholder="Search documents..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="pl-10 pr-4 py-2 bg-[#F5F0EC] border border-[#604B42]/30 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#17282E]/40 w-full md:w-64"
                        />
                    </div>
                </div>

                {/* Dashboard tabs */}
                <div className="mb-6 border-b border-[#604B42]/20">
                    <nav className="flex gap-6 text-sm font-medium text-[#604B42]">
                        <button
                            type="button"
                            onClick={() => setActiveTab('overview')}
                            className={`pb-2 border-b-2 transition-colors ${
                                activeTab === 'overview'
                                    ? 'border-[#17282E] text-[#17282E]'
                                    : 'border-transparent text-[#604B42]/70 hover:text-[#17282E]'
                            }`}
                        >
                            Overview
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab('simulate')}
                            className={`pb-2 border-b-2 transition-colors ${
                                activeTab === 'simulate'
                                    ? 'border-[#17282E] text-[#17282E]'
                                    : 'border-transparent text-[#604B42]/70 hover:text-[#17282E]'
                            }`}
                        >
                            Simulate
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab('consultant')}
                            className={`pb-2 border-b-2 transition-colors ${
                                activeTab === 'consultant'
                                    ? 'border-[#17282E] text-[#17282E]'
                                    : 'border-transparent text-[#604B42]/70 hover:text-[#17282E]'
                            }`}
                        >
                            Consultant
                        </button>
                    </nav>
                </div>

                {/* Overview tab */}
                {activeTab === 'overview' && (
                    <>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                            <div className="glass-panel p-6 rounded-2xl flex items-center gap-4 border border-[#604B42]/25 bg-[#F5F0EC]">
                                <div className="w-6 h-6 rounded-full bg-[#C7D9FF] ring-2 ring-[#604B42]/30" />
                                <div>
                                    <p className="text-sm font-medium text-[#604B42]">Total scanned</p>
                                    <h4 className="text-2xl font-semibold text-[#17282E]">{documents.length}</h4>
                                </div>
                            </div>

                            <div className="glass-panel p-6 rounded-2xl flex items-center gap-4 border border-[#604B42]/25 bg-[#F5F0EC]">
                                <div className="w-6 h-6 rounded-full bg-[#F8C7C8] ring-2 ring-[#604B42]/30" />
                                <div>
                                    <p className="text-sm font-medium text-[#604B42]">Clauses flagged</p>
                                    <h4 className="text-2xl font-semibold text-[#17282E]">—</h4>
                                </div>
                            </div>

                            <div className="glass-panel p-6 rounded-2xl flex items-center gap-4 border border-[#604B42]/25 bg-[#F5F0EC]">
                                <div className="w-6 h-6 rounded-full bg-[#C9E8D7] ring-2 ring-[#604B42]/30" />
                                <div>
                                    <p className="text-sm font-medium text-[#604B42]">Clean documents</p>
                                    <h4 className="text-2xl font-semibold text-[#17282E]">—</h4>
                                </div>
                            </div>
                        </div>

                        <div className="glass-panel rounded-2xl overflow-hidden border border-[#604B42]/25 shadow-sm">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-[#F5F0EC] border-b border-[#604B42]/25 text-xs font-semibold text-[#604B42] uppercase tracking-wide">
                                            <th className="py-3 px-6">Document</th>
                                            <th className="py-3 px-6">Uploaded</th>
                                            <th className="py-3 px-6">Size</th>
                                            <th className="py-3 px-6 text-right">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#F5F0EC]">
                                        {loading && (
                                            <tr><td colSpan="4" className="py-12 text-center text-slate-400">Loading…</td></tr>
                                        )}
                                        {error && (
                                            <tr><td colSpan="4" className="py-12 text-center text-red-500">{error}</td></tr>
                                        )}
                                        {!loading && !error && filtered.length === 0 && (
                                            <tr><td colSpan="4" className="py-12 text-center text-slate-400">No documents found.</td></tr>
                                        )}
                                        {filtered.map((doc, index) => (
                                            <motion.tr
                                                key={doc.id}
                                                initial={{ opacity: 0, y: 10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                transition={{ delay: index * 0.1 }}
                                                className="hover:bg-[#F5F0EC] transition-colors group"
                                            >
                                                <td className="py-4 px-6">
                                                    <div className="flex items-center gap-3">
                                                        <DocumentTextIcon className="w-5 h-5 text-[#604B42]/60" />
                                                        <span className="font-medium text-[#17282E] truncate max-w-xs block" title={doc.filename}>
                                                            {doc.filename}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="py-4 px-6 text-[#604B42] text-sm">
                                                    {doc.created_at ? new Date(doc.created_at).toLocaleDateString() : '—'}
                                                </td>
                                                <td className="py-4 px-6 text-[#604B42] text-sm">
                                                    {formatBytes(doc.size_bytes)}
                                                </td>
                                                <td className="py-4 px-6 text-right">
                                                    <div className="flex items-center justify-end gap-3">
                                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border bg-[#F5F0EC] text-[#17282E] border-[#604B42]/40">
                                                            Uploaded
                                                        </span>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleView(doc)}
                                                            className="text-xs font-medium text-[#17282E] hover:text-[#604B42] underline-offset-2 hover:underline disabled:opacity-60"
                                                            disabled={viewingId === doc.id}
                                                        >
                                                            {viewingId === doc.id ? 'Opening…' : 'View'}
                                                        </button>
                                                    </div>
                                                </td>
                                            </motion.tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            <div className="p-4 border-t border-[#604B42]/20 bg-[#F5F0EC] text-center">
                                <div className="flex flex-col items-center gap-2">
                                    {viewError && (
                                        <p className="text-xs text-red-600">{viewError}</p>
                                    )}
                                    <button className="text-sm font-medium text-[#604B42] hover:text-[#17282E] transition-colors">
                                        View All Documents
                                    </button>
                                </div>
                            </div>
                        </div>
                    </>
                )}

                {/* Simulate tab (placeholder) */}
                {activeTab === 'simulate' && (
                    <div className="glass-panel rounded-2xl border border-[#604B42]/25 p-8">
                        <h3 className="text-xl font-semibold text-[#17282E] mb-2">Simulate outcomes</h3>
                        <p className="text-sm text-[#604B42] mb-6 max-w-xl">
                            Choose an agreement from your dashboard and preview possible scenarios if you sign as-is:
                            financial impact, risk exposure, and negotiation levers.
                        </p>
                        <div className="border border-dashed border-[#604B42]/30 rounded-xl p-6 flex flex-col items-center justify-center gap-3 bg-[#F5F0EC]/60">
                            <p className="text-sm text-[#604B42]">
                                Simulation UI coming soon. For now, this is a placeholder area where you’ll select a document and explore outcomes.
                            </p>
                            <button
                                type="button"
                                className="mt-2 px-4 py-2 rounded-full text-sm font-medium bg-[#17282E] text-[#EBE6E3] hover:bg-[#17282E] transition-colors"
                            >
                                Select an agreement to simulate
                            </button>
                        </div>
                    </div>
                )}

                {/* Consultant tab */}
                {activeTab === 'consultant' && (
                    <div className="glass-panel rounded-2xl border border-[#604B42]/25 p-8">
                        <h3 className="text-xl font-semibold text-[#17282E] mb-2">
                            LegaLens consultant
                        </h3>
                        <p className="text-sm text-[#604B42] mb-6 max-w-xl">
                            Chat with a placeholder AI legal assistant. Ask about clauses and
                            trade‑offs, or ground the conversation in one of your uploaded
                            documents.
                        </p>

                        <div className="flex flex-col md:flex-row gap-6 mb-6">
                            <div className="flex-1 text-sm text-[#604B42]">
                                <p>
                                    This is a front‑end prototype. Messages stay on this page only and
                                    are not sent to a real model yet, but the layout is ready for an AI
                                    backend.
                                </p>
                            </div>
                            <div className="w-full md:w-72">
                                <label className="block text-xs font-semibold text-[#604B42] mb-1">
                                    Context document (optional)
                                </label>
                                <select
                                    value={consultantSelectedDocId}
                                    onChange={(e) => setConsultantSelectedDocId(e.target.value)}
                                    className="w-full px-3 py-2 rounded-lg border border-[#604B42]/30 bg-[#F5F0EC] text-sm text-[#17282E] focus:outline-none focus:ring-2 focus:ring-[#17282E]/30"
                                >
                                    <option value="none">No document – general legal question</option>
                                    {documents.map((doc) => (
                                        <option key={doc.id} value={doc.id}>
                                            {doc.filename}
                                        </option>
                                    ))}
                                </select>
                                <p className="mt-1 text-[11px] text-[#604B42]/80">
                                    In the full version, the consultant would read the selected file for
                                    extra context.
                                </p>
                            </div>
                        </div>

                        <div className="flex flex-col md:flex-row gap-6">
                            <div className="w-full md:w-72 flex flex-col items-center gap-4">
                                <div className="relative w-52 h-52 md:w-64 md:h-64 flex items-center justify-center">
                                    <img
                                        src={
                                            assistantSpeaking
                                                ? '/lawyer-talking.png'
                                                : '/lawyer-neutral.png'
                                        }
                                        alt="AI legal consultant avatar"
                                        className="w-full h-full object-contain pointer-events-none select-none"
                                    />
                                </div>
                                <p className="text-xs text-center text-[#604B42] max-w-xs">
                                    Coming soon: speak naturally to this lawyer using real voice via
                                    ElevenLabs, or type your question into the chat on the right.
                                </p>
                            </div>

                            <div className="flex-1 flex flex-col gap-4">
                                <div className="border border-[#604B42]/30 rounded-xl bg-[#F5F0EC]/60 h-80 flex flex-col overflow-hidden">
                                    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                                        {consultantMessages.length === 0 && (
                                            <div className="text-xs text-[#604B42] bg-white/70 border border-dashed border-[#604B42]/30 rounded-lg p-3">
                                                <p className="font-medium mb-1">Try asking:</p>
                                                <ul className="list-disc list-inside space-y-1">
                                                    <li>
                                                        &quot;Is there anything risky about the non‑compete in my latest
                                                        employment agreement?&quot;
                                                    </li>
                                                    <li>
                                                        &quot;What should I look out for in limitation‑of‑liability clauses?&quot;
                                                    </li>
                                                    <li>
                                                        Select a document above, then ask how fair a specific clause is.
                                                    </li>
                                                </ul>
                                            </div>
                                        )}

                                        {consultantMessages.map((msg) => (
                                            <div
                                                key={msg.id}
                                                className={`flex ${
                                                    msg.role === 'user' ? 'justify-end' : 'justify-start'
                                                }`}
                                            >
                                                <div
                                                    className={`max-w-[80%] rounded-2xl px-3 py-2 text-xs ${
                                                        msg.role === 'user'
                                                            ? 'bg-[#17282E] text-[#EBE6E3]'
                                                            : 'bg-white text-[#17282E] border border-[#604B42]/25'
                                                    }`}
                                                >
                                                    {msg.docContext && (
                                                        <p className="text-[10px] mb-1 opacity-70">
                                                            Context: {msg.docContext.filename}
                                                        </p>
                                                    )}
                                                    <p>{msg.text}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="flex flex-col sm:flex-row gap-3 items-stretch">
                                    <button
                                        type="button"
                                        disabled
                                        className="sm:w-56 px-4 py-2 rounded-xl text-xs font-semibold bg-[#17282E] text-[#EBE6E3] shadow-sm border border-[#17282E]/60 opacity-70 cursor-not-allowed"
                                    >
                                        Talk to your lawyer (voice placeholder)
                                    </button>
                                    <p className="flex-1 text-[11px] text-[#604B42]/90">
                                        In the full version, this button will start a real‑time voice
                                        conversation powered by ElevenLabs while the avatar animates as
                                        it speaks. For now, use the text box below.
                                    </p>
                                </div>

                                <form onSubmit={handleConsultantSend} className="flex gap-3 mt-3">
                                    <div className="flex-1">
                                        <input
                                            type="text"
                                            value={consultantInput}
                                            onChange={(e) => setConsultantInput(e.target.value)}
                                            placeholder="Ask about a clause, law, or negotiation angle…"
                                            className="w-full px-3 py-2 rounded-lg border border-[#604B42]/30 bg-[#F5F0EC] text-sm text-[#17282E] focus:outline-none focus:ring-2 focus:ring-[#17282E]/30"
                                        />
                                    </div>
                                    <button
                                        type="submit"
                                        disabled={consultantSending || !consultantInput.trim()}
                                        className="px-4 py-2 rounded-full text-sm font-medium bg-[#17282E] text-[#EBE6E3] hover:bg-[#17282E] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                    >
                                        {consultantSending ? 'Thinking…' : 'Send'}
                                    </button>
                                </form>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </Layout>
    );
}
