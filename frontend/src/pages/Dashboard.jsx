import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { DocumentTextIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import Layout from '../components/Layout';
import { listDocuments } from '../api.ts';

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

    useEffect(() => {
        listDocuments()
            .then((data) => setDocuments(data.files || []))
            .catch((err) => setError(err.message))
            .finally(() => setLoading(false));
    }, []);

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
                            className="pl-10 pr-4 py-2 bg-[#F5F0EC] border border-[#604B42]/30 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#17282E]/40 w-full md:w-64"
                        />
                    </div>
                </div>

                {/* Stats Overview */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div className="glass-panel p-6 rounded-2xl flex items-center gap-4 border border-[#604B42]/25 bg-[#F5F0EC]">
                        <div className="w-5 h-5 rounded-full bg-blue-500 ring-2 ring-[#604B42]/40" />
                        <div>
                            <p className="text-sm font-medium text-[#604B42]">Total scanned</p>
                            <h4 className="text-2xl font-semibold text-[#17282E]">{documents.length}</h4>
                        </div>
                    </div>

                    <div className="glass-panel p-6 rounded-2xl flex items-center gap-4 border border-[#604B42]/25 bg-[#F5F0EC]">
                        <div className="w-5 h-5 rounded-full bg-red-500 ring-2 ring-[#604B42]/40" />
                        <div>
                            <p className="text-sm font-medium text-[#604B42]">Clauses flagged</p>
                            <h4 className="text-2xl font-semibold text-[#17282E]">—</h4>
                        </div>
                    </div>

                    <div className="glass-panel p-6 rounded-2xl flex items-center gap-4 border border-[#604B42]/25 bg-[#F5F0EC]">
                        <div className="w-5 h-5 rounded-full bg-green-500 ring-2 ring-[#604B42]/40" />
                        <div>
                            <p className="text-sm font-medium text-[#604B42]">Clean documents</p>
                            <h4 className="text-2xl font-semibold text-[#17282E]">—</h4>
                        </div>
                    </div>
                </div>

                {/* Document List */}
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
                                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border bg-[#F5F0EC] text-[#17282E] border-[#604B42]/40">
                                                Uploaded
                                            </span>
                                        </td>
                                    </motion.tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="p-4 border-t border-[#604B42]/20 bg-[#F5F0EC] text-center">
                        <button className="text-sm font-medium text-[#604B42] hover:text-[#17282E] transition-colors">
                            View All Documents
                        </button>
                    </div>
                </div>
            </div>
        </Layout>
    );
}
