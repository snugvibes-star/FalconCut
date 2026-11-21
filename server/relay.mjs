/**
 * FalconCut agent relay (Phase 9). A tiny, local-first WebSocket message router
 * that pairs ONE editor tab ("host") with ONE external agent ("agent") by a
 * shared session token, and forwards JSON requests/responses/events between
 * them. It is deliberately dumb:
 *
 *   - It never reads files, never stores video, and never persists anything.
 *   - A token only ever routes between the host+agent that presented it; it
 *     cannot enumerate or reach other sessions.
 *   - When the host disconnects (tab close / revoke), the session is destroyed
 *     and the agent is dropped — the token expires with the tab.
 *   - Project JSON (edit decisions, transcript) transits host<->agent; the
 *     video files themselves never leave the browser.
 *
 * Run:  node server/relay.mjs   (PORT=8787 HOST=127.0.0.1 by default)
 * Bind to 127.0.0.1 unless you intentionally want LAN access (HOST=0.0.0.0).
 */
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { handleUpgrade } from './ws.mjs';

const MAX_TOKEN = 128;

function send(conn, obj) {
  if (conn && !conn.closed) conn.send(JSON.stringify(obj));
}

function destroySession(sessions, token, reason) {
  const s = sessions.get(token);
  if (!s) return;
  sessions.delete(token);
  if (s.agent) { send(s.agent, { type: 'host-left', reason }); s.agent.close(1000); }
  if (s.host) { send(s.host, { type: 'session-ended', reason }); s.host.close(1000); }
}

function attach(sessions, token, role, conn) {
  let s = sessions.get(token);
  if (!s) { s = { host: null, agent: null, createdAt: Date.now() }; sessions.set(token, s); }

  if (role === 'host') {
    if (s.host && s.host !== conn) s.host.close(1000);
    s.host = conn;
    send(conn, { type: 'ready', role: 'host', agentPresent: !!s.agent && !s.agent.closed });
    if (s.agent && !s.agent.closed) send(s.agent, { type: 'host-joined' });
  } else {
    if (s.agent && s.agent !== conn) s.agent.close(1000);
    s.agent = conn;
    if (s.host && !s.host.closed) {
      send(s.host, { type: 'agent-joined' });
      send(conn, { type: 'ready', role: 'agent' });
    } else {
      send(conn, { type: 'waiting' });
    }
  }

  conn.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8')); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    const peer = role === 'host' ? s.agent : s.host;
    if (role === 'agent' && msg.type === 'req') {
      if (!s.host || s.host.closed) { send(conn, { type: 'res', id: msg.id, error: 'No editor is connected for this session.' }); return; }
      send(s.host, msg);
    } else if (role === 'host' && (msg.type === 'res' || msg.type === 'event')) {
      send(peer, msg);
    }
  });

  conn.on('close', () => {
    const cur = sessions.get(token);
    if (!cur) return;
    if (role === 'host') {
      // token expires with the editor tab
      destroySession(sessions, token, 'Editor disconnected.');
    } else if (cur.agent === conn) {
      cur.agent = null;
      if (cur.host && !cur.host.closed) send(cur.host, { type: 'agent-left' });
    }
  });
}

function connectPage(token, wsUrl) {
  const safe = String(token).replace(/[<>&"]/g, '');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Connect to FalconCut</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,sans-serif;background:#07090F;color:#E6E9F0;max-width:640px;margin:40px auto;padding:0 20px;line-height:1.6}code{background:#161B26;padding:2px 6px;border-radius:6px}h1{font-size:22px}.box{background:#11151F;border:1px solid #232A38;border-radius:12px;padding:16px;margin:16px 0}</style>
</head><body>
<h1>Connect an agent to FalconCut</h1>
<p>This one-time session links an external agent to the editor tab that created it. The token grants access to <strong>only the project open in that tab</strong>, expires when the tab closes, and can be revoked there with one click. Video files never leave the browser.</p>
<div class="box"><p>WebSocket URL:<br><code>${wsUrl}</code></p><p>Session token:<br><code>${safe}</code></p></div>
<p>Point your agent at the WebSocket URL with <code>?token=${safe}&amp;role=agent</code>, or run the MCP bridge:</p>
<div class="box"><code>FALCONCUT_RELAY=${wsUrl} FALCONCUT_TOKEN=${safe} node server/falconcut-mcp.mjs</code></div>
</body></html>`;
}

export function createRelay({ host = '127.0.0.1', port = 8787 } = {}) {
  const sessions = new Map();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, sessions: sessions.size }));
      return;
    }
    if (url.pathname === '/connect') {
      const token = url.searchParams.get('token') || '';
      const wsUrl = `ws://${req.headers.host || `${host}:${port}`}/ws`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(connectPage(token, wsUrl));
      return;
    }
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('FalconCut relay. See /connect?token=... to pair an agent. Health: /health\n');
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const token = url.searchParams.get('token');
    const role = url.searchParams.get('role');
    handleUpgrade(req, socket, head, (conn) => {
      if (!token || token.length > MAX_TOKEN || (role !== 'host' && role !== 'agent')) {
        conn.close(1008);
        return;
      }
      attach(sessions, token, role, conn);
    });
  });

  const heartbeat = setInterval(() => {
    for (const s of sessions.values()) {
      for (const c of [s.host, s.agent]) {
        if (!c || c.closed) continue;
        if (!c.isAlive) { c.close(1001); continue; }
        c.ping();
      }
    }
  }, 30000);
  heartbeat.unref?.();

  return {
    server,
    sessions,
    listen() {
      return new Promise((resolve) => server.listen(port, host, () => resolve(server.address())));
    },
    close() {
      clearInterval(heartbeat);
      for (const token of [...sessions.keys()]) destroySession(sessions, token, 'Relay shutting down.');
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const port = Number(process.env.PORT || 8787);
  const host = process.env.HOST || '127.0.0.1';
  const relay = createRelay({ host, port });
  relay.listen().then((addr) => {
    console.log(`FalconCut relay listening on ws://${addr.address}:${addr.port} (HTTP http://${addr.address}:${addr.port})`);
    console.log('Local-first: bound to', addr.address, '. Set HOST=0.0.0.0 only if you intend LAN access.');
  });
  const shutdown = () => relay.close().then(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}