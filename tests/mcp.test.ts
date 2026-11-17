import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-ignore — plain JS relay module
import { createRelay } from '../server/relay.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const mcpPath = path.join(root, 'server', 'cutflow-mcp.mjs');

let relay: any;
let port = 0;
let host: WebSocket;
let child: ChildProcess;
const hostMessages: any[] = [];
let seq = 0;
const pending = new Map<number, (m: any) => void>();
let stdoutBuf = '';

function hostWaitFor(pred: (m: any) => boolean, timeout = 8000): Promise<any> {
  const found = hostMessages.find(pred);
  if (found) return Promise.resolve(found);
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('host waitFor timeout')), timeout);
    const iv = setInterval(() => {
      const m = hostMessages.find(pred);
      if (m) { clearInterval(iv); clearTimeout(t); res(m); }
    }, 20);
  });
}

function rpc(method: string, params?: any, timeout = 10000): Promise<any> {
  const id = ++seq;
  return new Promise((res, rej) => {
    const t = setTimeout(() => { pending.delete(id); rej(new Error(`rpc ${method} timeout`)); }, timeout);
    pending.set(id, (m) => { clearTimeout(t); res(m); });
    child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

beforeAll(async () => {
  relay = createRelay({ host: '127.0.0.1', port: 0 });
  const addr = await relay.listen();
  port = addr.port;
  const token = 'mcp-test-token';

  // Fake editor host: auto-answers relay requests like the browser bridge would.
  host = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}&role=host`);
  await new Promise<void>((res, rej) => { host.addEventListener('open', () => res()); host.addEventListener('error', () => rej(new Error('host ws error'))); });
  host.addEventListener('message', (ev: any) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    hostMessages.push(m);
    if (m.type === 'req') {
      let result: any;
      if (m.method === 'applyTool') result = { summary: 'Removed 2.0s of dead air across 2 cuts.', stats: { removedSec: 2 }, actions: [{ type: 'ripple_delete_range' }, { type: 'ripple_delete_range' }] };
      else if (m.method === 'getProject') result = { id: 'p1', clips: [] };
      else if (m.method === 'runTool') result = { summary: 'preview', actions: [] };
      else result = { ok: true };
      host.send(JSON.stringify({ type: 'res', id: m.id, result }));
    }
  });

  child = spawn(process.execPath, [mcpPath], {
    env: { ...process.env, CUTFLOW_RELAY: `ws://127.0.0.1:${port}/ws`, CUTFLOW_TOKEN: token },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdout!.on('data', (d) => {
    stdoutBuf += d.toString();
    let idx;
    while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
      const line = stdoutBuf.slice(0, idx).trim();
      stdoutBuf = stdoutBuf.slice(idx + 1);
      if (!line) continue;
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.id != null && pending.has(m.id)) { const cb = pending.get(m.id)!; pending.delete(m.id); cb(m); }
    }
  });
  child.stderr!.on('data', () => { /* logs only; keep test output clean */ });

  // wait until the MCP bridge has joined the relay as an agent
  await hostWaitFor((m) => m.type === 'agent-joined');
}, 20000);

afterAll(async () => {
  try { child?.kill(); } catch { /* ignore */ }
  try { host?.close(); } catch { /* ignore */ }
  await relay?.close();
});

describe('MCP bridge over the relay', () => {
  it('initializes with server info and tool capability', async () => {
    const res = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    expect(res.result.serverInfo.name).toBe('cutflow');
    expect(res.result.capabilities.tools).toBeTruthy();
    child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  });

  it('lists editing tools and read tools with JSON schemas', async () => {
    const res = await rpc('tools/list');
    const names = res.result.tools.map((t: any) => t.name);
    expect(names).toContain('remove_dead_air');
    expect(names).toContain('get_project');
    expect(names).toContain('preview_tool');
    const rda = res.result.tools.find((t: any) => t.name === 'remove_dead_air');
    expect(rda.inputSchema.properties.max_pause_ms.type).toBe('number');
  });

  it('calls an editing tool through the relay and returns the summary', async () => {
    const res = await rpc('tools/call', { name: 'remove_dead_air', arguments: { max_pause_ms: 500 } });
    expect(res.result.isError).toBeFalsy();
    expect(res.result.content[0].text).toContain('Removed 2.0s');
    const req = hostMessages.find((m) => m.type === 'req' && m.method === 'applyTool');
    expect(req.params.name).toBe('remove_dead_air');
    expect(req.params.params.max_pause_ms).toBe(500);
  });

  it('calls a read tool through the relay', async () => {
    const res = await rpc('tools/call', { name: 'get_project', arguments: {} });
    expect(res.result.content[0].text).toContain('p1');
  });

  it('returns an MCP error result for an unknown tool', async () => {
    const res = await rpc('tools/call', { name: 'not_a_tool', arguments: {} });
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toMatch(/Unknown tool/);
  });
});