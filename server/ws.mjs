/**
 * Minimal, dependency-free RFC6455 WebSocket server (the subset a local
 * JSON relay needs): handshake, masked client frames, text/binary,
 * fragmentation reassembly, ping/pong, close. Verified end-to-end against
 * Node's built-in WebSocket client in tests/relay.test.ts.
 *
 * Not a general-purpose ws replacement — it intentionally rejects oversized
 * frames and only supports what the relay uses.
 */
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 8 * 1024 * 1024; // 8 MB cap; project JSON is far smaller

export function acceptKey(key) {
  return createHash('sha1').update(key + GUID).digest('base64');
}

export class WSConnection extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.fragmentOpcode = 0;
    this.closed = false;
    this.isAlive = true;
    this._totalFragment = 0;
    socket.setNoDelay(true);
    socket.on('data', (d) => this._onData(d));
    socket.on('close', () => this._emitClose());
    socket.on('error', () => this._emitClose());
  }

  _emitClose() {
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
  }

  _onData(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    for (;;) {
      const buf = this.buffer;
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0;
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2); offset = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        const big = buf.readBigUInt64BE(2);
        if (big > BigInt(MAX_MESSAGE)) { this.close(1009); return; }
        len = Number(big); offset = 10;
      }
      if (len > MAX_MESSAGE) { this.close(1009); return; }
      let mask = null;
      if (masked) {
        if (buf.length < offset + 4) return;
        mask = buf.subarray(offset, offset + 4); offset += 4;
      }
      if (buf.length < offset + len) return;
      let payload = buf.subarray(offset, offset + len);
      if (mask) {
        const out = Buffer.allocUnsafe(len);
        for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i & 3];
        payload = out;
      }
      this.buffer = buf.subarray(offset + len);
      this._handleFrame(fin, opcode, payload);
      if (this.closed) return;
    }
  }

  _handleFrame(fin, opcode, payload) {
    if (opcode === 0x8) { this.close(1000); return; }
    if (opcode === 0x9) { this._sendFrame(0xA, payload); return; } // ping -> pong
    if (opcode === 0xA) { this.isAlive = true; return; } // pong
    if (opcode === 0x0 || opcode === 0x1 || opcode === 0x2) {
      if (opcode !== 0x0) { this.fragmentOpcode = opcode; this.fragments = []; this._totalFragment = 0; }
      this.fragments.push(payload);
      this._totalFragment += payload.length;
      if (this._totalFragment > MAX_MESSAGE) { this.close(1009); return; }
      if (fin) {
        const full = Buffer.concat(this.fragments);
        this.fragments = [];
        this._totalFragment = 0;
        this.emit('message', this.fragmentOpcode === 0x1 ? full.toString('utf8') : full);
      }
      return;
    }
    this.close(1002); // unknown opcode
  }

  _sendFrame(opcode, payload) {
    if (this.closed) return;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.from([0x80 | opcode, len]);
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2);
    }
    try { this.socket.write(Buffer.concat([header, payload])); } catch { this._emitClose(); }
  }

  send(data) {
    const payload = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    this._sendFrame(typeof data === 'string' ? 0x1 : 0x2, payload);
  }

  ping() { this.isAlive = false; this._sendFrame(0x9, Buffer.alloc(0)); }

  close(code = 1000) {
    if (this.closed) return;
    this.closed = true;
    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(code, 0);
    try { this.socket.write(Buffer.concat([Buffer.from([0x88, 2]), payload])); } catch { /* ignore */ }
    try { this.socket.end(); } catch { /* ignore */ }
    this.emit('close');
  }
}

/** Complete the HTTP upgrade and hand back a live connection. */
export function handleUpgrade(req, socket, head, onConnection) {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') {
    socket.destroy();
    return;
  }
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
  );
  const conn = new WSConnection(socket);
  if (head && head.length) conn._onData(head);
  onConnection(conn, req);
}