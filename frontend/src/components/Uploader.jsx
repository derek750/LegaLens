import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { DocumentPlusIcon, DocumentTextIcon, CheckCircleIcon, ArrowPathIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { useAuth0 } from '@auth0/auth0-react';
import { uploadToAgents, runAnalysisStream } from '../api.ts';

const Uploader = () => {
    const { isAuthenticated, loginWithRedirect } = useAuth0();
    const [file, setFile] = useState(null);
    const [isHovering, setIsHovering] = useState(false);
    const [isScanning, setIsScanning] = useState(false);
    const [simulatedProgress, setSimulatedProgress] = useState(0);
    const [scanComplete, setScanComplete] = useState(false);
    const [uploadError, setUploadError] = useState("");
    const [sessionId, setSessionId] = useState(null);
    const [documentName, setDocumentName] = useState("");
    const [documentType, setDocumentType] = useState("");
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analysisResult, setAnalysisResult] = useState(null);
    const fileInputRef = useRef(null);

    const handleDragEnter = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsHovering(true);
    };

    const handleDragLeave = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsHovering(false);
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsHovering(false);

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            setFile(e.dataTransfer.files[0]);
        }
    };

    const handleFileInput = (e) => {
        if (e.target.files && e.target.files.length > 0) {
            setFile(e.target.files[0]);
        }
    };

    const initiateScan = async () => {
        setUploadError("");
        if (!isAuthenticated) {
            setUploadError("Please log in to scan documents.");
            return;
        }
        setIsScanning(true);
        setSimulatedProgress(0);
        setAnalysisResult(null);

        try {
            const data = await uploadToAgents(file);
            setSessionId(data.session_id);
            setDocumentName(data.document_name || file.name);
            setDocumentType(data.document_type || "Legal Contract");
        } catch (err) {
            setIsScanning(false);
            setUploadError(err.message);
            return;
        }

        const interval = setInterval(() => {
            setSimulatedProgress(prev => {
                if (prev >= 100) {
                    clearInterval(interval);
                    setTimeout(() => {
                        setIsScanning(false);
                        setScanComplete(true);
                    }, 600);
                    return 100;
                }
                return prev + Math.floor(Math.random() * 12) + 1;
            });
        }, 400);
    };

    const handleViewDetailedReport = async () => {
        if (!sessionId) return;
        setUploadError("");
        setIsAnalyzing(true);
        try {
            const result = await runAnalysisStream(sessionId);
            setAnalysisResult(result);
        } catch (err) {
            setUploadError(err.message || "Analysis failed.");
        } finally {
            setIsAnalyzing(false);
        }
    };

    const resetUploader = () => {
        setFile(null);
        setScanComplete(false);
        setSimulatedProgress(0);
        setUploadError("");
        setSessionId(null);
        setAnalysisResult(null);
    };

    return (
        <div className="w-full max-w-2xl mx-auto flex flex-col items-center">
            {/* Introduction text */}
            <div className="text-center mb-10 w-full">
                <h2 className="text-3xl md:text-5xl font-extrabold text-gray-900 mb-6 leading-tight tracking-tight">
                    Find Predatory Clauses before you <span className="text-transparent bg-clip-text bg-linear-to-r from-blue-600 to-indigo-500">Sign.</span>
                </h2>
            </div>

            {/* Main Upload Area */}
            <AnimatePresence mode="wait">
                {!file ? (
                    <motion.div
                        key="upload-zone"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className={`w-full relative shadow-xl rounded-3xl p-10 flex flex-col items-center justify-center text-center transition-all duration-300 ease-out border-2 border-dashed
              ${isHovering
                                ? 'border-blue-500 bg-blue-50/80 scale-[1.02]'
                                : 'border-slate-300 bg-white/60 hover:border-blue-400 hover:bg-slate-50/80 glass-panel cursor-pointer'
                            }
            `}
                        onDragEnter={handleDragEnter}
                        onDragOver={handleDragEnter}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleFileInput}
                            className="hidden"
                            accept=".pdf,.doc,.docx"
                        />

                        <div className={`p-5 rounded-full mb-6 transition-colors duration-300 ${isHovering ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500'}`}>
                            <DocumentPlusIcon className="w-12 h-12" />
                        </div>

                        <h3 className="text-xl font-semibold text-slate-800 mb-2">
                            Browse files or drag and drop
                        </h3>
                        <p className="text-slate-500 max-w-sm mb-4">
                            Supported formats: PDF, DOC, DOCX. Maximum file size: 25MB. All files are securely processed and immediately deleted.
                        </p>
                        {!isAuthenticated && (
                            <p className="text-sm text-blue-600 font-medium">
                                Sign in or create an account to scan and save documents to your dashboard.
                            </p>
                        )}
                    </motion.div>
                ) : (
                    <motion.div
                        key="active-file"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="w-full bg-white shadow-xl rounded-3xl p-8 border border-slate-200"
                    >
                        {/* File Info */}
                        <div className="flex items-start gap-4 p-4 rounded-2xl bg-slate-50 border border-slate-100 mb-6">
                            <div className="p-3 bg-blue-100 text-blue-600 rounded-xl relative">
                                <DocumentTextIcon className="w-8 h-8" />
                                {scanComplete && (
                                    <motion.div
                                        initial={{ scale: 0 }}
                                        animate={{ scale: 1 }}
                                        className="absolute -top-2 -right-2 bg-green-500 text-white rounded-full p-0.5"
                                    >
                                        <CheckCircleIcon className="w-5 h-5" />
                                    </motion.div>
                                )}
                            </div>
                            <div className="flex-1 overflow-hidden flex flex-col justify-center">
                                <h4 className="font-semibold text-slate-800 truncate" title={file.name}>
                                    {file.name}
                                </h4>
                                <p className="text-sm text-slate-500">
                                    {(file.size / 1024 / 1024).toFixed(2)} MB
                                </p>
                            </div>

                            {!isScanning && !scanComplete && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); resetUploader(); }}
                                    className="text-slate-400 hover:text-red-500 p-2 transition-colors rounded-lg hover:bg-slate-100"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                                        <path fillRule="evenodd" d="M5.47 5.47a.75.75 0 011.06 0L12 10.94l5.47-5.47a.75.75 0 111.06 1.06L13.06 12l5.47 5.47a.75.75 0 11-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 01-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 010-1.06z" clipRule="evenodd" />
                                    </svg>
                                </button>
                            )}
                        </div>

                        {uploadError && (
                            <div className="mb-6 p-4 bg-red-50 text-red-700 border border-red-200 rounded-lg text-sm">
                                {uploadError}
                            </div>
                        )}

                        {/* Scanning progress UI */}
                        <AnimatePresence>
                            {isScanning && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={{ opacity: 0, height: 0 }}
                                    className="mb-6 overflow-hidden"
                                >
                                    <div className="flex justify-between text-sm mb-2">
                                        <span className="font-medium text-blue-700 flex items-center gap-2">
                                            <ArrowPathIcon className="w-4 h-4 animate-spin" />
                                            Scanning for clauses...
                                        </span>
                                        <span className="text-slate-500 font-medium">{Math.min(simulatedProgress, 100)}%</span>
                                    </div>
                                    <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                                        <motion.div
                                            className="bg-blue-600 h-full rounded-full w-fullorigin-left"
                                            initial={{ width: 0 }}
                                            animate={{ width: `${Math.min(simulatedProgress, 100)}%` }}
                                            transition={{ ease: "linear" }}
                                        />
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Scan Complete State */}
                        {scanComplete && !analysisResult && (
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="mb-8 p-5 bg-green-50 text-green-800 border-l-4 border-green-400 rounded-r-lg"
                            >
                                <div className="flex items-start gap-3">
                                    <CheckCircleIcon className="w-6 h-6 shrink-0 mt-0.5 text-green-500" />
                                    <div>
                                        <h5 className="font-bold">Upload complete</h5>
                                        <p className="text-sm mt-1">Document is ready. Click &quot;View Detailed Report&quot; to run the full analysis pipeline (extract clauses, score risk, summarize).</p>
                                    </div>
                                </div>
                            </motion.div>
                        )}

                        {/* Action Buttons */}
                        <div className="flex flex-col sm:flex-row gap-3">
                            {!scanComplete ? (
                                isAuthenticated ? (
                                    <button
                                        onClick={initiateScan}
                                        disabled={isScanning}
                                        className={`flex-1 py-3 px-6 rounded-xl font-semibold shadow-md transition-all ${isScanning
                                            ? 'bg-blue-400 text-white cursor-not-allowed opacity-90'
                                            : 'bg-blue-600 hover:bg-blue-700 text-white hover:shadow-lg active:scale-[0.98]'
                                            } flex items-center justify-center gap-2`}
                                    >
                                        {isScanning ? (
                                            'Analyzing text...'
                                        ) : (
                                            'Scan for Predatory Clauses'
                                        )}
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => loginWithRedirect({ appState: { returnTo: '/' } })}
                                        className="flex-1 py-3 px-6 rounded-xl font-semibold bg-gray-900 hover:bg-gray-800 text-white shadow-md hover:shadow-lg transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                                    >
                                        Sign in to scan documents
                                    </button>
                                )
                            ) : (
                                <>
                                    <button
                                        onClick={handleViewDetailedReport}
                                        disabled={isAnalyzing}
                                        className={`flex-1 py-3 px-6 rounded-xl font-semibold shadow-md transition-all active:scale-[0.98] flex items-center justify-center gap-2 ${isAnalyzing ? 'bg-blue-400 text-white cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}
                                    >
                                        {isAnalyzing ? (
                                            <>
                                                <ArrowPathIcon className="w-5 h-5 animate-spin" />
                                                Running analysis...
                                            </>
                                        ) : (
                                            'View Detailed Report'
                                        )}
                                    </button>
                                    <button
                                        onClick={resetUploader}
                                        disabled={isAnalyzing}
                                        className="py-3 px-6 rounded-xl font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all active:scale-[0.98] disabled:opacity-50"
                                    >
                                        Scan Another
                                    </button>
                                </>
                            )}
                        </div>

                        {/* Detailed Report (after pipeline runs) */}
                        {analysisResult && (
                            <motion.div
                                initial={{ opacity: 0, y: 16 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="mt-8 pt-8 border-t border-slate-200"
                            >
                                <h4 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                                    <DocumentTextIcon className="w-5 h-5 text-blue-600" />
                                    Detailed Report — {analysisResult.document_name}
                                </h4>
                                <div className="flex flex-wrap gap-2 mb-4">
                                    <span className="px-3 py-1 rounded-full text-sm font-medium bg-slate-100 text-slate-700">
                                        {analysisResult.document_type}
                                    </span>
                                    <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                                        analysisResult.overall_risk_score === 'HIGH' || analysisResult.overall_risk_score === 'CRITICAL' ? 'bg-red-100 text-red-800' :
                                        analysisResult.overall_risk_score === 'MEDIUM' ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'
                                    }`}>
                                        Risk: {analysisResult.overall_risk_score ?? '—'}
                                    </span>
                                </div>
                                {analysisResult.executive_summary && (
                                    <div className="mb-6 p-4 bg-slate-50 rounded-xl">
                                        <h5 className="font-semibold text-slate-700 mb-2">Executive summary</h5>
                                        <p className="text-slate-600 text-sm leading-relaxed whitespace-pre-line">{analysisResult.executive_summary}</p>
                                    </div>
                                )}
                                {analysisResult.bottom_line && (
                                    <div className="mb-6 p-4 bg-amber-50 border-l-4 border-amber-400 rounded-r-xl">
                                        <h5 className="font-semibold text-amber-900 mb-1">Bottom line</h5>
                                        <p className="text-amber-800 text-sm">{analysisResult.bottom_line}</p>
                                    </div>
                                )}
                                {analysisResult.top_risks && analysisResult.top_risks.length > 0 && (
                                    <div className="mb-6">
                                        <h5 className="font-semibold text-slate-700 mb-2 flex items-center gap-2">
                                            <ExclamationTriangleIcon className="w-5 h-5 text-amber-500" />
                                            Top risks
                                        </h5>
                                        <ul className="space-y-2">
                                            {analysisResult.top_risks.map((risk, i) => (
                                                <li key={i} className="text-sm text-slate-600 pl-4 border-l-2 border-slate-200">{risk}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                                {analysisResult.analyzed_clauses && analysisResult.analyzed_clauses.length > 0 && (
                                    <div>
                                        <h5 className="font-semibold text-slate-700 mb-2">Clauses analyzed ({analysisResult.analyzed_clauses.length})</h5>
                                        <div className="space-y-4 max-h-96 overflow-y-auto pr-2">
                                            {analysisResult.analyzed_clauses.map((clause, i) => (
                                                <div key={clause.id ?? i} className="p-4 rounded-xl border border-slate-200 bg-white">
                                                    <div className="flex items-center gap-2 mb-2">
                                                        <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
                                                            clause.severity === 'HIGH' ? 'bg-red-100 text-red-800' :
                                                            clause.severity === 'MEDIUM' ? 'bg-yellow-100 text-yellow-800' : 'bg-slate-100 text-slate-700'
                                                        }`}>
                                                            {clause.severity}
                                                        </span>
                                                        <span className="text-sm font-medium text-slate-700">{clause.type}</span>
                                                        {clause.location && <span className="text-xs text-slate-400">— {clause.location}</span>}
                                                    </div>
                                                    {clause.plain_english && <p className="text-sm text-slate-600 mb-2">{clause.plain_english}</p>}
                                                    {clause.negotiation_tip && (
                                                        <p className="text-xs text-blue-700 bg-blue-50 p-2 rounded">Tip: {clause.negotiation_tip}</p>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {analysisResult.errors && analysisResult.errors.length > 0 && (
                                    <div className="mt-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
                                        {analysisResult.errors.join(' ')}
                                    </div>
                                )}
                            </motion.div>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default Uploader;
