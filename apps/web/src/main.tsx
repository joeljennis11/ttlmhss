import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { AppRoutes } from './app/AppRoutes';
import { BrandingProvider } from './brand/BrandingProvider';
import { ToastProvider } from './components/ui';
import { AuthProvider } from './features/auth/auth-context';
import './styles/base.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <BrandingProvider>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </BrandingProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
