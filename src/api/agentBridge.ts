/**
 * Browser side of the agent relay (Phase 9/11). The editor tab connects OUT
 * to the relay as the "host"; an external agent joins with the same token.
 * Incoming requests are dispatched to the SAME in-page API (window.falconcut)
 * the built-in chat uses, so an external agent and a human share one engine.
 *
 * The bridge only ever touches the project open in this tab. It exposes a
 * fixed allowlist of methods — no file access, no other projects. Project
 * change events are throttled so the agent sees a live but calm timeline.
 */
import { useStore, type AgentSession } from '../state/store';
import { createFalconCutAPI, type FalconCutAPI } from './falconcut';

export interface BridgeStatus { relayConnected: boolean; agentPresent: boolean }
export interface BridgeHandlers {
  onStatus?: (s: BridgeStatus) => void;
  onActivity?: (text: string) => void;
  onError?: (msg: string) => void;
}

/** The shareable one-time link (opens the relay's connect page). */
export function sessionLink(s: AgentSession): string {
  const httpBase = s.relayUrl.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/+$/, '');
  return `${httpBase}/connect?token=${encodeURIComponent(s.token)}`;
}

export function wsHostUrl(s: AgentSession): string {
  return `${s.relayUrl.replace(/\/+$/, '')}/ws?token=${encodeURIComponent(s.token)}&role=host`;
}

/** QR code (data URL) for the session link, generated on demand. */
export async function makeSessionQR(link: string): Promise<string> {
  const QRCode = await import('qrcode');
  return QRCode.toDataURL(link, { margin: 1, width: 220, color: { dark: '#EAEAEA', light: '#101012' } });
}

export const BRIDGE_METHODS = [
  'listTools', 'toolsPrompt', 'getProject', 'getAnalysis', 'getStoryboard', 'getLint',
  'getPlayhead', 'setPlayhead', 'runTool', 'applyTool', 'applyActions', 'undo', 'redo',
] as const;

async function dispatch(api: FalconCutAPI, method: string, params: any): Promise<unknown> {
  switch (method) {
    case 'listTools': return api.listTools();
    case 'toolsPrompt': return api.toolsPrompt();
    case 'getProject': return api.getProject();
    case 'getAnalysis': return api.getAnalysis();
    case 'getStoryboard': return api.getStoryboard();
    case 'getLint': return api.getLint();
    case 'getPlayhead': return api.getPlayhead();
    case 'setPlayhead': api.setPlayhead(Number(params?.t ?? 0)); return { ok: true };
    case 'runTool': return api.runTool(String(params?.name ?? ''), params?.params ?? {});
    case 'applyTool': return api.applyTool(String(params?.name ?? ''), params?.params ?? {});
    case 'applyActions': api.applyActions(params?.actions ?? [], params?.label ?? 'Agent edit'); return { ok: true };
    case 'undo': api.undo(); return { ok: true };
    case 'redo': api.redo(); return { ok: true };
    default: throw new Error(`Unknown method "${method}". Allowed: ${BRIDGE_METHODS.join(', ')}.`);
  }
}

export interface Bridge { disconnect: () => void }

export function connectAgentBridge(s: AgentSession, h: BridgeHandlers = {}): Bridge {
  let disposed = false;
  const authorize = () => {
    const current = useStore.getState();
    if (disposed || current.session?.token !== s.token || current.project.id !== s.projectId) {
      throw new Error('Session expired or revoked.');
    }
  };
  const api = createFalconCutAPI(authorize);
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingEvent: ReturnType<typeof setTimeout> | null = null;
  let lastEvent = 0;

  const send = (o: unknown) => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(o)); };
  const status = (relayConnected: boolean, agentPresent: boolean) => h.onStatus?.({ relayConnected, agentPresent });

  const unsub = useStore.subscribe((current, previous) => {
    if (current.session?.token !== s.token || current.project.id !== s.projectId) { disconnect(); return; }
    if (current.project === previous.project) return;
    const emit = () => { lastEvent = Date.now(); send({ type: 'event', event: 'project-changed' }); };
    const now = Date.now();
    if (now - lastEvent > 400) emit();
    else { if (pendingEvent) clearTimeout(pendingEvent); pendingEvent = setTimeout(emit, 400); }
  });

  const open = () => {
    if (disposed) return;
    ws = new WebSocket(wsHostUrl(s));
    ws.onopen = () => status(true, false);
    ws.onmessage = async (ev) => {
      if (disposed || useStore.getState().session?.token !== s.token) return;
      let msg: any;
      try { msg = JSON.parse(ev.data as string); } catch { return; }
      const store = useStore.getState();
      if (msg.type === 'ready') {
        store.setSessionConnected(!!msg.agentPresent);
        status(true, !!msg.agentPresent);
      } else if (msg.type === 'agent-joined') {
        store.setSessionConnected(true); store.logActivity('Agent connected');
        h.onActivity?.('Agent connected'); status(true, true);
      } else if (msg.type === 'agent-left') {
        store.setSessionConnected(false); store.logActivity('Agent disconnected');
        h.onActivity?.('Agent disconnected'); status(true, false);
      } else if (msg.type === 'host-left' || msg.type === 'session-ended') {
        store.setSessionConnected(false); status(false, false);
      } else if (msg.type === 'req') {
        const { id, method, params } = msg;
        try {
          authorize();
          if (!store.autopilot && ['applyTool', 'applyActions', 'undo', 'redo'].includes(method)) {
            throw new Error('Review mode: remote writes are paused. Use runTool to preview, or ask the human to enable Autopilot.');
          }
          const result = await dispatch(api, method, params);
          authorize();
          send({ type: 'res', id, result });
          store.logActivity(`${method} completed`); h.onActivity?.(`${method} completed`);
        } catch (e) {
          const error = (e as Error).message;
          send({ type: 'res', id, error });
          store.logActivity(`${method} failed: ${error}`); h.onActivity?.(`${method} failed: ${error}`);
        }
      }
    };
    ws.onclose = () => {
      if (disposed) return;
      if (useStore.getState().session?.token === s.token) useStore.getState().setSessionConnected(false);
      status(false, false);
      if (!disposed) reconnectTimer = setTimeout(open, 1500);
    };
    ws.onerror = () => h.onError?.('Relay connection error');
  };
  open();

  function disconnect() {
    if (disposed) return;
    disposed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (pendingEvent) clearTimeout(pendingEvent);
    unsub();
    ws?.close();
    if (useStore.getState().session?.token === s.token) useStore.getState().setSessionConnected(false);
    status(false, false);
  }
  return { disconnect };
}