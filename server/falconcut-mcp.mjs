#!/usr/bin/env node
/**
 * FalconCut MCP bridge (Phase 9). A minimal Model Context Protocol stdio server
 * that joins the relay as an "agent" and exposes the SAME FalconCut tools to any
 * MCP client (Claude Desktop, etc.). No account, no install beyond Node.
 *
 *   FALCONCUT_RELAY=ws://127.0.0.1:8787/ws FALCONCUT_TOKEN=<token> node server/falconcut-mcp.mjs
 *
 * Get the token from the editor's "Connect an agent" dialog. Every editing
 * tool call is applied as ONE undo step in the editor, so the human can always
 * review the timeline diff and revert. `preview_tool` runs without applying.
 *
 * Protocol: newline-delimited JSON-RPC 2.0 on stdin/stdout. Logs go to stderr
 * only, so stdout stays a clean MCP channel.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RELAY = process.env.FALCONCUT_RELAY || 'ws://127.0.0.1:8787/ws';
const TOKEN = process.env.FALCONCUT_TOKEN || '';
const PROTOCOL_VERSION = '2024-11-05';

let manifest = { tools: [] };
try { manifest = JSON.parse(fs.readFileSync(path.join(root, 'public', 'tools.json'), 'utf8')); }
catch { log('public/tools.json not found — run `npm run manifest`. Serving read-only tools only.'); }

function log(...a) { process.stderr.write(a.join(' ') + '\n'); }

/* ---------------- relay connection (agent role) ---------------- */
class Relay {
  constructor() { this.ws = null; this.pending = new Map(); this.seq = 0; this.ready = false; this.shuttingDown = false; }
  connect() {
    if (!TOKEN) { log('No FALCONCUT_TOKEN set — tools/list works, but tool calls need a token from the editor.'); return; }
    const url = `${RELAY.replace(/\/+$/, '')}${RELAY.includes('?') ? '&' : '?'}token=${encodeURIComponent(TOKEN)}&role=agent`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.addEventListener('message', (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === 'ready') { this.ready = true; log('Connected to editor.'); }
      else if (m.type === 'waiting') { this.ready = false; log('Waiting for the editor to connect…'); }
      else if (m.type === 'host-left' || m.type === 'session-ended') { this.ready = false; log('Editor disconnected.'); }
      else if (m.type === 'res') {
        const p = this.pending.get(m.id);
        if (p) { this.pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(new Error(m.error)) : p.resolve(m.result); }
      }
    });
    ws.addEventListener('close', () => {
      this.ready = false;
      for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error('Relay connection closed.')); }
      this.pending.clear();
      if (!this.shuttingDown) setTimeout(() => this.connect(), 1500);
    });
    ws.addEventListener('error', () => log('Relay connection error.'));
  }
  request(method, params) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Not connected to the relay. Start it with `npm run relay` and open the editor session.'));
    const id = `mcp-${++this.seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Timed out waiting for the editor (${method}).`)); }, 60000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ type: 'req', id, method, params }));
    });
  }
  close() { this.shuttingDown = true; try { this.ws?.close(); } catch { /* ignore */ } }
}
const relay = new Relay();
relay.connect();

/* ---------------- MCP tool definitions ---------------- */
function paramSchema(spec) {
  const s = { description: spec.description };
  if (spec.type === 'enum') { s.type = 'string'; if (spec.enum) s.enum = spec.enum; }
  else s.type = spec.type;
  if (spec.default !== undefined) s.default = spec.default;
  return s;
}

const READ_TOOLS = [
  { name: 'get_project', description: 'Read the current project JSON (tracks, clips, media, settings). Read-only.', method: 'getProject', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_analysis', description: 'Read the analysis (transcript, silences, scenes, faces, beats, loudness). Read-only.', method: 'getAnalysis', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_storyboard', description: 'Read the plain-text storyboard summary of the footage. Read-only.', method: 'getStoryboard', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_lint', description: 'Read the quality-check report (issues + score). Read-only.', method: 'getLint', inputSchema: { type: 'object', properties: {} } },
  { name: 'preview_tool', description: 'Preview any FalconCut tool without applying it. Returns the action list + summary.', inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'FalconCut tool name, e.g. remove_dead_air' }, params: { type: 'object', description: 'Tool params' } }, required: ['name'] } },
];

function buildTools() {
  const editTools = manifest.tools.map((t) => {
    const properties = {};
    const required = [];
    for (const [k, v] of Object.entries(t.params || {})) {
      properties[k] = paramSchema(v);
      if (!v.optional) required.push(k);
    }
    const meta = [
      t.label ? `Human label: ${t.label}` : '',
      t.group ? `Group: ${t.group}` : '',
      t.aliases?.length ? `Also called: ${t.aliases.join(', ')}` : '',
      t.requires?.length ? `Needs: ${t.requires.join(', ')}` : '',
      t.kind === 'control' ? 'UI control (no project edit)' : '',
    ].filter(Boolean).join('; ');
    return { name: t.name, description: `${t.description}${meta ? ` — ${meta}` : ''}${t.kind === 'control' ? '' : ' (applied as one undo step)'}`, inputSchema: { type: 'object', properties, ...(required.length ? { required } : {}) } };
  });
  return [...editTools, ...READ_TOOLS];
}

function textResult(obj) {
  const text = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
  return { content: [{ type: 'text', text }] };
}

async function callTool(name, args = {}) {
  const read = READ_TOOLS.find((t) => t.name === name);
  if (read && read.method) return textResult(await relay.request(read.method, {}));
  if (name === 'preview_tool') return textResult(await relay.request('runTool', { name: args.name, params: args.params ?? {} }));
  if (manifest.tools.some((t) => t.name === name)) {
    const res = await relay.request('applyTool', { name, params: args });
    return textResult({ summary: res?.summary ?? 'Applied.', stats: res?.stats, warnings: res?.warnings, actions: res?.actions?.length ?? 0 });
  }
  throw new Error(`Unknown tool "${name}". Use tools/list to see available tools.`);
}

/* ---------------- JSON-RPC over stdio ---------------- */
function send(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }
function respond(id, result) { if (id !== undefined && id !== null) send({ jsonrpc: '2.0', id, result }); }
function respondError(id, code, message) { if (id !== undefined && id !== null) send({ jsonrpc: '2.0', id, error: { code, message } }); }

async function handle(msg) {
  const { id, method, params } = msg;
  try {
    if (method === 'initialize') {
      respond(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: 'falconcut', version: '1.0.0' } });
    } else if (method === 'notifications/initialized' || method === 'initialized') {
      /* notification — no response */
    } else if (method === 'ping') {
      respond(id, {});
    } else if (method === 'tools/list') {
      respond(id, { tools: buildTools() });
    } else if (method === 'tools/call') {
      try { respond(id, await callTool(params?.name, params?.arguments ?? {})); }
      catch (e) { respond(id, { content: [{ type: 'text', text: String(e.message || e) }], isError: true }); }
    } else if (id !== undefined) {
      respondError(id, -32601, `Method not found: ${method}`);
    }
  } catch (e) {
    respondError(id, -32603, String(e.message || e));
  }
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg; try { msg = JSON.parse(trimmed); } catch { return; }
  void handle(msg);
});
rl.on('close', () => { relay.close(); process.exit(0); });
process.on('SIGINT', () => { relay.close(); process.exit(0); });
process.on('SIGTERM', () => { relay.close(); process.exit(0); });
log(`FalconCut MCP bridge ready (relay ${RELAY}). ${manifest.tools.length} editing tools + ${READ_TOOLS.length} read/preview tools.`);