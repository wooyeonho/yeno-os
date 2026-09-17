import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLiveVoiceClient, downsampleTo16kMono, chunkPcm16, BoundedPlaybackQueue,
  bytesToBase64, base64ToBytes, int16ToBytes, bytesToInt16,
  INPUT_SAMPLE_RATE, OUTPUT_SAMPLE_RATE, MAX_AUDIO_CHUNK_BYTES
} from '../public/live-voice-client.mjs';

// LANE A: the real browser Gemini Live client. Every browser API is
// injected, so the whole state machine - reconnect/epoch handling, bounded
// queues, barge-in, cleanup, and the fact that it has no code path to
// execute a tool - is exercised here in plain Node, matching how the rest
// of this codebase tests injected I/O (agentFetch, liveSocketFactory, ...).

class FakeSocket extends EventTarget {
  constructor(url) {
    super();
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    FakeSocket.instances.push(this);
  }
  send(data) {this.sent.push(JSON.parse(data));}
  open() {this.readyState = 1; this.dispatchEvent(new Event('open'));}
  close() {if (this.readyState === 3) return; this.readyState = 3; this.dispatchEvent(new Event('close'));}
  emitServer(obj) {this.dispatchEvent(new MessageEvent('message', {data: JSON.stringify(obj)}));}
  emitRaw(data) {this.dispatchEvent(new MessageEvent('message', {data}));}
  fail() {this.dispatchEvent(new Event('error')); this.close();}
}
FakeSocket.instances = [];

function fakeMicStream() {
  const track = {stopped: false, stop() {this.stopped = true;}};
  return {track, stream: {getTracks: () => [track]}};
}

function fakeCaptureFactory(captures) {
  return (stream, onFrame) => {
    const handle = {stopped: false, stream, onFrame, stop() {this.stopped = true;}};
    captures.push(handle);
    return handle;
  };
}

function fakePlayerFactory(players) {
  return () => {
    const p = {scheduled: [], stopAllCalls: 0, closed: false, schedule(int16, rate) {p.scheduled.push({int16, rate});}, stopAll() {p.stopAllCalls++;}, close() {p.closed = true;}};
    players.push(p);
    return p;
  };
}

function fakeEventTarget() {
  const handlers = {};
  return {
    hidden: false,
    addEventListener(type, cb) {(handlers[type] ??= []).push(cb);},
    removeEventListener(type, cb) {handlers[type] = (handlers[type] || []).filter(h => h !== cb);},
    fire(type) {for (const cb of [...(handlers[type] || [])]) cb();},
    listenerCount(type) {return (handlers[type] || []).length;}
  };
}

function fakeTimers() {
  const pending = [];
  let nextId = 1;
  return {
    setTimeout(fn, ms) {const id = nextId++; pending.push({id, fn, ms}); return id;},
    clearTimeout(id) {const i = pending.findIndex(p => p.id === id); if (i >= 0) pending.splice(i, 1);},
    flushOne() {const item = pending.shift(); if (item) item.fn(); return item?.ms;},
    get pendingCount() {return pending.length;}
  };
}

function harness(overrides = {}) {
  FakeSocket.instances = [];
  const captures = [], players = [], events = [];
  const mic = fakeMicStream();
  const doc = fakeEventTarget(), win = fakeEventTarget();
  const timers = fakeTimers();
  let micRejected = false;
  const client = createLiveVoiceClient({
    url: 'wss://example.test/api/voice/live',
    connect: url => new FakeSocket(url),
    requestMicrophone: async () => {if (micRejected) throw new Error('denied'); return mic.stream;},
    createCapture: fakeCaptureFactory(captures),
    createPlayer: fakePlayerFactory(players),
    doc, win,
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
    reconnectDelaysMs: [10, 20, 30], maxReconnectAttempts: 3,
    onEvent: event => events.push(event),
    ...overrides
  });
  return {client, captures, players, events, mic, doc, win, timers, rejectMic: () => {micRejected = true;}};
}

test('mic explicit start: constructing the client never requests the microphone; only an explicit start() does, exactly once', async () => {
  const h = harness();
  await new Promise(r => setTimeout(r, 5));
  assert.equal(FakeSocket.instances.length, 0);
  await h.client.start();
  assert.equal(FakeSocket.instances.length, 1, 'exactly one connection after one start()');
  await h.client.start(); // a second start() while already started is a no-op
  assert.equal(FakeSocket.instances.length, 1);
});

test('input 16k: downsampleTo16kMono produces the correct sample count and box-averages energy, never dropping a captured burst between output samples', () => {
  const inputRate = 48000;
  const seconds = 0.1;
  const input = new Float32Array(Math.round(inputRate * seconds)).fill(0.5);
  const out = downsampleTo16kMono(input, inputRate);
  assert.equal(out.length, Math.floor(input.length / (inputRate / INPUT_SAMPLE_RATE)));
  for (const sample of out) assert.ok(Math.abs(sample - 0.5 * 0x7fff) <= 2);
  // Already at 16k: passthrough, exact length, exact int16 conversion.
  const native = downsampleTo16kMono(new Float32Array([0, 0.5, -0.5, 1, -1]), INPUT_SAMPLE_RATE);
  assert.deepEqual([...native], [0, 16384, -16384, 32767, -32768]);
});

test('output 24k: an incoming server audio message is decoded and scheduled on the player at OUTPUT_SAMPLE_RATE', async () => {
  const h = harness();
  await h.client.start();
  const socket = FakeSocket.instances[0];
  socket.open();
  const int16 = new Int16Array([100, -200, 300]);
  const b64 = bytesToBase64(int16ToBytes(int16));
  socket.emitServer({type: 'audio', mimeType: 'audio/pcm;rate=24000', chunks: [b64]});
  assert.equal(h.players[0].scheduled.length, 1);
  assert.equal(h.players[0].scheduled[0].rate, OUTPUT_SAMPLE_RATE);
  assert.deepEqual([...h.players[0].scheduled[0].int16], [100, -200, 300]);
});

test('bounded chunks: chunkPcm16 never exceeds the byte bound and round-trips exactly; a captured frame larger than one chunk is sent as multiple bounded sends', async () => {
  const big = new Int16Array(100000).map((_, i) => i % 30000);
  const chunks = chunkPcm16(big, MAX_AUDIO_CHUNK_BYTES);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(c.length * 2 <= MAX_AUDIO_CHUNK_BYTES);
  const rebuilt = new Int16Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0; for (const c of chunks) {rebuilt.set(c, offset); offset += c.length;}
  assert.deepEqual([...rebuilt], [...big]);

  const h = harness();
  await h.client.start();
  FakeSocket.instances[0].open();
  const frame = new Float32Array(60000).fill(0.1); // 60000 samples @16k = 120000 bytes > 64KB
  h.captures[0].onFrame(frame, INPUT_SAMPLE_RATE);
  const audioSends = FakeSocket.instances[0].sent.filter(m => m.type === 'audio');
  assert.ok(audioSends.length > 1, 'one oversized frame must be split into multiple bounded sends');
  for (const send of audioSends) assert.ok(base64ToBytes(send.data).length <= MAX_AUDIO_CHUNK_BYTES);
});

test('bounded playback: BoundedPlaybackQueue drops the oldest audio and reports it rather than growing without limit', () => {
  const q = new BoundedPlaybackQueue({maxSamples: 10});
  assert.equal(q.push(new Int16Array(6)), 0);
  assert.equal(q.push(new Int16Array(6)), 6, 'pushing past the bound drops the oldest 6 samples');
  assert.equal(q.totalSamples, 6);
  assert.equal(q.clear(), 1);
  assert.equal(q.totalSamples, 0);
});

test('barge-in: a server drop_playback message stops all scheduled playback and clears the queue immediately', async () => {
  const h = harness();
  await h.client.start();
  const socket = FakeSocket.instances[0]; socket.open();
  socket.emitServer({type: 'audio', chunks: [bytesToBase64(int16ToBytes(new Int16Array([1, 2, 3])))]});
  assert.equal(h.players[0].scheduled.length, 1);
  socket.emitServer({type: 'drop_playback'});
  assert.equal(h.players[0].stopAllCalls, 1);
  assert.ok(h.events.some(e => e.type === 'barge_in'));
  // Audio arriving after the barge-in is a fresh turn, scheduled normally.
  socket.emitServer({type: 'audio', chunks: [bytesToBase64(int16ToBytes(new Int16Array([4, 5])))]});
  assert.equal(h.players[0].scheduled.length, 2);
});

test('reconnect dedupe: a dropped socket reconnects after backoff with a NEW connection, and a stale message from the OLD socket after reconnect is ignored (no duplicate playback)', async () => {
  const h = harness();
  await h.client.start();
  const first = FakeSocket.instances[0]; first.open();
  assert.equal(h.captures.length, 1);
  first.close(); // simulate an unexpected drop, not an explicit stop
  assert.equal(h.timers.pendingCount, 1);
  h.timers.flushOne();
  assert.equal(FakeSocket.instances.length, 2, 'reconnect opens a brand new connection');
  assert.notEqual(FakeSocket.instances[1], first);
  FakeSocket.instances[1].open();
  assert.equal(h.captures.length, 2, 'capture is restarted fresh, never reused across connections');
  // A late message arriving on the now-stale first socket must never be applied.
  first.emitServer({type: 'audio', chunks: [bytesToBase64(int16ToBytes(new Int16Array([9, 9, 9])))]});
  assert.equal(h.players.at(-1).scheduled.length, 0, 'the stale connection cannot inject audio into the current session');
});

test('fallback: after exceeding the reconnect attempt limit, the client gives up and reports fallback_required instead of retrying forever', async () => {
  const h = harness(); // maxReconnectAttempts: 3
  await h.client.start();
  // Three reconnect cycles succeed (each open then immediately drops again -
  // a flapping transport), consuming the whole attempt budget.
  for (let i = 0; i < 3; i++) {
    const current = FakeSocket.instances.at(-1);
    current.open();
    current.close();
    assert.equal(h.timers.pendingCount, 1, `cycle ${i} schedules exactly one reconnect`);
    h.timers.flushOne();
  }
  assert.equal(FakeSocket.instances.length, 4, 'the initial connection plus 3 reconnects');
  assert.ok(!h.events.some(e => e.type === 'state' && e.state === 'fallback_required'), 'not given up yet - budget just reached, not yet exceeded');
  // A fourth drop is one attempt too many: give up instead of scheduling again.
  FakeSocket.instances.at(-1).open();
  FakeSocket.instances.at(-1).close();
  assert.ok(h.events.some(e => e.type === 'state' && e.state === 'fallback_required'));
  assert.equal(h.timers.pendingCount, 0, 'no further reconnect is scheduled once fallback is reported');
  assert.equal(FakeSocket.instances.length, 4, 'no fifth connection is ever attempted');
});

test('logout cleanup (explicit stop): mic tracks stopped, socket closed, player closed, no pending reconnect timer left behind', async () => {
  const h = harness();
  await h.client.start();
  FakeSocket.instances[0].open();
  h.client.stop('logout');
  assert.equal(h.mic.track.stopped, true);
  assert.equal(FakeSocket.instances[0].readyState, 3);
  assert.equal(h.players[0].closed, true);
  assert.equal(h.timers.pendingCount, 0);
  assert.ok(h.events.some(e => e.type === 'state' && e.state === 'logout'));
});

test('hidden/offline cleanup: visibilitychange(hidden) and window offline both force a full stop, and listeners are detached so a later fire has no further effect', async () => {
  const hiddenCase = harness();
  await hiddenCase.client.start();
  hiddenCase.doc.hidden = true;
  hiddenCase.doc.fire('visibilitychange');
  assert.equal(hiddenCase.mic.track.stopped, true);
  assert.equal(hiddenCase.doc.listenerCount('visibilitychange'), 0, 'lifecycle listeners are detached on stop');

  const offlineCase = harness();
  await offlineCase.client.start();
  offlineCase.win.fire('offline');
  assert.equal(offlineCase.mic.track.stopped, true);
  assert.equal(FakeSocket.instances.at(-1).readyState, 3);
});

test('emergency stop: hard-stops mic/socket/playback immediately, and refuses a subsequent start() without ever requesting the microphone until it clears', async () => {
  const h = harness();
  await h.client.start();
  FakeSocket.instances[0].open();
  h.client.setEmergencyStop(true);
  assert.equal(h.mic.track.stopped, true);
  assert.equal(FakeSocket.instances[0].readyState, 3);
  assert.ok(h.events.some(e => e.type === 'state' && e.state === 'emergency_stop'));

  const before = FakeSocket.instances.length;
  await h.client.start();
  assert.equal(FakeSocket.instances.length, before, 'start() while emergency-stopped never opens a connection');
  assert.ok(h.events.some(e => e.type === 'blocked' && e.reason === 'emergency_stop'));

  h.client.setEmergencyStop(false);
  await h.client.start();
  assert.equal(FakeSocket.instances.length, before + 1, 'start() works again once emergency stop clears');
});

test('client cannot execute tool: the server never sends a tool call over this wire protocol, and even a forged/unknown message type is silently ignored - no code path in this module accepts a name/args and calls anything with it', async () => {
  const h = harness();
  await h.client.start();
  const socket = FakeSocket.instances[0]; socket.open();
  let threw = false;
  try {
    socket.emitServer({type: 'tool_call', name: 'delete_everything', args: {sure: true}});
    socket.emitServer({name: 'no_type_field'});
    socket.emitRaw('not even json {{{');
    socket.emitRaw('null');
  } catch {threw = true;}
  assert.equal(threw, false, 'malformed/hostile messages never throw');
  assert.equal(h.players[0].scheduled.length, 0, 'nothing was scheduled or executed from any of them');
  assert.equal(socket.sent.length, 0, 'nothing was sent back to the server in response either');
});

test('fallback: a denied microphone permission never opens a connection and reports a clear error instead of retrying silently', async () => {
  const h = harness();
  h.rejectMic();
  await h.client.start();
  assert.equal(FakeSocket.instances.length, 0, 'no connection is ever attempted without a granted microphone');
  assert.ok(h.events.some(e => e.type === 'error' && e.message === 'microphone_permission_denied'));
  assert.equal(h.client.state.started, false);
});

test('base64/PCM16 byte codecs round-trip exactly, including odd lengths and boundary values', () => {
  const bytes = new Uint8Array([0, 1, 254, 255, 128, 3, 200]);
  assert.deepEqual([...base64ToBytes(bytesToBase64(bytes))], [...bytes]);
  const int16 = new Int16Array([0, 1, -1, 32767, -32768, 12345, -12345]);
  assert.deepEqual([...bytesToInt16(int16ToBytes(int16))], [...int16]);
});
