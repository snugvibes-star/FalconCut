import { useEffect, useState } from 'react';
import { Copy, Plug, ShieldOff } from 'lucide-react';
import { useStore } from '../state/store';
import { useUI } from '../state/ui';
import { sessionLink, makeSessionQR } from '../api/agentBridge';
import { Dialog } from './Dialog';

export function ConnectDialog() {
  const session = useStore((s) => s.session);
  const autopilot = useStore((s) => s.autopilot);
  const [relay, setRelay] = useState('ws://127.0.0.1:8787');
  const [qr, setQr] = useState('');
  const [error, setError] = useState('');
  const link = session ? sessionLink(session) : '';
  const ui = useUI();
  useEffect(() => {
    let active = true;
    setQr('');
    if (link) void makeSessionQR(link).then((data) => { if (active) setQr(data); }).catch(() => { if (active) setError('Could not generate QR code. Copy the link instead.'); });
    return () => { active = false; };
  }, [link]);
  const connect = () => {
    try {
      const url = new URL(relay);
      if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Use a ws:// or wss:// relay URL without credentials or query parameters.');
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('This build connects only to a local relay. Remote hosting needs a secured deployment.');
      setError('');
      useStore.getState().createSession(relay.replace(/\/+$/, ''));
    } catch (e) { setError((e as Error).message); }
  };
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); ui.toast('Copied', 'success'); }
    catch { setError('Clipboard unavailable. Select and copy the text manually.'); }
  };
  return <Dialog title="Connect an agent" onClose={() => ui.close('connect')}>
    <div className="space-y-4 text-xs">
      <p className="text-paper-dim">Your agent can read this project's transcript and edit its timeline. Source videos stay on this device. Treat the session link like a password.</p>
      <div className="rounded-lg border border-line p-3 text-paper-dim space-y-2">
        <p>Start the local relay in the project folder</p>
        <code className="block font-mono text-signal">npm run relay</code>
        <p>The relay and MCP bridge run locally in Node. A browser tab cannot host a listening HTTP or MCP server on its own.</p>
      </div>
      {!session ? <div className="space-y-2">
        <label className="label" htmlFor="relay-url">Local relay URL</label>
        <input id="relay-url" className="field" value={relay} onChange={(e) => setRelay(e.target.value)} />
        <button className="btn-signal" onClick={connect}><Plug size={14} /> Create session</button>
      </div> : <>
        <div className="flex flex-col sm:flex-row gap-4 items-start">
          {qr && <img src={qr} width={140} height={140} alt="QR code for this agent session" className="rounded-lg shrink-0" />}
          <div className="min-w-0 space-y-2">
            <p className={session.connected ? 'text-heat-green' : 'text-heat-amber'}>{session.connected ? 'Agent connected' : 'Waiting for agent — check the relay is running'}</p>
            <input aria-label="Session link" readOnly value={link} className="field text-xs" onFocus={(e) => e.target.select()} />
            <button className="btn-solid" onClick={() => void copy(link)}><Copy size={13} /> Copy link</button>
            <p className="text-paper-faint">Localhost links work on this computer only; scanning from a phone won't reach this relay.</p>
          </div>
        </div>
        <details className="rounded-lg border border-line p-3">
          <summary className="cursor-pointer text-paper-dim">MCP client configuration</summary>
          <p className="text-paper-faint my-2">Run <code>node server/falconcut-mcp.mjs</code> from this project folder with these environment variables.</p>
          <pre className="text-[11px] whitespace-pre-wrap break-all bg-ink-950 rounded p-2">{`FALCONCUT_RELAY=${session.relayUrl}\nFALCONCUT_TOKEN=${session.token}`}</pre>
        </details>
        <label className="flex items-center gap-2 text-paper-dim"><input type="checkbox" className="accent-mind" checked={autopilot} onChange={(e) => useStore.getState().setAutopilot(e.target.checked)} /> Autopilot: allow agent edits</label>
        <p className="text-paper-faint">Turn Autopilot off to pause remote writes while allowing previews. Closing this dialog keeps the connection alive. Closing the tab or switching projects revokes it.</p>
        <button className="btn-danger" onClick={() => useStore.getState().revokeSession()}><ShieldOff size={14} /> Revoke access now</button>
        <div className="border-t border-line pt-3">
          <h3 className="label">Activity</h3>
          {session.activity.length === 0 ? <p className="text-paper-faint">No agent activity yet.</p> : <ul className="max-h-36 overflow-y-auto space-y-1 font-mono text-[10px] text-paper-dim">{session.activity.map((a, i) => <li key={`${a.at}-${i}`}>{new Date(a.at).toLocaleTimeString()} · {a.text}</li>)}</ul>}
        </div>
      </>}
      {error && <p role="alert" className="text-heat">{error}</p>}
      <div className="border-t border-line pt-3 text-paper-faint">No relay needed for in-page agents: <code className="text-pulse">window.falconcut</code>. Tool definitions are available at <a href="/tools.json" target="_blank" rel="noreferrer" className="text-pulse underline">/tools.json</a>.</div>
    </div>
  </Dialog>;
}
