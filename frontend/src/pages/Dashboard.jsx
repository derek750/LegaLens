import React, { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { DocumentTextIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { Conversation } from '@elevenlabs/client';
import Layout from '../components/Layout';
import PdfHighlightViewer from '../components/PdfHighlightViewer';
import { listDocuments, getDocumentUrl, analyzeStoredDocument, createVoiceSession, createBackboardThread, voiceThink, addContextDocumentToVoiceThread, negotiateDocument } from '../api.ts';

function formatBytes(bytes) {
    if (!bytes) return '\u2014';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getVoiceStatusVariant(status) {
    const normalized = (status || 'idle').toLowerCase();
    if (normalized === 'idle') {
        return { label: 'idle', colorClass: 'bg-[#FACC6B]' }; // yellow square
    }
    if (normalized === 'connecting') {
        return { label: 'connecting', colorClass: 'bg-[#C7D9FF]' }; // blue square
    }
    if (normalized === 'error') {
        return { label: 'error', colorClass: 'bg-[#F8C7C8]' }; // red/pink square
    }
    return { label: normalized, colorClass: 'bg-[#C9E8D7]' }; // green square for active/other
}

export default function Dashboard() {
    const [documents, setDocuments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [activeTab, setActiveTab] = useState('overview');
    const [viewingId, setViewingId] = useState(null);
    const [viewError, setViewError] = useState('');
    const [viewerDoc, setViewerDoc] = useState(null);
    const [viewerUrl, setViewerUrl] = useState('');
    const [viewerLoading, setViewerLoading] = useState(false);
    const [analysisLoading, setAnalysisLoading] = useState(false);
    const [analysisProgress, setAnalysisProgress] = useState('');
    const [analysisResult, setAnalysisResult] = useState(null);
    const [analysisError, setAnalysisError] = useState('');
    const [consultantMessages, setConsultantMessages] = useState([]);
    const [consultantInput, setConsultantInput] = useState('');
    const [consultantSelectedDocId, setConsultantSelectedDocId] = useState('none');
    const [consultantSending, setConsultantSending] = useState(false);
    const [assistantSpeaking, setAssistantSpeaking] = useState(false);
    const [voiceStatus, setVoiceStatus] = useState('idle');
    const [voiceError, setVoiceError] = useState('');
    const [hotwordListening, setHotwordListening] = useState(true);
    const voiceConversationRef = useRef(null);
    const voiceBackboardThreadIdRef = useRef(null);
    const [negotiationResult, setNegotiationResult] = useState(null);
    const [negotiationLoading, setNegotiationLoading] = useState(false);
    const [negotiationError, setNegotiationError] = useState('');
    const hotwordRecognizerRef = useRef(null);
    const addConsultantTurnRef = useRef(null);

    useEffect(() => {
        listDocuments()
            .then((data) => setDocuments(data.files || []))
            .catch((err) => setError(err.message))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        addConsultantTurnRef.current = (userText, assistantText) => {
            const ts = new Date().toISOString();
            setConsultantMessages((prev) => [
                ...prev,
                { id: `${ts}-user`, role: 'user', text: userText, createdAt: ts },
                { id: `${ts}-asst`, role: 'assistant', text: assistantText, createdAt: ts },
            ]);
        };
        return () => { addConsultantTurnRef.current = null; };
    }, []);

    useEffect(() => {
        return () => {
            if (voiceConversationRef.current) {
                voiceConversationRef.current.endSession().catch(() => {});
            }
            if (hotwordRecognizerRef.current) {
                try {
                    hotwordRecognizerRef.current.stop();
                } catch (e) {
                    // ignore
                }
                hotwordRecognizerRef.current = null;
            }
        };
    }, []);

    // Optional in-browser hotword: say "hey consultant" while on the Consultant tab to start voice.
    useEffect(() => {
        if (activeTab !== 'consultant' || !hotwordListening) {
            if (hotwordRecognizerRef.current) {
                try {
                    hotwordRecognizerRef.current.stop();
                } catch (e) {
                    // ignore
                }
                hotwordRecognizerRef.current = null;
            }
            return;
        }

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            setVoiceError('Hotword requires browser speech recognition (try Chrome on desktop).');
            setHotwordListening(false);
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.onresult = (event) => {
            for (let i = event.resultIndex; i < event.results.length; i += 1) {
                const result = event.results[i];
                if (!result.isFinal) continue;
                const transcript = (result[0]?.transcript || '').toLowerCase();
                if (!transcript) continue;

                const heardHotword =
                    transcript.includes('hey consultant') ||
                    transcript.includes('hey lawyer') ||
                    transcript.includes('talk to my lawyer');

                if (heardHotword) {
                    // eslint-disable-next-line no-console
                    console.log('[hotword] detected phrase in transcript:', transcript);
                    if (!voiceConversationRef.current && voiceStatus !== 'connecting') {
                        // eslint-disable-next-line @typescript-eslint/no-floating-promises
                        handleToggleVoice();
                    }
                }
            }
        };
        recognition.onerror = (event) => {
            // eslint-disable-next-line no-console
            console.error('Hotword recognition error', event);
            setVoiceError('Hotword listener error. Mic permissions or browser settings may be blocking access.');
            setHotwordListening(false);
        };
        recognition.onend = () => {
            if (hotwordListening && activeTab === 'consultant') {
                try {
                    recognition.start();
                } catch (e) {
                    // ignore
                }
            }
        };

        try {
            recognition.start();
            hotwordRecognizerRef.current = recognition;
        } catch (e) {
            setVoiceError('Could not start hotword listener. Check microphone permissions.');
            setHotwordListening(false);
        }

        return () => {
            recognition.onresult = null;
            recognition.onerror = null;
            recognition.onend = null;
            try {
                recognition.stop();
            } catch (e) {
                // ignore
            }
            hotwordRecognizerRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab, hotwordListening, voiceStatus]);

    const filtered = documents.filter((doc) =>
        doc.filename.toLowerCase().includes(search.toLowerCase())
    );

    const handleView = async (doc) => {
        setViewError('');
        setViewingId(doc.id);
        setViewerLoading(true);
        setAnalysisResult(null);
        setAnalysisError('');
        setAnalysisProgress('');
        setNegotiationResult(null);
        setNegotiationError('');
        try {
            const data = await getDocumentUrl(doc.bucket_path);
            if (!data.url) {
                setViewError('Could not generate a link for this document.');
                setViewerDoc(null);
                setViewerUrl('');
                return;
            }

            setViewerDoc(doc);
            setViewerUrl(data.url);
            setActiveTab('viewer');
            setViewingId(null);
            setViewerLoading(false);

            setAnalysisLoading(true);
            setAnalysisProgress('Starting analysis\u2026');
            try {
                const result = await analyzeStoredDocument(doc.bucket_path, (ev) => {
                    if (ev.event === 'progress') setAnalysisProgress(ev.message || '');
                    if (ev.event === 'complete') setAnalysisResult(ev.result);
                });
                setAnalysisResult(result);
                setAnalysisError('');
            } catch (err) {
                setAnalysisError(err.message || 'Analysis failed');
                setAnalysisResult(null);
            } finally {
                setAnalysisLoading(false);
                setAnalysisProgress('');
            }
        } catch (err) {
            setViewError(err.message || 'Failed to open document');
            setViewingId(null);
            setViewerLoading(false);
        }
    };

    const handleNegotiate = async () => {
        if (!analysisResult?.session_id) return;
        setNegotiationLoading(true);
        setNegotiationError('');
        setNegotiationResult(null);
        try {
            const result = await negotiateDocument(analysisResult.session_id);
            setNegotiationResult(result);
        } catch (err) {
            setNegotiationError(err.message || 'Negotiation failed');
        } finally {
            setNegotiationLoading(false);
        }
    };

    const handleConsultantSend = async (e) => {
        e.preventDefault();
        const trimmed = consultantInput.trim();
        if (!trimmed) return;

        let threadId = voiceBackboardThreadIdRef.current;
        if (!threadId) {
            try {
                const backboard = await createBackboardThread('LegaLens Voice Consultant');
                threadId = backboard.thread_id;
                voiceBackboardThreadIdRef.current = threadId;
            } catch (err) {
                setConsultantMessages((prev) => [
                    ...prev,
                    { id: `${Date.now()}-user`, role: 'user', text: trimmed, createdAt: new Date().toISOString() },
                    { id: `${Date.now()}-err`, role: 'assistant', text: 'Could not start conversation. Please try again.', createdAt: new Date().toISOString() },
                ]);
                setConsultantInput('');
                return;
            }
        }

        const timestamp = new Date().toISOString();
        const userMessage = { id: `${timestamp}-user`, role: 'user', text: trimmed, createdAt: timestamp };
        setConsultantMessages((prev) => [...prev, userMessage]);
        setConsultantInput('');
        setConsultantSending(true);
        setAssistantSpeaking(true);

        try {
            const { answer } = await voiceThink({
                thread_id: threadId,
                user_utterance: trimmed,
                session_id: null,
            });
            const assistantMessage = {
                id: `${Date.now()}-assistant`,
                role: 'assistant',
                text: answer || "I couldn\u2019t get an answer for that.",
                createdAt: new Date().toISOString(),
            };
            setConsultantMessages((prev) => [...prev, assistantMessage]);
        } catch (err) {
            const assistantMessage = {
                id: `${Date.now()}-assistant`,
                role: 'assistant',
                text: err?.message || 'Something went wrong. Please try again.',
                createdAt: new Date().toISOString(),
            };
            setConsultantMessages((prev) => [...prev, assistantMessage]);
        } finally {
            setConsultantSending(false);
            setAssistantSpeaking(false);
        }
    };

    const handleToggleVoice = async () => {
        if (voiceConversationRef.current) {
            try {
                await voiceConversationRef.current.endSession();
            } catch (err) {
                // eslint-disable-next-line no-console
                console.error('Failed to end voice session', err);
            } finally {
                voiceConversationRef.current = null;
                setVoiceStatus('idle');
                setAssistantSpeaking(false);
            }
            return;
        }

        try {
            setVoiceError('');
            setVoiceStatus('connecting');

            let threadId = voiceBackboardThreadIdRef.current;
            if (!threadId) {
                let backboard;
                try {
                    backboard = await createBackboardThread('LegaLens Voice Consultant');
                } catch (err) {
                    setVoiceError('Could not create conversation memory. Please try again.');
                    setVoiceStatus('idle');
                    return;
                }
                threadId = backboard.thread_id;
                voiceBackboardThreadIdRef.current = threadId;
            }

            const session = await createVoiceSession();
            const threadIdRef = voiceBackboardThreadIdRef;
            const conversation = await Conversation.startSession({
                agentId: session.agent_id,
                conversationToken: session.webrtc_token,
                connectionType: session.connection_type || 'webrtc',
                onStatusChange: ({ status }) => {
                    setVoiceStatus(status);
                },
                onModeChange: ({ mode }) => {
                    setAssistantSpeaking(mode === 'speaking');
                },
                onError: (message, context) => {
                    // eslint-disable-next-line no-console
                    console.error('ElevenLabs conversation error:', message, context);
                    setVoiceError(message || 'Voice session error');
                    setVoiceStatus('error');
                    voiceConversationRef.current = null;
                    setAssistantSpeaking(false);
                },
                clientTools: {
                    get_legal_answer: async ({ query }) => {
                        const q = typeof query === 'string' ? query : String(query ?? '');
                        const threadId = threadIdRef.current;
                        if (!threadId) return 'No conversation thread. Please try again.';
                        try {
                            const { answer } = await voiceThink({
                                thread_id: threadId,
                                user_utterance: q,
                                session_id: null,
                            });
                            const text = answer || "I couldn\u2019t get an answer for that.";
                            addConsultantTurnRef.current?.(q, text);
                            return text;
                        } catch (err) {
                            const fallback = err?.message || 'Sorry, I could not get an answer right now.';
                            addConsultantTurnRef.current?.(q, fallback);
                            return fallback;
                        }
                    },
                },
            });

            voiceConversationRef.current = conversation;
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error('Failed to start voice session', err);
            setVoiceError(err.message || 'Failed to start voice session');
            setVoiceStatus('idle');
            setAssistantSpeaking(false);
        }
    };

    const hasBadClauses = analysisResult?.analyzed_clauses?.some(
        (c) => c.severity === 'HIGH' || c.severity === 'MEDIUM' || c.severity === 'UNKNOWN'
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
                            onClick={() => viewerDoc && setActiveTab('viewer')}
                            disabled={!viewerDoc}
                            className={`pb-2 border-b-2 transition-colors ${
                                activeTab === 'viewer'
                                    ? 'border-[#17282E] text-[#17282E]'
                                    : 'border-transparent text-[#604B42]/50 hover:text-[#17282E]'
                            } ${!viewerDoc ? 'opacity-40 cursor-not-allowed' : ''}`}
                        >
                            Viewer
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
                            <div className="relative">
                                <div className="absolute inset-0 translate-x-[3px] translate-y-[3px] bg-[#17282E]/25" />
                                <div className="relative glass-panel p-6 flex items-center gap-4 border border-[#604B42]/25 bg-[#F5F0EC]">
                                    <div className="w-6 h-6 bg-[#C7D9FF] ring-2 ring-[#604B42]/30" />
                                    <div>
                                        <p className="text-sm font-medium text-[#604B42]">Total scanned</p>
                                        <h4 className="text-2xl font-semibold text-[#17282E]">{documents.length}</h4>
                                    </div>
                                </div>
                            </div>

                            <div className="relative">
                                <div className="absolute inset-0 translate-x-[3px] translate-y-[3px] bg-[#17282E]/25" />
                                <div className="relative glass-panel p-6 flex items-center gap-4 border border-[#604B42]/25 bg-[#F5F0EC]">
                                    <div className="w-6 h-6 bg-[#F8C7C8] ring-2 ring-[#604B42]/30" />
                                    <div>
                                        <p className="text-sm font-medium text-[#604B42]">Clauses flagged</p>
                                        <h4 className="text-2xl font-semibold text-[#17282E]">{'\u2014'}</h4>
                                    </div>
                                </div>
                            </div>

                            <div className="relative">
                                <div className="absolute inset-0 translate-x-[3px] translate-y-[3px] bg-[#17282E]/25" />
                                <div className="relative glass-panel p-6 flex items-center gap-4 border border-[#604B42]/25 bg-[#F5F0EC]">
                                    <div className="w-6 h-6 bg-[#C9E8D7] ring-2 ring-[#604B42]/30" />
                                    <div>
                                        <p className="text-sm font-medium text-[#604B42]">Clean documents</p>
                                        <h4 className="text-2xl font-semibold text-[#17282E]">{'\u2014'}</h4>
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
                                            <th className="py-3 px-6 text-right">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#F5F0EC]">
                                        {loading && (
                                            <tr><td colSpan="4" className="py-12 text-center text-slate-400">{`Loading\u2026`}</td></tr>
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
                                                            onClick={() => handleView(doc)}
                                                            className="text-xs font-medium text-[#17282E] hover:text-[#604B42] underline-offset-2 hover:underline disabled:opacity-60"
                                                            disabled={viewingId === doc.id}
                                                        >
                                                            {viewingId === doc.id ? 'Opening\u2026' : 'View'}
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
                        </div>
                    </>
                )}

                {/* Viewer tab */}
                {activeTab === 'viewer' && (
                    <div className="relative">
                        <div className="absolute inset-0 translate-x-[4px] translate-y-[4px] bg-[#17282E]/25" />
                        <div className="relative glass-panel border border-[#604B42]/25 p-8">
                            {viewerDoc ? (
                                <>
                                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
                                        <div>
                                            <h3 className="text-xl font-semibold text-[#17282E]">
                                                {viewerDoc.filename}
                                            </h3>
                                            <p className="text-xs text-[#604B42] mt-1">
                                                Predatory clauses are{' '}
                                                <span className="inline-block w-3 h-2 rounded-sm align-middle" style={{ backgroundColor: 'rgba(239,68,68,0.35)' }} />{' '}
                                                highlighted in red, risky clauses in{' '}
                                                <span className="inline-block w-3 h-2 rounded-sm align-middle" style={{ backgroundColor: 'rgba(250,204,21,0.45)' }} />{' '}
                                                yellow.
                                            </p>
                                        </div>
                                        <div className="text-xs text-right text-[#604B42] space-y-1">
                                            <p>
                                                Uploaded:{' '}
                                                {viewerDoc.created_at
                                                    ? new Date(viewerDoc.created_at).toLocaleString()
                                                    : '\u2014'}
                                            </p>
                                            <p>Size: {formatBytes(viewerDoc.size_bytes)}</p>
                                        </div>
                                    </div>

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
                                            <p className="font-semibold text-[#17282E]">
                                                Analysis
                                            </p>
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
                                                                : analysisResult.overall_risk_score === 'MEDIUM'
                                                                    ? 'text-amber-600 font-semibold'
                                                                    : 'text-[#604B42]'
                                                        }>
                                                            {analysisResult.overall_risk_score}
                                                        </span>
                                                        {' \u00b7 '}{analysisResult.clause_count} clauses
                                                    </p>

                                                    {analysisResult.analyzed_clauses?.filter(c => c.severity === 'HIGH' || c.severity === 'MEDIUM' || c.severity === 'UNKNOWN').length > 0 && (
                                                        <div className="border-t border-[#604B42]/20 pt-3">
                                                            <p className="font-semibold text-[#17282E] mb-2">Flagged clauses</p>
                                                            <div className="space-y-2">
                                                                {analysisResult.analyzed_clauses
                                                                    .filter(c => c.severity === 'HIGH' || c.severity === 'MEDIUM' || c.severity === 'UNKNOWN')
                                                                    .map(clause => (
                                                                        <div key={clause.id} className={`p-2 border rounded ${
                                                                            clause.severity === 'HIGH' ? 'border-red-300 bg-red-50'
                                                                            : clause.severity === 'MEDIUM' ? 'border-yellow-300 bg-yellow-50'
                                                                            : 'border-gray-300 bg-gray-50'
                                                                        }`}>
                                                                            <div className="flex items-center gap-1.5 mb-1">
                                                                                <span className={`inline-block w-2 h-2 rounded-full ${
                                                                                    clause.severity === 'HIGH' ? 'bg-red-500'
                                                                                    : clause.severity === 'MEDIUM' ? 'bg-yellow-400'
                                                                                    : 'bg-gray-400'
                                                                                }`} />
                                                                                <span className="font-semibold text-[#17282E]">{clause.type}</span>
                                                                                <span className={`ml-auto text-[10px] font-bold ${
                                                                                    clause.severity === 'HIGH' ? 'text-red-600'
                                                                                    : clause.severity === 'MEDIUM' ? 'text-amber-600'
                                                                                    : 'text-gray-500'
                                                                                }`}>
                                                                                    {clause.severity === 'UNKNOWN' ? 'NEEDS REVIEW' : clause.severity}
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

                                                    {/* Negotiate button: only when bad clauses are found */}
                                                    {hasBadClauses && (
                                                        <div className="border-t border-[#604B42]/20 pt-3">
                                                            <button
                                                                type="button"
                                                                onClick={handleNegotiate}
                                                                disabled={negotiationLoading}
                                                                className="w-full px-4 py-2 pixel-button text-xs font-semibold bg-[#17282E] text-[#EBE6E3] hover:bg-[#17282E]/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                                            >
                                                                {negotiationLoading
                                                                    ? 'Building strategy\u2026'
                                                                    : negotiationResult
                                                                        ? 'Regenerate Negotiation'
                                                                        : 'Generate Negotiation Strategy'}
                                                            </button>
                                                            {negotiationError && (
                                                                <p className="text-[10px] text-red-600 mt-1">{negotiationError}</p>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                            {!analysisResult && !analysisLoading && !analysisError && (
                                                <p className="text-[11px]">Open a document with View to run the analysis pipeline.</p>
                                            )}
                                        </div>
                                    </div>

                                    {/* Negotiation results inline */}
                                    {negotiationLoading && (
                                        <div className="flex items-center justify-center py-12 mt-6">
                                            <div className="text-center">
                                                <div className="inline-block w-8 h-8 border-2 border-[#604B42]/30 border-t-[#17282E] rounded-full animate-spin mb-3" />
                                                <p className="text-sm text-[#604B42] animate-pulse">{`Building negotiation strategy\u2026`}</p>
                                            </div>
                                        </div>
                                    )}

                                    {negotiationResult && (
                                        <div className="mt-6 border border-[#604B42]/25 bg-[#F5F0EC]/50 p-6 space-y-6">
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <h4 className="text-lg font-semibold text-[#17282E]">Negotiation Strategy</h4>
                                                    <p className="text-xs text-[#604B42] mt-0.5">Bad clauses rewritten into fair alternatives you can propose.</p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={handleNegotiate}
                                                    disabled={negotiationLoading}
                                                    className="px-4 py-1.5 text-xs font-medium border border-[#604B42]/30 text-[#604B42] hover:bg-[#F5F0EC] transition-colors rounded disabled:opacity-60"
                                                >
                                                    Regenerate
                                                </button>
                                            </div>

                                            <div className="flex gap-4 text-xs font-medium">
                                                <span className="px-2.5 py-1 bg-red-100 text-red-700 rounded">
                                                    Must Fight: {negotiationResult.must_fight.length}
                                                </span>
                                                <span className="px-2.5 py-1 bg-amber-100 text-amber-700 rounded">
                                                    Should Push Back: {negotiationResult.should_push.length}
                                                </span>
                                                <span className="px-2.5 py-1 bg-gray-100 text-gray-600 rounded">
                                                    Accept If Needed: {negotiationResult.accept_if_needed.length}
                                                </span>
                                            </div>

                                            {[
                                                { label: 'Must Fight', items: negotiationResult.must_fight, borderColor: 'border-red-400', bgColor: 'bg-red-50', badgeColor: 'bg-red-500', textColor: 'text-red-700' },
                                                { label: 'Should Push Back', items: negotiationResult.should_push, borderColor: 'border-amber-400', bgColor: 'bg-amber-50', badgeColor: 'bg-amber-400', textColor: 'text-amber-700' },
                                                { label: 'Accept If Needed', items: negotiationResult.accept_if_needed, borderColor: 'border-gray-300', bgColor: 'bg-gray-50', badgeColor: 'bg-gray-400', textColor: 'text-gray-600' },
                                            ].filter(g => g.items.length > 0).map(group => (
                                                <div key={group.label}>
                                                    <div className="flex items-center gap-2 mb-3">
                                                        <span className={`w-2.5 h-2.5 rounded-full ${group.badgeColor}`} />
                                                        <h4 className={`text-sm font-semibold ${group.textColor}`}>{group.label}</h4>
                                                    </div>
                                                    <div className="space-y-4">
                                                        {group.items.map(clause => (
                                                            <div key={clause.id} className={`border ${group.borderColor} rounded-lg overflow-hidden`}>
                                                                <div className={`px-4 py-2.5 ${group.bgColor} border-b ${group.borderColor}`}>
                                                                    <div className="flex items-center justify-between">
                                                                        <span className="text-sm font-semibold text-[#17282E]">{clause.type}</span>
                                                                        <span className={`text-[10px] font-bold ${group.textColor}`}>{clause.severity}</span>
                                                                    </div>
                                                                </div>
                                                                <div className="p-4 space-y-4">
                                                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                                                        <div>
                                                                            <p className="text-[10px] uppercase font-bold text-red-500 mb-1.5 tracking-wider">Original (Problematic)</p>
                                                                            <div className="text-xs text-[#604B42] bg-red-50/60 border border-red-200 rounded p-3 leading-relaxed">
                                                                                {clause.original_text}
                                                                            </div>
                                                                        </div>
                                                                        <div>
                                                                            <p className="text-[10px] uppercase font-bold text-emerald-600 mb-1.5 tracking-wider">Rewritten (Fair)</p>
                                                                            <div className="text-xs text-[#17282E] bg-emerald-50/60 border border-emerald-200 rounded p-3 leading-relaxed">
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
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className="text-sm text-[#604B42]">
                                    Choose <span className="font-semibold text-[#17282E]">View</span> on a document in the
                                    <span className="font-semibold text-[#17282E]"> Overview</span> tab to open it here inside the app.
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Consultant tab */}
                {activeTab === 'consultant' && (
                    <div className="relative">
                        <div className="absolute inset-0 translate-x-[4px] translate-y-[4px] bg-[#17282E]/25" />
                        <div className="relative glass-panel border border-[#604B42]/25 p-8">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                                <h3 className="text-xl font-semibold text-[#17282E]">
                                    LegaLens consultant
                                </h3>
                                <div className="w-full sm:w-72 sm:shrink-0">
                                    <label className="block text-xs font-semibold text-[#604B42] mb-1">
                                        Context document (optional)
                                    </label>
                                    <select
                                        value={consultantSelectedDocId}
                                        onChange={async (e) => {
                                            const value = e.target.value;
                                            setConsultantSelectedDocId(value);
                                            if (value === 'none') return;

                                            const selectedDoc = documents.find((d) => d.id === value);
                                            if (!selectedDoc || !selectedDoc.bucket_path) {
                                                setVoiceError('Could not load context document.');
                                                return;
                                            }

                                            let threadId = voiceBackboardThreadIdRef.current;
                                            try {
                                                if (!threadId) {
                                                    const backboard = await createBackboardThread('LegaLens Voice Consultant');
                                                    threadId = backboard.thread_id;
                                                    voiceBackboardThreadIdRef.current = threadId;
                                                }
                                                await addContextDocumentToVoiceThread({
                                                    thread_id: threadId,
                                                    bucket_path: selectedDoc.bucket_path,
                                                });
                                            } catch (err) {
                                                // eslint-disable-next-line no-console
                                                console.error('Failed to add context document to voice thread', err);
                                                setVoiceError(err?.message || 'Failed to add document context.');
                                            }
                                        }}
                                        className="pixel-input w-full px-3 py-2 bg-[#F5F0EC] text-sm text-[#17282E]"
                                    >
                                        <option value="none">{`No document \u2013 general legal question`}</option>
                                        {documents.map((doc) => (
                                            <option key={doc.id} value={doc.id}>
                                                {doc.filename}
                                            </option>
                                        ))}
                                    </select>
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
                                        Use voice or type; all messages are saved in the chat.
                                    </p>
                                </div>

                                <div className="flex-1 flex flex-col gap-4">
                                    <div className="border border-[#604B42]/30 bg-[#F5F0EC]/60 h-80 flex flex-col overflow-hidden">
                                        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                                            {consultantMessages.length === 0 && (
                                                <p className="text-xs text-[#604B42]/80 italic">
                                                    Ask a question below or use voice. Your messages and the lawyer's replies appear here.
                                                </p>
                                            )}

                                            {consultantMessages.map((msg) => (
                                                <div
                                                    key={msg.id}
                                                    className={`flex ${
                                                        msg.role === 'user' ? 'justify-end' : 'justify-start'
                                                    }`}
                                                >
                                                    <div
                                                        className={`max-w-[80%] px-3 py-2 text-xs ${
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
                                            onClick={handleToggleVoice}
                                            disabled={voiceStatus === 'connecting'}
                                            className={`sm:w-56 px-4 py-2 pixel-button text-xs font-semibold bg-[#17282E] text-[#EBE6E3] border border-[#17282E]/60 ${
                                                voiceStatus === 'connecting' ? 'opacity-60 cursor-wait' : ''
                                            }`}
                                        >
                                            {voiceConversationRef.current
                                                ? 'End voice conversation'
                                                : voiceStatus === 'connecting'
                                                    ? 'Starting\u2026'
                                                    : 'Talk to your lawyer'}
                                        </button>
                                        <div className="flex-1 text-[11px] text-[#604B42]/90 space-y-1">
                                            <p>
                                                Voice and text both use the same AI; replies appear in the chat above.
                                            </p>
                                            <p className="text-[10px] flex items-center gap-3">
                                                {(() => {
                                                    const { label, colorClass } = getVoiceStatusVariant(voiceStatus);
                                                    return (
                                                        <span className="inline-flex items-center gap-1.5">
                                                            <span className={`w-3 h-3 ${colorClass} ring-2 ring-[#604B42]/30`} />
                                                            <span>Status: {label}</span>
                                                        </span>
                                                    );
                                                })()}
                                                {assistantSpeaking && (
                                                    <span className="inline-flex items-center gap-1.5">
                                                        <span className="w-3 h-3 bg-[#C7D9FF] ring-2 ring-[#604B42]/30" />
                                                        <span>speaking</span>
                                                    </span>
                                                )}
                                            </p>
                                            <div className="mt-1">
                                                <label className="inline-flex items-center gap-2 cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        checked={hotwordListening}
                                                        onChange={(e) => setHotwordListening(e.target.checked)}
                                                        className="rounded border-[#604B42]/40"
                                                    />
                                                    <span>
                                                        Enable &quot;hey consultant&quot; hotword while this tab is open
                                                    </span>
                                                </label>
                                            </div>
                                            {voiceError && (
                                                <p className="text-[10px] text-red-600">
                                                    {voiceError}
                                                </p>
                                            )}
                                        </div>
                                    </div>

                                    <form onSubmit={handleConsultantSend} className="flex gap-3 mt-3">
                                        <div className="flex-1">
                                            <input
                                                type="text"
                                                value={consultantInput}
                                                onChange={(e) => setConsultantInput(e.target.value)}
                                                placeholder="Ask about a clause, law, or negotiation angle\u2026"
                                                className="pixel-input w-full px-3 py-2 bg-[#F5F0EC] text-sm text-[#17282E]"
                                            />
                                        </div>
                                        <button
                                            type="submit"
                                            disabled={consultantSending || !consultantInput.trim()}
                                            className="px-4 py-2 pixel-button text-sm font-medium bg-[#17282E] text-[#EBE6E3] hover:bg-[#17282E] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                        >
                                            {consultantSending ? 'Thinking\u2026' : 'Send'}
                                        </button>
                                    </form>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </Layout>
    );
}
