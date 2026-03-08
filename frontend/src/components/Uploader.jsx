import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { DocumentPlusIcon, DocumentTextIcon, CheckCircleIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { useAuth0 } from '@auth0/auth0-react';
import { useNavigate } from 'react-router-dom';
import { uploadDocument } from '../api.ts';

const AnimatedHighlight = ({ text, highlightColor, delayOffset = 0 }) => (
    <span className="inline-block">
        {text.split('').map((char, index) => (
            <motion.span
                key={index}
                className="inline-block"
                initial={{ color: '#17282E', backgroundColor: 'rgba(0,0,0,0)' }}
                animate={{ backgroundColor: highlightColor }}
                transition={{
                    duration: 1.5,
                    delay: delayOffset + index * 0.12,
                    ease: 'easeOut',
                }}
            >
                {char === ' ' ? '\u00A0' : char}
            </motion.span>
        ))}
    </span>
);

const Uploader = () => {
    const { isAuthenticated, loginWithRedirect } = useAuth0();
    const navigate = useNavigate();
    const [file, setFile] = useState(null);
    const [isHovering, setIsHovering] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadComplete, setUploadComplete] = useState(false);
    const [uploadError, setUploadError] = useState("");
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

    const initiateUpload = async () => {
        setUploadError("");
        if (!isAuthenticated) {
            setUploadError("Please log in to upload documents.");
            return;
        }
        setIsUploading(true);

        try {
            await uploadDocument(file);
            setIsUploading(false);
            setUploadComplete(true);
        } catch (err) {
            setIsUploading(false);
            setUploadError(err.message);
        }
    };

    const resetUploader = () => {
        setFile(null);
        setUploadComplete(false);
        setUploadError("");
    };

    return (
        <div className="w-full max-w-2xl mx-auto flex flex-col items-center">
            {/* Introduction text */}
            <div className="text-center mb-10 w-full">
                <h2 className="text-3xl md:text-5xl font-semibold text-[#17282E] mb-6 leading-tight tracking-tight">
                    Find{' '}
                    <AnimatedHighlight text="predatory" highlightColor="rgba(248, 113, 113, 0.6)" />{' '}
                    clauses before you sign, then{' '}<AnimatedHighlight text="negotiate" highlightColor="#C9E8D7" />.
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
                        className={`w-full relative p-10 flex flex-col items-center justify-center text-center transition-all duration-300 ease-out border-2 border-dashed
              ${
                  isHovering
                      ? 'border-[#17282E] bg-[#17282E]/5 scale-[1.02]'
                      : 'border-[#604B42]/30 bg-[#EBE6E3] hover:border-[#17282E]/60 hover:bg-[#EBE6E3] cursor-pointer'
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

                        <div className={`p-5 mb-6 transition-colors duration-300 border-2 border-[#604B42]/30 ${isHovering ? 'bg-[#17282E]/10 text-[#17282E]' : 'bg-[#604B42]/10 text-[#604B42]'}`}>
                            <DocumentPlusIcon className="w-12 h-12" />
                        </div>

                        <h3 className="text-xl font-semibold text-[#17282E] mb-2">
                            Browse files or drag and drop
                        </h3>
                        <p className="text-[#604B42] max-w-sm mb-4">
                            Supported formats: PDF, DOC, DOCX. Maximum file size: 25MB. All files are securely processed and immediately deleted.
                        </p>
                        {!isAuthenticated && (
                                <p className="text-sm text-[#17282E] font-medium">
                                Sign in or create an account to scan and save documents to your dashboard.
                            </p>
                        )}
                    </motion.div>
                ) : (
                    <motion.div
                        key="active-file"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="w-full bg-white pixel-card p-8"
                    >
                        {/* File Info */}
                        <div className="flex items-start gap-4 p-4 bg-[#F5F0EC] border border-[#604B42]/20 mb-6">
                            <div className="p-3 bg-[#17282E]/10 text-[#17282E] relative border border-[#17282E]/20">
                                <DocumentTextIcon className="w-8 h-8" />
                                {uploadComplete && (
                                    <motion.div
                                        initial={{ scale: 0 }}
                                        animate={{ scale: 1 }}
                                        className="absolute -top-2 -right-2 bg-green-500 text-white p-0.5 border border-[#17282E]"
                                    >
                                        <CheckCircleIcon className="w-5 h-5" />
                                    </motion.div>
                                )}
                            </div>
                            <div className="flex-1 overflow-hidden flex flex-col justify-center">
                                <h4 className="font-semibold text-[#17282E] truncate" title={file.name}>
                                    {file.name}
                                </h4>
                                <p className="text-sm text-[#604B42]">
                                    {(file.size / 1024 / 1024).toFixed(2)} MB
                                </p>
                            </div>

                            {!isUploading && !uploadComplete && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); resetUploader(); }}
                                    className="text-[#604B42]/60 hover:text-red-500 p-2 transition-colors hover:bg-[#F5F0EC]"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                                        <path fillRule="evenodd" d="M5.47 5.47a.75.75 0 011.06 0L12 10.94l5.47-5.47a.75.75 0 111.06 1.06L13.06 12l5.47 5.47a.75.75 0 11-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 01-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 010-1.06z" clipRule="evenodd" />
                                    </svg>
                                </button>
                            )}
                        </div>

                        {uploadError && (
                            <div className="mb-6 p-4 bg-red-50 text-red-700 border border-red-200 text-sm">
                                {uploadError}
                            </div>
                        )}

                        {isUploading && (
                            <div className="mb-6 flex items-center gap-3">
                                <ArrowPathIcon className="w-5 h-5 animate-spin text-[#17282E]" />
                                <span className="text-sm font-medium text-[#17282E]">Uploading document…</span>
                            </div>
                        )}

                        {uploadComplete && (
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="mb-6 p-5 bg-emerald-50 text-emerald-800 border-l-4 border-emerald-400"
                            >
                                <div className="flex items-start gap-3">
                                    <CheckCircleIcon className="w-6 h-6 shrink-0 mt-0.5 text-emerald-500" />
                                    <div>
                                        <h5 className="font-bold">Upload complete</h5>
                                        <p className="text-sm mt-1">Your document has been uploaded. Head to Documents to view and analyze it.</p>
                                    </div>
                                </div>
                            </motion.div>
                        )}

                        {/* Action Buttons */}
                        <div className="flex flex-col sm:flex-row gap-3">
                            {!uploadComplete ? (
                                isAuthenticated ? (
                                    <button
                                        onClick={initiateUpload}
                                        disabled={isUploading}
                                        className={`flex-1 py-3 px-6 pixel-button font-semibold transition-all ${isUploading
                                            ? 'bg-[#17282E]/70 text-white cursor-not-allowed opacity-90'
                                            : 'bg-[#17282E] hover:bg-[#17282E] text-white hover:shadow-lg active:scale-[0.98]'
                                            } flex items-center justify-center gap-2`}
                                    >
                                        {isUploading ? 'Uploading…' : 'Upload Document'}
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => loginWithRedirect({ appState: { returnTo: '/' } })}
                                        className="flex-1 py-3 px-6 pixel-button font-semibold bg-[#17282E] hover:bg-[#17282E] text-white transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                                    >
                                        Sign in to upload documents
                                    </button>
                                )
                            ) : (
                                <>
                                    <button
                                        onClick={() => navigate('/documents')}
                                        className="flex-1 py-3 px-6 pixel-button font-semibold bg-[#17282E] hover:bg-[#17282E] text-white transition-all active:scale-[0.98]"
                                    >
                                        Go to Documents
                                    </button>
                                    <button
                                        onClick={resetUploader}
                                        className="py-3 px-6 pixel-button font-semibold bg-[#F5F0EC] hover:bg-[#EBE6E3] text-[#17282E] transition-all active:scale-[0.98]"
                                    >
                                        Upload Another
                                    </button>
                                </>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default Uploader;
