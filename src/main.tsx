import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/App';
import { applyBrandTheme } from '@/lib/theme';
import '@/index.css';

applyBrandTheme();

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Root container #root is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // Recovery = continue without offline support: the service worker only
      // pre-caches non-sensitive static assets, so the app is fully functional
      // when registration is unavailable (e.g. private browsing).
    });
  });
}
