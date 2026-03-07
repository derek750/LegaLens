import React, { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth0 } from '@auth0/auth0-react';
import { setTokenGetter } from '../api.ts';

export default function Layout({ children }) {
    const location = useLocation();
    const { user, isAuthenticated, loginWithRedirect, logout, getAccessTokenSilently } = useAuth0();

    useEffect(() => {
        if (isAuthenticated) {
            setTokenGetter(getAccessTokenSilently);
        }
    }, [isAuthenticated, getAccessTokenSilently]);

    const handleLogin = (signUp = false) => {
        loginWithRedirect({
            authorizationParams: signUp ? { screen_hint: 'signup' } : undefined,
            appState: { returnTo: location.pathname || '/' },
        });
    };

    return (
        <div className="min-h-screen bg-[#EBE6E3] text-[#17282E] flex flex-col font-sans">
            <header className="sticky top-0 z-50 bg-[#17282E] text-[#EBE6E3] border-b-4 border-[#4F3D35] shadow-[0_4px_0_0_#604B42] px-6 py-4 flex items-center justify-between">
                <Link to="/" className="flex items-center gap-3 cursor-pointer group">
                    <div className="w-10 h-10 pixel-card bg-[#17282E] flex items-center justify-center text-[#EBE6E3] group-hover:translate-y-[1px] transition-transform">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M12 3v4m0 0-4 6h8l-4-6m-6 7.5L4 18h4l-2-3.5zm12 0L18 18h4l-2-3.5M5 18h14M9 21h6"
                            />
                        </svg>
                    </div>
                    <h1 className="text-xl font-semibold tracking-tight text-[#EBE6E3]">
                        LegaLens
                    </h1>
                </Link>

                <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-[#EBE6E3]/80">
                    <Link
                        to="/"
                        className={`transition-colors border-b-2 pb-1 ${
                            location.pathname === '/'
                                ? 'text-[#EBE6E3] border-[#EBE6E3]'
                                : 'text-[#EBE6E3]/80 border-transparent hover:text-[#EBE6E3]'
                        }`}
                    >
                        New Scan
                    </Link>
                    <Link
                        to="/dashboard"
                        className={`transition-colors border-b-2 pb-1 ${
                            location.pathname === '/dashboard'
                                ? 'text-[#EBE6E3] border-[#EBE6E3]'
                                : 'text-[#EBE6E3]/80 border-transparent hover:text-[#EBE6E3]'
                        }`}
                    >
                        Dashboard
                    </Link>
                </nav>

                <div className="flex items-center gap-4">
                    {isAuthenticated ? (
                        <>
                            <span className="text-sm text-[#EBE6E3]/70 hidden sm:inline">{user?.email}</span>
                            <button
                                onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}
                                className="text-sm font-medium text-[#EBE6E3]/80 hover:text-[#EBE6E3] transition-colors"
                            >
                                Log Out
                            </button>
                        </>
                    ) : (
                        <>
                            <button
                                onClick={() => handleLogin(false)}
                                className="text-sm font-medium text-[#EBE6E3]/80 hover:text-[#EBE6E3] transition-colors"
                            >
                                Log In
                            </button>
                            <button
                                onClick={() => handleLogin(true)}
                                className="px-4 py-2 text-sm font-medium bg-[#EBE6E3] text-[#17282E] pixel-button transition-all"
                            >
                                Get Started
                            </button>
                        </>
                    )}
                </div>
            </header>

            <main className="flex-1 w-full max-w-7xl mx-auto px-6 py-12 md:py-20">
                {children}
            </main>
        </div>
    );
}
