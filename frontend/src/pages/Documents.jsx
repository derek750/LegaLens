import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { DocumentTextIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import Layout from '../components/Layout';
import { useApp } from '../context/AppContext';

function formatBytes(bytes) {
    if (!bytes) return '\u2014';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Documents() {
    const navigate = useNavigate();
    const { documents, docsLoading, docsError, docStats, viewingId, viewError, handleView } = useApp();
    const [search, setSearch] = useState('');

    const filtered = documents.filter((doc) =>
        doc.filename.toLowerCase().includes(search.toLowerCase())
    );

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
                            className="pixel-input pl-10 pr-4 py-2 bg-[#F5F0EC] w-full md:w-64"
                        />
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div className="relative">
                        <div className="absolute inset-0 translate-x-[3px] translate-y-[3px] bg-[#17282E]/25" />
                        <div className="relative glass-panel p-6 flex items-center gap-4 border border-[#604B42]/25 bg-[#F5F0EC]">
                            <div className="w-6 h-6 bg-[#C7D9FF] ring-2 ring-[#604B42]/30" />
                            <div>
                                <p className="text-sm font-medium text-[#604B42]">Total scanned</p>
                                <h4 className="text-2xl font-semibold text-[#17282E]">{docStats.total_scanned}</h4>
                            </div>
                        </div>
                    </div>
                    <div className="relative">
                        <div className="absolute inset-0 translate-x-[3px] translate-y-[3px] bg-[#17282E]/25" />
                        <div className="relative glass-panel p-6 flex items-center gap-4 border border-[#604B42]/25 bg-[#F5F0EC]">
                            <div className="w-6 h-6 bg-[#F8C7C8] ring-2 ring-[#604B42]/30" />
                            <div>
                                <p className="text-sm font-medium text-[#604B42]">Clauses flagged</p>
                                <h4 className="text-2xl font-semibold text-[#17282E]">{docStats.clauses_flagged}</h4>
                            </div>
                        </div>
                    </div>
                    <div className="relative">
                        <div className="absolute inset-0 translate-x-[3px] translate-y-[3px] bg-[#17282E]/25" />
                        <div className="relative glass-panel p-6 flex items-center gap-4 border border-[#604B42]/25 bg-[#F5F0EC]">
                            <div className="w-6 h-6 bg-[#C9E8D7] ring-2 ring-[#604B42]/30" />
                            <div>
                                <p className="text-sm font-medium text-[#604B42]">Clean documents</p>
                                <h4 className="text-2xl font-semibold text-[#17282E]">{docStats.clean_documents}</h4>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="relative">
                    <div className="absolute inset-0 translate-x-[4px] translate-y-[4px] bg-[#17282E]/25" />
                    <div className="relative glass-panel overflow-hidden border border-[#604B42]/25 shadow-sm">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-[#D9CFC8] border-b border-[#604B42]/25 text-xs font-semibold text-[#604B42] uppercase tracking-wide">
                                        <th className="py-3 px-6">Document</th>
                                        <th className="py-3 px-6">Uploaded</th>
                                        <th className="py-3 px-6">Size</th>
                                        <th className="py-3 px-6 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#F5F0EC]">
                                    {docsLoading && (
                                        <tr><td colSpan="4" className="py-12 text-center text-slate-400">{`Loading\u2026`}</td></tr>
                                    )}
                                    {docsError && (
                                        <tr><td colSpan="4" className="py-12 text-center text-red-500">{docsError}</td></tr>
                                    )}
                                    {!docsLoading && !docsError && filtered.length === 0 && (
                                        <tr><td colSpan="4" className="py-12 text-center text-slate-400">No documents found.</td></tr>
                                    )}
                                    {filtered.map((doc, index) => (
                                        <motion.tr
                                            key={doc.id}
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ delay: index * 0.05 }}
                                            className="hover:bg-[#F5F0EC] transition-colors"
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
                                                {doc.created_at ? new Date(doc.created_at).toLocaleDateString() : '\u2014'}
                                            </td>
                                            <td className="py-4 px-6 text-[#604B42] text-sm">
                                                {formatBytes(doc.size_bytes)}
                                            </td>
                                            <td className="py-4 px-6 text-right">
                                                <div className="flex items-center justify-end gap-3">
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border bg-[#F5F0EC] text-[#17282E] border-[#604B42]/40">
                                                        Uploaded
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleView(doc, navigate)}
                                                        className="text-xs font-medium text-[#17282E] hover:text-[#604B42] underline-offset-2 hover:underline disabled:opacity-60"
                                                        disabled={viewingId === doc.id}
                                                    >
                                                        {viewingId === doc.id ? 'Opening\u2026' : 'View & Analyze'}
                                                    </button>
                                                </div>
                                            </td>
                                        </motion.tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {viewError && (
                            <div className="p-4 border-t border-[#604B42]/20 bg-[#F5F0EC] text-center">
                                <p className="text-xs text-red-600">{viewError}</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </Layout>
    );
}
