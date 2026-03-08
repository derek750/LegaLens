import React, { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth0 } from '@auth0/auth0-react';
import { setTokenGetter } from '../api.ts';

const navLinks = [
    { to: '/', label: 'New Scan' },
    { to: '/documents', label: 'Documents' },
    { to: '/viewer', label: 'Viewer' },
    { to: '/consultant', label: 'Consultant' },
];

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
            <header className="sticky top-0 z-50 bg-[#05213d] text-[#EBE6E3] border-b-4 border-[#4F3D35] shadow-[0_4px_0_0_#604B42] px-6 py-4">
                <div className="flex items-center justify-between">
                    <Link to="/" className="flex items-center gap-3 cursor-pointer group">
                        <img src="/logo.png" alt="Logo" className="h-10 w-auto object-contain group-hover:opacity-90 transition-opacity" />
                    </Link>

                    <nav className="hidden md:flex items-center gap-6 text-sm font-medium absolute left-1/2 -translate-x-1/2">
                        {navLinks.map(({ to, label }) => (
                            <Link
                                key={to}
                                to={to}
                                className={`transition-colors border-b-2 pb-1 ${
                                    location.pathname === to
                                        ? 'text-[#EBE6E3] border-[#EBE6E3]'
                                        : 'text-[#EBE6E3]/80 border-transparent hover:text-[#EBE6E3]'
                                }`}
                            >
                                {label}
                            </Link>
                        ))}
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
                </div>
            </header>

            <main className="flex-1 w-full max-w-7xl mx-auto px-6 py-12 md:py-20">
                {children}
            </main>
        </div>
    );
}
