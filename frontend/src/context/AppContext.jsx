import React, { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { listDocuments, getDocumentStats, getDocumentUrl, analyzeStoredDocument, negotiateDocument } from '../api.ts';

const AppContext = createContext(null);

export function AppProvider({ children }) {
    const { isAuthenticated, isLoading: authLoading } = useAuth0();

    const [documents, setDocuments] = useState([]);
    const [docsLoading, setDocsLoading] = useState(false);
    const [docsError, setDocsError] = useState('');
    const [docStats, setDocStats] = useState({ total_scanned: 0, clauses_flagged: 0, clean_documents: 0 });

    const [viewerDoc, setViewerDoc] = useState(null);
    const [viewerUrl, setViewerUrl] = useState('');
    const [viewingId, setViewingId] = useState(null);
    const [viewError, setViewError] = useState('');

    const [analysisLoading, setAnalysisLoading] = useState(false);
    const [analysisProgress, setAnalysisProgress] = useState('');
    const [analysisResult, setAnalysisResult] = useState(null);
    const [analysisError, setAnalysisError] = useState('');

    const [negotiationResult, setNegotiationResult] = useState(null);
    const [negotiationLoading, setNegotiationLoading] = useState(false);
    const [negotiationError, setNegotiationError] = useState('');

    const [consultantMessages, setConsultantMessages] = useState([]);
    const [consultantInput, setConsultantInput] = useState('');
    const [consultantSelectedDocId, setConsultantSelectedDocId] = useState('none');
    const [consultantSending, setConsultantSending] = useState(false);
    const [assistantSpeaking, setAssistantSpeaking] = useState(false);
    const [voiceStatus, setVoiceStatus] = useState('idle');
    const [voiceError, setVoiceError] = useState('');
    const [hotwordListening, setHotwordListening] = useState(false);

    const voiceConversationRef = useRef(null);
    const voiceBackboardThreadIdRef = useRef(null);
    const hotwordRecognizerRef = useRef(null);
    const addConsultantTurnRef = useRef(null);

    const refreshDocuments = useCallback(() => {
        if (!isAuthenticated) return;
        setDocsLoading(true);
        Promise.all([listDocuments(), getDocumentStats()])
            .then(([docsData, statsData]) => {
                setDocuments(docsData.files || []);
                setDocStats(statsData);
            })
            .catch((err) => setDocsError(err.message))
            .finally(() => setDocsLoading(false));
    }, [isAuthenticated]);

    useEffect(() => {
        if (!authLoading && isAuthenticated) {
            refreshDocuments();
        }
    }, [authLoading, isAuthenticated, refreshDocuments]);

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
                try { hotwordRecognizerRef.current.stop(); } catch (e) { /* ignore */ }
                hotwordRecognizerRef.current = null;
            }
        };
    }, []);

    const handleView = useCallback(async (doc, navigate) => {
        setViewError('');
        setViewingId(doc.id);
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
                setViewingId(null);
                return;
            }

            setViewerDoc(doc);
            setViewerUrl(data.url);
            setViewingId(null);

            if (navigate) navigate('/viewer');

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
        }
    }, []);

    const handleNegotiate = useCallback(async () => {
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
    }, [analysisResult]);

    const hasBadClauses = analysisResult?.analyzed_clauses?.some(
        (c) => c.severity === 'HIGH'
    );

    return (
        <AppContext.Provider value={{
            documents, docsLoading, docsError, docStats, refreshDocuments,
            viewerDoc, viewerUrl, viewingId, viewError,
            analysisLoading, analysisProgress, analysisResult, analysisError,
            negotiationResult, negotiationLoading, negotiationError,
            consultantMessages, setConsultantMessages,
            consultantInput, setConsultantInput,
            consultantSelectedDocId, setConsultantSelectedDocId,
            consultantSending, setConsultantSending,
            assistantSpeaking, setAssistantSpeaking,
            voiceStatus, setVoiceStatus,
            voiceError, setVoiceError,
            hotwordListening, setHotwordListening,
            voiceConversationRef, voiceBackboardThreadIdRef,
            hotwordRecognizerRef, addConsultantTurnRef,
            handleView, handleNegotiate, hasBadClauses,
        }}>
            {children}
        </AppContext.Provider>
    );
}

export function useApp() {
    const ctx = useContext(AppContext);
    if (!ctx) throw new Error('useApp must be used within AppProvider');
    return ctx;
}
