/**
 * Local AI proxy. Some providers — notably api.openai.com — refuse browser
 * CORS requests on POST /chat/completions, so a purely client-side app cannot
 * call them. When CutFlow is served from localhost (Start CutFlow.bat or
 * `npm run serve`/`npm run dev`), chat requests to those hosts are routed
 * through this same-origin endpoint and forwarded server-side, where CORS
 * does not apply.
 *
 * Safety rules:
 *  - only GET/POST, only to an explicit ?url= https target (http allowed for
 *    localhost targets, e.g. LM Studio/Ollama); GET without ?url is a health
 *    probe
 *  - no cookies, no client headers beyond a small allowlist (the user's own
 *    key is forwarded in the header they'd have sent anyway)
 *  - same-origin check when the browser sends an Origin header
 *  - the server binds loopback only (127.0.0.1), and nothing is logged
 */
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';

const ALLOWED_HEADERS = ['content-type', 'authorization', 'x-goog-api-key', 'http-referer', 'x-title', 'openai-organization', 'anthropic-version', 'x-api-key'];
const MAX_BODY = 2 * 1024 * 1024;

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function handleAIProxy(req, res) {
  const send = (status, text) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(text);
  };
  const search = new URL(req.url, `http://${req.headers.host || 'localhost'}`).searchParams;
  const target = search.get('url');
  // Health probe: GET without ?url lets the app detect, at runtime, that this
  // origin can proxy. GET *with* ?url forwards a read-only request (e.g. the
  // /models list) the same way.
  if (!target) {
    if (req.method === 'GET') { send(200, JSON.stringify({ ok: true, proxy: 'cutflow-local' })); return; }
    send(400, JSON.stringify({ error: { message: 'Missing ?url= target.' } }));
    return;
  }
  if (req.method !== 'POST' && req.method !== 'GET') {
    send(405, JSON.stringify({ error: { message: 'GET or POST only.' } }));
    return;
  }

  // Same-origin guard: browsers always send Origin on cross-origin requests.
  const origin = req.headers.origin;
  if (origin) {
    let originHost = '';
    try { originHost = new URL(origin).host; } catch { /* ignore */ }
    if (originHost && originHost !== req.headers.host) {
      send(403, JSON.stringify({ error: { message: 'Cross-origin proxy use is not allowed.' } }));
      return;
    }
  }

  let targetUrl;
  try { targetUrl = new URL(target); } catch { send(400, JSON.stringify({ error: { message: 'Invalid target URL.' } })); return; }
  const isLocalTarget = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(targetUrl.hostname);
  if (targetUrl.protocol !== 'https:' && !(targetUrl.protocol === 'http:' && isLocalTarget)) {
    send(400, JSON.stringify({ error: { message: 'Only https targets (or http on localhost) are allowed.' } }));
    return;
  }
  if (targetUrl.username || targetUrl.password) { send(400, JSON.stringify({ error: { message: 'Credentials in URLs are not allowed.' } })); return; }

  const method = req.method;
  let body = Buffer.alloc(0);
  if (method === 'POST') {
    try { body = await readBody(req, MAX_BODY); } catch (e) {
      send(413, JSON.stringify({ error: { message: (e).message } }));
      return;
    }
  }

  const headers = {};
  for (const name of ALLOWED_HEADERS) {
    const v = req.headers[name];
    if (typeof v === 'string' && v) headers[name] = v;
  }
  if (method === 'POST') headers['content-length'] = String(body.length);
  headers['accept'] = req.headers.accept || 'application/json';

  const doRequest = targetUrl.protocol === 'https:' ? httpsRequest : httpRequest;
  const upstream = doRequest({
    protocol: targetUrl.protocol,
    hostname: targetUrl.hostname,
    port: targetUrl.port || undefined,
    path: targetUrl.pathname + targetUrl.search,
    method,
    headers,
    timeout: 120000,
  }, (up) => {
    res.writeHead(up.statusCode || 502, {
      'Content-Type': up.headers['content-type'] || 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    up.pipe(res);
  });
  upstream.on('timeout', () => { upstream.destroy(new Error('Upstream timed out.')); });
  upstream.on('error', (err) => {
    if (!res.headersSent) send(502, JSON.stringify({ error: { message: `Proxy could not reach ${targetUrl.host}: ${err.message}` } }));
    else res.end();
  });
  upstream.end(body);
}
