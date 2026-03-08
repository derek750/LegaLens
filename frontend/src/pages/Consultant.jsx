import React, { useEffect, useCallback, useRef, useState } from 'react';
import { Conversation } from '@elevenlabs/client';
import Layout from '../components/Layout';
import { useApp } from '../context/AppContext';
import { createVoiceSession, createBackboardThread, voiceThink, textToSpeech, addContextDocumentToVoiceThread } from '../api.ts';

function getVoiceStatusVariant(status) {
    const normalized = (status || 'idle').toLowerCase();
    if (normalized === 'idle') return { label: 'idle', colorClass: 'bg-[#FACC6B]' };
    if (normalized === 'connecting') return { label: 'connecting', colorClass: 'bg-[#C7D9FF]' };
    if (normalized === 'error') return { label: 'error', colorClass: 'bg-[#F8C7C8]' };
    return { label: normalized, colorClass: 'bg-[#C9E8D7]' };
}

export default function ConsultantPage() {
    const {
        documents,
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
    } = useApp();

    const [contextLoading, setContextLoading] = useState(false);
    const ttsAudioRef = useRef(null);

    const speakText = useCallback(async (text) => {
        if (ttsAudioRef.current) {
            ttsAudioRef.current.pause();
            ttsAudioRef.current = null;
        }
        setAssistantSpeaking(true);
        try {
            const blob = await textToSpeech(text);
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            ttsAudioRef.current = audio;
            audio.onended = () => {
                setAssistantSpeaking(false);
                URL.revokeObjectURL(url);
                ttsAudioRef.current = null;
            };
            audio.onerror = () => {
                setAssistantSpeaking(false);
                URL.revokeObjectURL(url);
                ttsAudioRef.current = null;
            };
            await audio.play();
        } catch (_err) {
            setAssistantSpeaking(false);
        }
    }, [setAssistantSpeaking]);

    useEffect(() => {
        return () => {
            if (ttsAudioRef.current) {
                ttsAudioRef.current.pause();
                ttsAudioRef.current = null;
            }
        };
    }, []);

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
            } catch (_err) {
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
        setConsultantMessages((prev) => [...prev, { id: `${timestamp}-user`, role: 'user', text: trimmed, createdAt: timestamp }]);
        setConsultantInput('');
        setConsultantSending(true);

        try {
            const { answer } = await voiceThink({ thread_id: threadId, user_utterance: trimmed, session_id: null });
            const replyText = answer || "I couldn\u2019t get an answer for that.";
            setConsultantMessages((prev) => [...prev, {
                id: `${Date.now()}-assistant`, role: 'assistant',
                text: replyText,
                createdAt: new Date().toISOString(),
            }]);
            speakText(replyText);
        } catch (err) {
            setConsultantMessages((prev) => [...prev, {
                id: `${Date.now()}-assistant`, role: 'assistant',
                text: err?.message || 'Something went wrong. Please try again.',
                createdAt: new Date().toISOString(),
            }]);
        } finally {
            setConsultantSending(false);
        }
    };

    const handleToggleVoice = async () => {
        if (voiceConversationRef.current) {
            try { await voiceConversationRef.current.endSession(); } catch (_e) { /* ignore */ }
            voiceConversationRef.current = null;
            setVoiceStatus('idle');
            setAssistantSpeaking(false);
            return;
        }

        try {
            setVoiceError('');
            setVoiceStatus('connecting');

            let threadId = voiceBackboardThreadIdRef.current;
            if (!threadId) {
                try {
                    const backboard = await createBackboardThread('LegaLens Voice Consultant');
                    threadId = backboard.thread_id;
                    voiceBackboardThreadIdRef.current = threadId;
                } catch (_err) {
                    setVoiceError('Could not create conversation memory. Please try again.');
                    setVoiceStatus('idle');
                    return;
                }
            }

            const session = await createVoiceSession();
            const threadIdRef = voiceBackboardThreadIdRef;
            const conversation = await Conversation.startSession({
                agentId: session.agent_id,
                conversationToken: session.webrtc_token,
                connectionType: session.connection_type || 'webrtc',
                onStatusChange: ({ status }) => setVoiceStatus(status),
                onModeChange: ({ mode }) => setAssistantSpeaking(mode === 'speaking'),
                onError: (message) => {
                    setVoiceError(message || 'Voice session error');
                    setVoiceStatus('error');
                    voiceConversationRef.current = null;
                    setAssistantSpeaking(false);
                },
                clientTools: {
                    get_legal_answer: async ({ query }) => {
                        const q = typeof query === 'string' ? query : String(query ?? '');
                        const tid = threadIdRef.current;
                        if (!tid) return 'No conversation thread. Please try again.';
                        try {
                            const { answer } = await voiceThink({ thread_id: tid, user_utterance: q, session_id: null });
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
            setVoiceError(err.message || 'Failed to start voice session');
            setVoiceStatus('idle');
            setAssistantSpeaking(false);
        }
    };

    // Hotword detection
    useEffect(() => {
        if (!hotwordListening) {
            if (hotwordRecognizerRef.current) {
                try { hotwordRecognizerRef.current.stop(); } catch (_e) { /* ignore */ }
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
                const heardHotword = transcript.includes('hey consultant') || transcript.includes('hey lawyer') || transcript.includes('talk to my lawyer');
                if (heardHotword && !voiceConversationRef.current && voiceStatus !== 'connecting') {
                    handleToggleVoice();
                }
            }
        };
        recognition.onerror = (event) => {
            const err = event?.error || '';
            if (err === 'no-speech' || err === 'aborted') return;
            setVoiceError(`Hotword listener error: ${err || 'unknown'}`);
            setHotwordListening(false);
        };
        recognition.onend = () => {
            if (hotwordListening && hotwordRecognizerRef.current === recognition) {
                try { recognition.start(); } catch (_e) { /* ignore */ }
            }
        };

        try {
            recognition.start();
            hotwordRecognizerRef.current = recognition;
        } catch (_e) {
            setVoiceError('Could not start hotword listener.');
            setHotwordListening(false);
        }

        return () => {
            recognition.onresult = null;
            recognition.onerror = null;
            recognition.onend = null;
            try { recognition.stop(); } catch (_e) { /* ignore */ }
            hotwordRecognizerRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hotwordListening, voiceStatus]);

    return (
        <Layout>
            <div className="w-full max-w-6xl mx-auto">
                <div className="relative">
                    <div className="absolute inset-0 translate-x-[4px] translate-y-[4px] bg-[#17282E]/25" />
                    <div className="relative glass-panel border border-[#604B42]/25 p-8">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                            <h3 className="text-xl font-semibold text-[#17282E]">LegaLens Consultant</h3>
                            <div className="w-full sm:w-72 sm:shrink-0">
                                <label className="block text-xs font-semibold text-[#604B42] mb-1">
                                    Context document (optional)
                                </label>
                                <select
                                    value={consultantSelectedDocId}
                                    disabled={contextLoading}
                                    onChange={async (e) => {
                                        const value = e.target.value;
                                        setConsultantSelectedDocId(value);
                                        if (value === 'none') return;
                                        const selectedDoc = documents.find((d) => d.id === value);
                                        if (!selectedDoc?.bucket_path) {
                                            setVoiceError('Could not load context document.');
                                            return;
                                        }
                                        setContextLoading(true);
                                        let threadId = voiceBackboardThreadIdRef.current;
                                        try {
                                            if (!threadId) {
                                                const backboard = await createBackboardThread('LegaLens Voice Consultant');
                                                threadId = backboard.thread_id;
                                                voiceBackboardThreadIdRef.current = threadId;
                                            }
                                            await addContextDocumentToVoiceThread({ thread_id: threadId, bucket_path: selectedDoc.bucket_path });
                                        } catch (err) {
                                            setVoiceError(err?.message || 'Failed to add document context.');
                                        } finally {
                                            setContextLoading(false);
                                        }
                                    }}
                                    className={`pixel-input w-full px-3 py-2 bg-[#F5F0EC] text-sm text-[#17282E] ${contextLoading ? 'opacity-60 cursor-not-allowed' : ''}`}
                                >
                                    <option value="none">{`No document \u2013 general legal question`}</option>
                                    {documents.map((doc) => (
                                        <option key={doc.id} value={doc.id}>{doc.filename}</option>
                                    ))}
                                </select>
                                {contextLoading && (
                                    <p className="text-[10px] text-[#604B42] mt-1 animate-pulse">Extracting document context\u2026</p>
                                )}
                            </div>
                        </div>

                        <div className="flex flex-col md:flex-row gap-6">
                            <div className="w-full md:w-72 flex flex-col items-center gap-4">
                                <div className="relative w-52 h-52 md:w-64 md:h-64 flex items-center justify-center">
                                    <img
                                        src={assistantSpeaking ? '/lawyer-talking.png' : '/lawyer-neutral.png'}
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
                                                Ask a question below or use voice. Your messages and the lawyer&apos;s replies appear here.
                                            </p>
                                        )}
                                        {consultantMessages.map((msg) => (
                                            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                                <div className={`max-w-[80%] px-3 py-2 text-xs ${
                                                    msg.role === 'user'
                                                        ? 'bg-[#17282E] text-[#EBE6E3]'
                                                        : 'bg-white text-[#17282E] border border-[#604B42]/25'
                                                }`}>
                                                    {msg.docContext && (
                                                        <p className="text-[10px] mb-1 opacity-70">Context: {msg.docContext.filename}</p>
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
                                        <p>Voice and text both use the same AI; replies appear in the chat above.</p>
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
                                                <span>Enable &quot;hey consultant&quot; hotword</span>
                                            </label>
                                        </div>
                                        {voiceError && <p className="text-[10px] text-red-600">{voiceError}</p>}
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
            </div>
        </Layout>
    );
}
