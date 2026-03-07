import React from 'react';
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { Auth0Provider } from '@auth0/auth0-react';
import Home from './pages/Home';
import Dashboard from './pages/Dashboard';

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
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/dashboard" element={<Dashboard />} />
        </Routes>
      </Auth0ProviderWithCallback>
    </BrowserRouter>
  );
}

export default App;
