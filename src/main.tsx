import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';
import { installFalconCutAPI } from './api/falconcut';
import { useStore } from './state/store';

// Same-page agent access (Phase 9), scoped to the open project.
installFalconCutAPI();
// Recover the most recent project from IndexedDB, if any.
void useStore.getState().init();

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);

// PWA: production caches the shell for offline use; dev registers a no-op
// worker so localhost stays installable and shows the app icon without ever
// caching Vite's HMR modules. Media always lives in IndexedDB on the device.
if ('serviceWorker' in navigator) {
  // Register immediately: module evaluation can happen AFTER `load` has
  // already fired (dynamic imports), which would silently skip installability.
  const url = import.meta.env.PROD ? '/sw.js' : '/sw-dev.js';
  navigator.serviceWorker.register(url).catch(() => {
    // SW registration is a progressive enhancement — never block the app.
  });
}