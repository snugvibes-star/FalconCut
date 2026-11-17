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