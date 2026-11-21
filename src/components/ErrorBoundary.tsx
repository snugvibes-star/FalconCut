import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RefreshCw, Trash2, AlertTriangle } from 'lucide-react';

interface Props { children: ReactNode }
interface State { error: Error | null }

/** Last-resort guard: a render crash must never leave a blank, unrecoverable
 * editor. Offers reload and a storage reset (the autosaved project can itself
 * be the corrupt input). */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State { return { error }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('FalconCut crashed:', error, info.componentStack);
  }

  private resetStorage = async () => {
    try {
      localStorage.clear();
      const dbs = await indexedDB.databases();
      await Promise.all(dbs.map((d) => new Promise<void>((res) => {
        if (!d.name) return res();
        const q = indexedDB.deleteDatabase(d.name);
        q.onsuccess = q.onerror = q.onblocked = () => res();
      })));
    } catch { /* best effort */ }
    location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="h-full flex items-center justify-center bg-ink-950 text-paper p-6">
        <div className="panel max-w-md w-full p-6 text-center cf-crash-card">
          <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-heat/15 border border-heat/30 flex items-center justify-center">
            <AlertTriangle size={22} className="text-heat" />
          </div>
          <h1 className="font-display text-lg font-semibold mb-1">The editor hit an unexpected error</h1>
          <p className="text-sm text-paper-dim mb-4">
            Your project autosaves to this device. Reload first; if the error returns, the saved
            project may be damaged — resetting clears local data and starts fresh.
          </p>
          <p className="text-[11px] font-mono text-heat/80 bg-ink-850 border border-line rounded-md px-3 py-2 mb-5 break-words text-left">
            {this.state.error.message}
          </p>
          <div className="flex gap-2 justify-center">
            <button className="btn-signal" onClick={() => location.reload()}><RefreshCw size={14} /> Reload editor</button>
            <button className="btn-danger" onClick={() => void this.resetStorage()}><Trash2 size={14} /> Reset local data</button>
          </div>
        </div>
      </div>
    );
  }
}