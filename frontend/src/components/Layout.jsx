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
        <div className="min-h-screen bg-premium-gradient flex flex-col font-sans transition-colors duration-500">
            <header className="sticky top-0 z-50 glass-panel border-b border-white/20 px-6 py-4 flex items-center justify-between">
                <Link to="/" className="flex items-center gap-3 cursor-pointer group">
                    <div className="w-10 h-10 rounded-xl bg-linear-to-br from-blue-600 to-indigo-600 flex flex-center items-center justify-center text-white shadow-lg group-hover:scale-105 transition-transform">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m5.231 13.481L15 17.25m-4.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9zm3.75 11.625a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                        </svg>
                    </div>
                    <h1 className="text-xl font-bold bg-clip-text text-transparent bg-linear-to-r from-gray-900 to-blue-800 tracking-tight">
                        LegaLens
                    </h1>
                </Link>

                <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-gray-600">
                    <Link to="/" className={`transition-colors ${useLocation().pathname === '/' ? 'text-blue-600 font-semibold cursor-default' : 'hover:text-blue-600'}`}>New Scan</Link>
                    <Link to="/dashboard" className={`transition-colors ${useLocation().pathname === '/dashboard' ? 'text-blue-600 font-semibold cursor-default' : 'hover:text-blue-600'}`}>Dashboard</Link>
                    <a href="#" className="hover:text-blue-600 transition-colors">Pricing</a>
                </nav>

                <div className="flex items-center gap-4">
                    {isAuthenticated ? (
                        <>
                            <span className="text-sm text-gray-600 hidden sm:inline">{user?.email}</span>
                            <button onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })} className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">Log Out</button>
                        </>
                    ) : (
                        <>
                            <button onClick={() => handleLogin(false)} className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">Log In</button>
                            <button onClick={() => handleLogin(true)} className="px-4 py-2 text-sm font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 shadow-md hover:shadow-lg transition-all active:scale-95">
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
