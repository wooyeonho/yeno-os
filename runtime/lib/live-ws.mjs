import crypto from 'node:crypto';
import {EventEmitter} from 'node:events';

// Minimal RFC 6455 WebSocket SERVER, Node builtins only (no `ws` dependency -
// this project ships zero runtime npm dependencies and that is deliberate).
// Used for the browser-facing side of the Gemini Live voice path; the
// outbound side (this process -> Gemini) uses Node's own built-in client
// `WebSocket`. Server frames are never masked (RFC 6455 5.1); client frames
// MUST be masked and this rejects any that are not. Supports text/binary
// messages (with continuation-frame reassembly), ping/pong (auto-replies to
// ping), and close. A message or an unmasked/oversized/malformed frame that
// violates the protocol closes the connection rather than being tolerated.
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
export const MAX_MESSAGE_BYTES = 2 * 1024 * 1024;

export function isWebSocketUpgrade(req) {
  return req.method === 'GET' && /(^|,)\s*upgrade\s*(,|$)/i.test(req.headers.connection ?? '')
    && /^websocket$/i.test(req.headers.upgrade ?? '') && typeof req.headers['sec-websocket-key'] === 'string';
}

// Completes the handshake and returns a connection object with .send(data,
// {binary}), .close(code, reason), .on('message'|'close'|'error', cb). The
// underlying TCP socket is owned by this connection from here on - the
// caller must not read/write it directly again.
export function acceptUpgrade(req, socket, {maxMessageBytes = MAX_MESSAGE_BYTES} = {}) {
  const key = req.headers['sec-websocket-key'];
  if (req.headers['sec-websocket-version'] !== '13' || typeof key !== 'string' || !key) {
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return null;
  }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);
  return new ServerConnection(socket, maxMessageBytes);
}

function frame(opcode, payload) {
  const len = payload.length;
  const header = len < 126 ? Buffer.from([0x80 | opcode, len])
    : len < 65536 ? Buffer.from([0x80 | opcode, 126, len >> 8, len & 0xff])
    : Buffer.concat([Buffer.from([0x80 | opcode, 127]), (() => {const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(len)); return b;})()]);
  return Buffer.concat([header, payload]);
}

class ServerConnection extends EventEmitter {
  constructor(socket, maxMessageBytes) {
    super();
    this.socket = socket;
    this.maxMessageBytes = maxMessageBytes;
    this.closed = false;
    this._buffer = Buffer.alloc(0);
    this._fragments = [];
    this._fragmentOpcode = null;
    socket.on('data', chunk => this._onData(chunk));
    socket.on('close', () => this._onClose());
    socket.on('error', error => {if (!this.closed) this.emit('error', error);});
  }
  send(data, {binary = false} = {}) {
    if (this.closed) return;
    const payload = binary ? Buffer.from(data) : Buffer.from(String(data), 'utf8');
    try {this.socket.write(frame(binary ? 0x2 : 0x1, payload));} catch (error) {this.emit('error', error);}
  }
  ping() {if (!this.closed) try {this.socket.write(frame(0x9, Buffer.alloc(0)));} catch {}}
  close(code = 1000, reason = '') {
    if (this.closed) return;
    this.closed = true;
    const body = Buffer.concat([Buffer.from([code >> 8, code & 0xff]), Buffer.from(reason, 'utf8')]);
    try {this.socket.write(frame(0x8, body));} catch {}
    this.socket.end();
  }
  _fail(reason) {
    if (this.closed) return;
    this.closed = true;
    try {this.socket.destroy();} catch {}
    this.emit('error', new Error(reason));
  }
  _onClose() {if (!this.closed) {this.closed = true; this.emit('close');} }
  _onData(chunk) {
    this._buffer = this._buffer.length ? Buffer.concat([this._buffer, chunk]) : chunk;
    // Bound the unparsed receive buffer itself, independent of any one
    // frame's declared length, so a slow drip of tiny frames cannot grow
    // memory without limit either.
    if (this._buffer.length > this.maxMessageBytes * 2) return this._fail('receive buffer exceeded');
    for (;;) {
      const consumed = this._tryParseOne();
      if (consumed === 0) return;
      if (this.closed) return;
      this._buffer = this._buffer.subarray(consumed);
    }
  }
  // Returns bytes consumed for one complete frame, or 0 if more data is needed.
  _tryParseOne() {
    const buf = this._buffer;
    if (buf.length < 2) return 0;
    const fin = (buf[0] & 0x80) !== 0, opcode = buf[0] & 0x0f, masked = (buf[1] & 0x80) !== 0;
    let len = buf[1] & 0x7f, offset = 2;
    if (len === 126) {
      if (buf.length < 4) return 0;
      len = buf.readUInt16BE(2); offset = 4;
    } else if (len === 127) {
      if (buf.length < 10) return 0;
      const big = buf.readBigUInt64BE(2);
      if (big > BigInt(this.maxMessageBytes)) {this._fail('frame too large'); return 0;}
      len = Number(big); offset = 10;
    }
    if (!masked) {this._fail('client frame not masked'); return 0;}
    if (len > this.maxMessageBytes) {this._fail('frame too large'); return 0;}
    const total = offset + 4 + len;
    if (buf.length < total) return 0;
    const maskKey = buf.subarray(offset, offset + 4);
    const payload = Buffer.alloc(len);
    const masked_ = buf.subarray(offset + 4, total);
    for (let i = 0; i < len; i++) payload[i] = masked_[i] ^ maskKey[i & 3];
    this._handleFrame(fin, opcode, payload);
    return total;
  }
  _handleFrame(fin, opcode, payload) {
    if (opcode === 0x8) {this.closed = true; try {this.socket.end();} catch {} this.emit('close'); return;}
    if (opcode === 0x9) {try {this.socket.write(frame(0xA, payload));} catch {} return;}
    if (opcode === 0xA) return;
    if (opcode === 0x0) {
      if (this._fragmentOpcode === null) return this._fail('unexpected continuation frame');
      this._fragments.push(payload);
    } else if (opcode === 0x1 || opcode === 0x2) {
      if (this._fragmentOpcode !== null) return this._fail('expected continuation frame');
      if (fin) {this._emitMessage(opcode, payload); return;}
      this._fragmentOpcode = opcode; this._fragments = [payload];
      return;
    } else {
      return this._fail(`unsupported opcode ${opcode}`);
    }
    if (fin) {
      const opcode_ = this._fragmentOpcode;
      const full = Buffer.concat(this._fragments);
      this._fragmentOpcode = null; this._fragments = [];
      this._emitMessage(opcode_, full);
    } else if (this._fragments.reduce((n, b) => n + b.length, 0) > this.maxMessageBytes) {
      this._fail('fragmented message too large');
    }
  }
  _emitMessage(opcode, payload) {
    if (payload.length > this.maxMessageBytes) return this._fail('message too large');
    this.emit('message', opcode === 0x1 ? payload.toString('utf8') : payload, {binary: opcode === 0x2});
  }
}
