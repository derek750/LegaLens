import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { DocumentTextIcon, CheckBadgeIcon, ExclamationTriangleIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
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
                        <h2 className="text-3xl font-bold text-gray-900 tracking-tight">Your Documents</h2>
                        <p className="text-gray-500 mt-1">Manage and review your previously scanned agreements.</p>
                    </div>

                    <div className="relative">
                        <MagnifyingGlassIcon className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search documents..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="pl-10 pr-4 py-2 bg-white/60 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/50 w-full md:w-64 glass-panel"
                        />
                    </div>
                </div>

                {/* Stats Overview */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div className="glass-panel p-6 rounded-2xl flex items-center gap-4 border border-white/60">
                        <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center text-blue-600">
                            <DocumentTextIcon className="w-6 h-6" />
                        </div>
                        <div>
                            <p className="text-sm font-medium text-gray-500">Total Scanned</p>
                            <h4 className="text-2xl font-bold text-gray-900">{documents.length}</h4>
                        </div>
                    </div>

                    <div className="glass-panel p-6 rounded-2xl flex items-center gap-4 border border-white/60">
                        <div className="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center text-red-600">
                            <ExclamationTriangleIcon className="w-6 h-6" />
                        </div>
                        <div>
                            <p className="text-sm font-medium text-gray-500">Clauses Flagged</p>
                            <h4 className="text-2xl font-bold text-gray-900">—</h4>
                        </div>
                    </div>

                    <div className="glass-panel p-6 rounded-2xl flex items-center gap-4 border border-white/60">
                        <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center text-green-600">
                            <CheckBadgeIcon className="w-6 h-6" />
                        </div>
                        <div>
                            <p className="text-sm font-medium text-gray-500">Clean Documents</p>
                            <h4 className="text-2xl font-bold text-gray-900">—</h4>
                        </div>
                    </div>
                </div>

                {/* Document List */}
                <div className="glass-panel rounded-2xl overflow-hidden border border-white/60 shadow-sm">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-slate-50/50 border-b border-slate-200 text-sm font-semibold text-slate-600">
                                    <th className="py-4 px-6">Document Name</th>
                                    <th className="py-4 px-6">Date Uploaded</th>
                                    <th className="py-4 px-6">Size</th>
                                    <th className="py-4 px-6 text-right">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
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
                                        className="hover:bg-slate-50/50 transition-colors group"
                                    >
                                        <td className="py-4 px-6">
                                            <div className="flex items-center gap-3">
                                                <DocumentTextIcon className="w-5 h-5 text-slate-400" />
                                                <span className="font-medium text-slate-900 truncate max-w-xs block" title={doc.filename}>
                                                    {doc.filename}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="py-4 px-6 text-slate-500 text-sm">
                                            {doc.created_at ? new Date(doc.created_at).toLocaleDateString() : '—'}
                                        </td>
                                        <td className="py-4 px-6 text-slate-500 text-sm">
                                            {formatBytes(doc.size_bytes)}
                                        </td>
                                        <td className="py-4 px-6 text-right">
                                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border bg-blue-50 text-blue-700 border-blue-200">
                                                Uploaded
                                            </span>
                                        </td>
                                    </motion.tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="p-4 border-t border-slate-100 bg-slate-50/30 text-center">
                        <button className="text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors">
                            View All Documents
                        </button>
                    </div>
                </div>
            </div>
        </Layout>
    );
}
