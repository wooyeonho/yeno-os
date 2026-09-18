import TauriSocket, { type Message } from '@tauri-apps/plugin-websocket';
import { normalizeOrigin } from './native-studio.ts';

// Bridges @tauri-apps/plugin-websocket's async, Rust-side WebSocket - whose
// connect() can carry an Authorization header on the handshake, unlike the
// WebView's own JS-level WebSocket - into the plain EventTarget shape
// (`addEventListener('open'|'message'|'close'|'error')`, `.send()`,
// `.close()`, `.readyState`) that runtime/public/live-voice-client.mjs's
// `deps.connect` expects. This lets the native controller reuse that
// module's entire reconnect/barge-in/emergency-stop/bounded-queue state
// machine unchanged instead of duplicating any of it here (issue #21 point 3).
//
// The wire protocol is JSON text frames only in both directions (see
// live-voice-client.mjs's header comment), so only Message.type==='Text'
// needs bridging; a stray 'Binary'/'Ping'/'Pong' frame is ignored rather
// than mis-delivered as a text message.

const OPEN = 1, CLOSED = 3;
type ConnectFn = typeof TauriSocket.connect;

export class NativeLiveSocket extends EventTarget {
  readyState = 0;
  private inner: TauriSocket | null = null;
  private closed = false;
  private unlisten: (() => void) | null = null;

  constructor(url: string, headers: Record<string, string>, connectImpl: ConnectFn = TauriSocket.connect) {
    super();
    void this.open(url, headers, connectImpl);
  }

  private async open(url: string, headers: Record<string, string>, connectImpl: ConnectFn) {
    let socket: TauriSocket;
    try {
      socket = await connectImpl(url, { headers });
    } catch {
      if (this.closed) return;
      this.readyState = CLOSED;
      this.dispatchEvent(new Event('error'));
      this.dispatchEvent(new Event('close'));
      return;
    }
    if (this.closed) { try { await socket.disconnect(); } catch { /* already tearing down */ } return; }
    this.inner = socket;
    this.readyState = OPEN;
    this.unlisten = socket.addListener(message => this.handleMessage(message));
    this.dispatchEvent(new Event('open'));
  }

  private handleMessage(message: Message) {
    if (this.closed) return;
    if (message.type === 'Text') this.dispatchEvent(new MessageEvent('message', { data: message.data }));
    else if (message.type === 'Close') this.forceClose();
  }

  private forceClose() {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    this.dispatchEvent(new Event('close'));
  }

  send(data: string) {
    if (this.readyState !== OPEN || !this.inner) return;
    void this.inner.send(data).catch(() => this.forceClose());
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    const socket = this.inner;
    this.inner = null;
    if (this.unlisten) { try { this.unlisten(); } catch { /* already gone */ } this.unlisten = null; }
    this.forceClose();
    if (socket) void socket.disconnect().catch(() => { /* already disconnected */ });
  }
}

// The paired device's bearer token travels only in the Rust-side handshake
// header, exactly as the existing HTTP calls in native-studio.ts/main.ts
// already send it - never in the URL, a query string, or any log line (this
// module never logs the token or the headers object).
export function makeNativeConnect(token: string, connectImpl?: ConnectFn) {
  if (!token) throw new Error('기기 연결 토큰이 없습니다.');
  return (url: string) => new NativeLiveSocket(url, { Authorization: `Bearer ${token}` }, connectImpl);
}

// A fixed literal path, never built from any caller-supplied suffix, so a
// live voice socket can never be pointed anywhere but the paired origin's
// own live endpoint - mirrors versionedUrl()'s origin enforcement in
// native-studio.ts but for the ws:/wss: scheme that WebSocket needs.
export function nativeLiveVoiceUrl(origin: string) {
  const validated = normalizeOrigin(origin);
  const url = new URL(validated);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/api/v1/voice/live';
  url.search = '';
  return url.href;
}
