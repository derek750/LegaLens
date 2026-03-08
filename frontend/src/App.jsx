import React from 'react';
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { Auth0Provider } from '@auth0/auth0-react';
import { Analytics } from '@vercel/analytics/react';
import { AppProvider } from './context/AppContext';
import Home from './pages/Home';
import Documents from './pages/Documents';
import Viewer from './pages/Viewer';
import Negotiate from './pages/Negotiate';
import Consultant from './pages/Consultant';
import EditDocument from './pages/EditDocument';

function Auth0ProviderWithCallback({ children }) {
  const navigate = useNavigate();
  return (
    <Auth0Provider
      domain={import.meta.env.VITE_AUTH0_DOMAIN}
      clientId={import.meta.env.VITE_AUTH0_CLIENT_ID}
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience: import.meta.env.VITE_AUTH0_AUDIENCE,
      }}
      onRedirectCallback={(appState) => {
        navigate(appState?.returnTo ?? '/');
      }}
    >
      {children}
    </Auth0Provider>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Auth0ProviderWithCallback>
        <AppProvider>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/documents" element={<Documents />} />
            <Route path="/viewer" element={<Viewer />} />
            <Route path="/negotiate" element={<Negotiate />} />
            <Route path="/edit" element={<EditDocument />} />
            <Route path="/consultant" element={<Consultant />} />
            {/* Legacy redirect */}
            <Route path="/dashboard" element={<Documents />} />
          </Routes>
          <Analytics />
        </AppProvider>
      </Auth0ProviderWithCallback>
    </BrowserRouter>
  );
}

export default App;
