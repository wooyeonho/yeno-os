import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeLiveSocket, makeNativeConnect, nativeLiveVoiceUrl } from '../src/live-voice-native.ts';

// This file only exercises the native Tauri-plugin-websocket <-> EventTarget
// bridge and the fixed connection-target builder. The reconnect/barge-in/
// emergency-stop/bounded-queue state machine that consumes this bridge (as
// deps.connect) is already exhaustively covered, with fakes, in
// runtime/test/live-voice-client.test.mjs and is reused completely
// unmodified - it is not re-tested here.

function fakeConnect({ shouldFail = false } = {}) {
  const calls = [];
  const sockets = [];
  const impl = async (url, config) => {
    calls.push({ url, config });
    if (shouldFail) throw new Error('connect failed');
    const listeners = new Set();
    const socket = {
      sent: [],
      disconnected: false,
      addListener(cb) { listeners.add(cb); return () => listeners.delete(cb); },
      async send(data) { socket.sent.push(data); },
      async disconnect() { socket.disconnected = true; },
      emit(message) { for (const cb of listeners) cb(message); },
    };
    sockets.push(socket);
    return socket;
  };
  return { impl, calls, sockets };
}
const flush = () => new Promise(r => setTimeout(r, 0));

test('connecting sends the bearer token only in the handshake header, never the URL, and dispatches open once resolved', async () => {
  const { impl, calls } = fakeConnect();
  const connect = makeNativeConnect('device-token-abc', impl);
  const ws = connect('wss://core.example/api/v1/voice/live');
  assert.equal(ws.readyState, 0);
  let opened = false;
  ws.addEventListener('open', () => { opened = true; });
  await flush();
  assert.equal(opened, true);
  assert.equal(ws.readyState, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'wss://core.example/api/v1/voice/live');
  assert.deepEqual(calls[0].config, { headers: { Authorization: 'Bearer device-token-abc' } });
  assert.doesNotMatch(calls[0].url, /device-token-abc/);
});

test('makeNativeConnect refuses to build a connector with no token', () => {
  assert.throws(() => makeNativeConnect(''), /토큰/);
});

test('an inbound Text message is delivered as a MessageEvent with the same payload; Binary/Ping/Pong are ignored', async () => {
  const { impl, sockets } = fakeConnect();
  const ws = new NativeLiveSocket('wss://core.example/api/v1/voice/live', { Authorization: 'Bearer t' }, impl);
  await flush();
  const received = [];
  ws.addEventListener('message', event => received.push(event.data));
  sockets[0].emit({ type: 'Text', data: JSON.stringify({ type: 'transcript', role: 'assistant', text: 'hi' }) });
  sockets[0].emit({ type: 'Binary', data: [1, 2, 3] });
  sockets[0].emit({ type: 'Ping', data: [] });
  assert.deepEqual(received, [JSON.stringify({ type: 'transcript', role: 'assistant', text: 'hi' })]);
});

test('an inbound Close message forces readyState to CLOSED and dispatches close exactly once', async () => {
  const { impl, sockets } = fakeConnect();
  const ws = new NativeLiveSocket('wss://core.example/api/v1/voice/live', { Authorization: 'Bearer t' }, impl);
  await flush();
  let closes = 0;
  ws.addEventListener('close', () => { closes++; });
  sockets[0].emit({ type: 'Close', data: { code: 1000, reason: '' } });
  assert.equal(ws.readyState, 3);
  sockets[0].emit({ type: 'Close', data: { code: 1000, reason: '' } });
  assert.equal(closes, 1, 'a second Close frame must not double-fire the close event');
});

test('send() while open forwards the exact string to the inner socket; send() before open or after close is a silent no-op', async () => {
  const { impl, sockets } = fakeConnect();
  const ws = new NativeLiveSocket('wss://core.example/api/v1/voice/live', { Authorization: 'Bearer t' }, impl);
  ws.send('too-early');
  await flush();
  ws.send(JSON.stringify({ type: 'audio', data: 'QUJD' }));
  assert.deepEqual(sockets[0].sent, [JSON.stringify({ type: 'audio', data: 'QUJD' })]);
  ws.close();
  ws.send('too-late');
  assert.deepEqual(sockets[0].sent, [JSON.stringify({ type: 'audio', data: 'QUJD' })]);
});

test('close() before the pending connect resolves prevents open from ever firing and disconnects the late socket', async () => {
  const { impl, sockets } = fakeConnect();
  const ws = new NativeLiveSocket('wss://core.example/api/v1/voice/live', { Authorization: 'Bearer t' }, impl);
  let opened = false;
  ws.addEventListener('open', () => { opened = true; });
  ws.close();
  await flush();
  assert.equal(opened, false);
  assert.equal(ws.readyState, 3);
  assert.equal(sockets[0].disconnected, true, 'the socket that connected after close() must still be disconnected, never left dangling');
});

test('close() calls disconnect on an already-open socket and dispatches close synchronously', async () => {
  const { impl, sockets } = fakeConnect();
  const ws = new NativeLiveSocket('wss://core.example/api/v1/voice/live', { Authorization: 'Bearer t' }, impl);
  await flush();
  ws.close();
  assert.equal(ws.readyState, 3);
  await flush();
  assert.equal(sockets[0].disconnected, true);
});

test('a connect() failure dispatches error then close, and never leaves readyState stuck at CONNECTING', async () => {
  const { impl } = fakeConnect({ shouldFail: true });
  const ws = new NativeLiveSocket('wss://core.example/api/v1/voice/live', { Authorization: 'Bearer t' }, impl);
  const events = [];
  ws.addEventListener('error', () => events.push('error'));
  ws.addEventListener('close', () => events.push('close'));
  await flush();
  assert.deepEqual(events, ['error', 'close']);
  assert.equal(ws.readyState, 3);
});

test('this bridge never parses or interprets message payloads - a server message shaped like a tool call is relayed as inert text, never acted on here', async () => {
  const { impl, sockets } = fakeConnect();
  const ws = new NativeLiveSocket('wss://core.example/api/v1/voice/live', { Authorization: 'Bearer t' }, impl);
  await flush();
  const received = [];
  ws.addEventListener('message', event => received.push(event.data));
  const hostile = JSON.stringify({ type: 'tool_call', name: 'deleteEverything', args: { confirm: true } });
  sockets[0].emit({ type: 'Text', data: hostile });
  assert.deepEqual(received, [hostile], 'the payload is only ever handed off verbatim as event.data - this module has no JSON.parse, no dispatch table, and no code path that could invoke anything from it');
});

test('nativeLiveVoiceUrl always targets the fixed /api/v1/voice/live path on the paired origin, mapping https->wss and rejecting a non-normalized origin', () => {
  assert.equal(nativeLiveVoiceUrl('https://core.example'), 'wss://core.example/api/v1/voice/live');
  assert.equal(nativeLiveVoiceUrl('http://localhost:8080'), 'ws://localhost:8080/api/v1/voice/live');
  assert.throws(() => nativeLiveVoiceUrl('https://core.example/some/path'));
  assert.throws(() => nativeLiveVoiceUrl('https://user:pass@core.example'));
  assert.throws(() => nativeLiveVoiceUrl('not a url'));
});
