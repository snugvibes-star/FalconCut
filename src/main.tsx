import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';
import { installCutflowAPI } from './api/cutflow';
import { useStore } from './state/store';

// Same-page agent access (Phase 9), scoped to the open project.
installCutflowAPI();
// Recover the most recent project from IndexedDB, if any.
void useStore.getState().init();

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);

// PWA: register the service worker in production builds only (dev HMR must
// never be cached). Once installed, the editor runs fully offline — media
// stays in IndexedDB on the device either way.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // SW registration is a progressive enhancement — never block the app.
    });
  });
}