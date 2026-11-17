import { describe, it, expect, beforeAll, afterAll } from 'vitest';
// @ts-ignore — plain JS relay module (no type declarations)
import { createRelay } from '../server/relay.mjs';

interface Client {
  ws: WebSocket;
  messages: any[];
  send: (o: any) => void;
  waitFor: (pred: (m: any) => boolean, timeout?: number) => Promise<any>;
  waitClose: (timeout?: number) => Promise<{ code: number }>;
  close: () => void;
}

function connect(url: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const messages: any[] = [];
    const waiters: { pred: (m: any) => boolean; resolve: (m: any) => void; timer: any }[] = [];
    let closeInfo: { code: number } | null = null;
    const closeWaiters: { resolve: (c: { code: number }) => void; timer: any }[] = [];
    ws.addEventListener('message', (ev: any) => {
      let m: any;
      try { m = JSON.parse(ev.data); } catch { return; }
      messages.push(m);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].pred(m)) { const w = waiters.splice(i, 1)[0]; clearTimeout(w.timer); w.resolve(m); }
      }
    });
    ws.addEventListener('close', (ev: any) => {
      closeInfo = { code: ev.code };
      for (const w of closeWaiters.splice(0)) { clearTimeout(w.timer); w.resolve(closeInfo); }
    });
    ws.addEventListener('open', () => resolve(api));
    ws.addEventListener('error', () => reject(new Error('WebSocket error')));
    const api: Client = {
      ws, messages,
      send: (o) => ws.send(JSON.stringify(o)),
      waitFor: (pred, timeout = 5000) => {
        const found = messages.find(pred);
        if (found) return Promise.resolve(found);
        return new Promise((res, rej) => {
          const timer = setTimeout(() => rej(new Error('waitFor timeout')), timeout);
          waiters.push({ pred, resolve: res, timer });
        });
      },
      waitClose: (timeout = 5000) => {
        if (closeInfo) return Promise.resolve(closeInfo);
        return new Promise((res, rej) => {
          const timer = setTimeout(() => rej(new Error('waitClose timeout')), timeout);
          closeWaiters.push({ resolve: res, timer });
        });
      },
      close: () => { try { ws.close(); } catch { /* ignore */ } },
    };
  });
}

let relay: any;
let port = 0;
const base = () => `ws://127.0.0.1:${port}/ws`;

beforeAll(async () => {
  relay = createRelay({ host: '127.0.0.1', port: 0 });
  const addr = await relay.listen();
  port = addr.port;
});

afterAll(async () => { await relay.close(); });

describe('relay: handshake + routing', () => {
  it('pairs a host and an agent by token and routes req/res/event', async () => {
    const token = 'tok-routing-' + Math.random().toString(36).slice(2);
    const host = await connect(`${base()}?token=${token}&role=host`);
    await host.waitFor((m) => m.type === 'ready' && m.role === 'host');

    const agent = await connect(`${base()}?token=${token}&role=agent`);
    await agent.waitFor((m) => m.type === 'ready' && m.role === 'agent');
    await host.waitFor((m) => m.type === 'agent-joined');

    agent.send({ type: 'req', id: '1', method: 'listTools', params: {} });
    const req = await host.waitFor((m) => m.type === 'req' && m.id === '1');
    expect(req.method).toBe('listTools');

    host.send({ type: 'res', id: '1', result: [{ name: 'remove_dead_air' }] });
    const res = await agent.waitFor((m) => m.type === 'res' && m.id === '1');
    expect(res.result[0].name).toBe('remove_dead_air');

    host.send({ type: 'event', event: 'project-changed' });
    await agent.waitFor((m) => m.type === 'event' && m.event === 'project-changed');

    agent.close();
    await host.waitFor((m) => m.type === 'agent-left');
    host.close();
  });

  it('answers an agent with an error when no editor is connected', async () => {
    const token = 'tok-nohost-' + Math.random().toString(36).slice(2);
    const agent = await connect(`${base()}?token=${token}&role=agent`);
    await agent.waitFor((m) => m.type === 'waiting');
    agent.send({ type: 'req', id: '9', method: 'getProject' });
    const res = await agent.waitFor((m) => m.type === 'res' && m.id === '9');
    expect(res.error).toMatch(/No editor/);
    agent.close();
  });

  it('expires the session when the host disconnects', async () => {
    const token = 'tok-expire-' + Math.random().toString(36).slice(2);
    const host = await connect(`${base()}?token=${token}&role=host`);
    await host.waitFor((m) => m.type === 'ready');
    const agent = await connect(`${base()}?token=${token}&role=agent`);
    await agent.waitFor((m) => m.type === 'ready');

    host.close();
    await agent.waitFor((m) => m.type === 'host-left');
    await agent.waitClose();
    expect(relay.sessions.has(token)).toBe(false);
  });

  it('rejects an invalid role', async () => {
    const c = await connect(`${base()}?token=whatever&role=bogus`);
    const info = await c.waitClose();
    expect(info.code).toBe(1008);
  });

  it('carries a large fragmented message intact (>64KB)', async () => {
    const token = 'tok-big-' + Math.random().toString(36).slice(2);
    const host = await connect(`${base()}?token=${token}&role=host`);
    await host.waitFor((m) => m.type === 'ready');
    const agent = await connect(`${base()}?token=${token}&role=agent`);
    await agent.waitFor((m) => m.type === 'ready');

    const big = 'x'.repeat(200000);
    agent.send({ type: 'req', id: 'big', method: 'echo', params: { big } });
    const req = await host.waitFor((m) => m.type === 'req' && m.id === 'big');
    expect(req.params.big.length).toBe(200000);
    expect(req.params.big).toBe(big);
    agent.close(); host.close();
  });

  it('serves /health over HTTP', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/health`);
    const j = await r.json();
    expect(j.ok).toBe(true);
    expect(typeof j.sessions).toBe('number');
  });
});