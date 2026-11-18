/**
 * Zero-dependency static server for the built app (dist/).
 * Run: npm run serve   — serves http://localhost:4173
 *
 * Why this exists: a web app cannot run from file:// — ES modules, service
 * workers and IndexedDB all require an http(s) origin. Double-clicking
 * dist/index.html will never run CutFlow; this server gives it the localhost
 * origin so the PWA installs (real icon, standalone window) and works offline.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { handleAIProxy } from '../server/aiProxy.mjs';

const ROOT = path.join(process.cwd(), 'dist');
const PORT = Number(process.env.PORT || 4173);

if (!existsSync(path.join(ROOT, 'index.html'))) {
  console.error('dist/index.html not found — run `npm run build` first (or double-click Start CutFlow.bat).');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://localhost:${PORT}`);
    // Same-origin AI proxy (see server/aiProxy.mjs): some providers — notably
    // api.openai.com — refuse browser CORS, so chat requests are forwarded
    // here server-side, where CORS does not apply.
    if (url.pathname === '/__ai') { await handleAIProxy(req, res); return; }
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    // Directory traversal guard.
    if (!filePath.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }
    let info = await stat(filePath).catch(() => null);
    if (info?.isDirectory()) { filePath = path.join(filePath, 'index.html'); info = await stat(filePath).catch(() => null); }
    // SPA fallback: unknown paths get the app shell.
    if (!info) { filePath = path.join(ROOT, 'index.html'); info = await stat(filePath); }
    const body = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    // Hashed assets are immutable; the SW and shell must always revalidate so
    // updates land on the next reload.
    headers['Cache-Control'] = /\/assets\//.test(filePath) && ext !== '.html'
      ? 'public, max-age=31536000, immutable'
      : 'no-cache';
    if (ext === '.js' || ext === '.mjs' || ext === '.wasm') headers['Cross-Origin-Opener-Policy'] = 'same-origin';
    res.writeHead(200, headers).end(body);
  } catch (err) {
    res.writeHead(500).end('Server error');
    console.error(err);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`CutFlow running at http://localhost:${PORT}`);
  console.log('Install it as an app: Chrome/Edge → address-bar install icon (or ⋮ → "Install CutFlow").');
  console.log('Press Ctrl+C to stop the server.');
});
