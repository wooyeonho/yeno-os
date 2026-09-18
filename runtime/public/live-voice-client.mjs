// Real Gemini Live browser voice client: mic -> PCM16 16kHz -> /api/voice/live
// -> server -> Gemini Live -> PCM16 24kHz -> speaker. This is the ONLY code
// path that talks to the live WS endpoint; SpeechRecognition/speechSynthesis
// stay a completely separate, untouched fallback in voice-view.mjs.
//
// Every browser API this module touches (getUserMedia, AudioContext, the
// WebSocket, document/window) is injected via `deps`, with real browser
// globals as the default. That is deliberate: it lets the whole state
// machine - reconnect/epoch handling, bounded queues, barge-in, cleanup -
// be exercised in a plain Node test with fakes, matching how the rest of
// this codebase tests injected I/O (agentFetch, liveSocketFactory, ...)
// rather than reaching for a browser test harness.
//
// Wire protocol matches server.mjs's /api/voice/live handling exactly:
//   client -> server: {type:'audio', data: base64 PCM16} | {type:'audio_end'} | {type:'text', text}
//   server -> client: {type:'audio', mimeType, chunks: base64[]} | {type:'transcript', role, text}
//                    | {type:'drop_playback'} | {type:'blocked', reason}
// The server never sends a raw tool call to the browser - tool asks are
// settled and executed entirely server-side (see server.mjs's
// handleLiveConnection). This client therefore has no code path that could
// execute a tool even for a malformed/hostile message: handleServerMessage
// only recognizes the four message types above and silently ignores anything
// else.

export const INPUT_SAMPLE_RATE = 16000;
export const OUTPUT_SAMPLE_RATE = 24000;
// Matches gemini-live.mjs's MAX_AUDIO_CHUNK_BYTES so a captured frame can
// never produce a chunk the server would reject as too large.
export const MAX_AUDIO_CHUNK_BYTES = 64 * 1024;
// Bounded playback lookahead: if the server ever streamed audio faster than
// real time (or a drop_playback was missed), buffered audio is capped at
// this many seconds rather than growing without limit.
export const MAX_PLAYBACK_QUEUE_SECONDS = 12;
export const DEFAULT_RECONNECT_DELAYS_MS = Object.freeze([500, 1000, 2000, 4000, 8000]);
export const DEFAULT_MAX_RECONNECT_ATTEMPTS = 5;

// --- base64 <-> bytes, dependency-free (works identically in a browser and
// in a plain Node test - no Buffer, no btoa/atob) -----------------------
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function bytesToBase64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
    out += B64_CHARS[b0 >> 2];
    out += B64_CHARS[((b0 & 0x03) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    out += b1 === undefined ? '=' : B64_CHARS[((b1 & 0x0f) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    out += b2 === undefined ? '=' : B64_CHARS[b2 & 0x3f];
  }
  return out;
}
export function base64ToBytes(b64) {
  const clean = String(b64).replace(/=+$/, '');
  const bytes = [];
  let buffer = 0, bits = 0;
  for (const ch of clean) {
    const value = B64_CHARS.indexOf(ch);
    if (value === -1) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {bits -= 8; bytes.push((buffer >> bits) & 0xff);}
  }
  return new Uint8Array(bytes);
}

// --- PCM16 <-> bytes, explicit little-endian regardless of host order ---
export function int16ToBytes(int16) {
  const bytes = new Uint8Array(int16.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < int16.length; i++) view.setInt16(i * 2, int16[i], true);
  return bytes;
}
export function bytesToInt16(bytes) {
  const usable = bytes.length - (bytes.length % 2);
  const out = new Int16Array(usable / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true);
  return out;
}

function clampSample(sample) {
  return Math.max(-1, Math.min(1, sample));
}
function floatSampleToInt16(sample) {
  const s = clampSample(sample);
  return Math.round(s < 0 ? s * 0x8000 : s * 0x7fff);
}

// Downsamples one captured Float32 frame (at whatever rate the AudioContext
// actually runs, e.g. 48kHz) to mono PCM16 at INPUT_SAMPLE_RATE. Box-average
// per output sample rather than nearest-neighbour, so a burst of energy
// between output samples is not silently skipped.
export function downsampleTo16kMono(float32, inputSampleRate) {
  if (!float32.length) return new Int16Array(0);
  if (inputSampleRate === INPUT_SAMPLE_RATE) {
    const out = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) out[i] = floatSampleToInt16(float32[i]);
    return out;
  }
  const ratio = inputSampleRate / INPUT_SAMPLE_RATE;
  const outLength = Math.max(0, Math.floor(float32.length / ratio));
  const out = new Int16Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const start = Math.floor(i * ratio), end = Math.max(start + 1, Math.floor((i + 1) * ratio));
    let sum = 0, count = 0;
    for (let j = start; j < end && j < float32.length; j++) {sum += float32[j]; count++;}
    out[i] = floatSampleToInt16(count ? sum / count : 0);
  }
  return out;
}

// Splits PCM16 into chunks that never exceed maxBytes, always an even
// (whole-sample) byte count so a sample is never split across chunks.
export function chunkPcm16(int16, maxBytes = MAX_AUDIO_CHUNK_BYTES) {
  const maxSamples = Math.max(2, Math.floor(maxBytes / 2));
  const chunks = [];
  for (let i = 0; i < int16.length; i += maxSamples) chunks.push(int16.subarray(i, i + maxSamples));
  return chunks;
}

// A playback queue bounded by total sample count (wall-clock seconds worth
// of audio), never by message count alone. Overflow drops the OLDEST
// buffered audio - the newest is what is actually relevant to a live
// conversation - and reports how many samples were dropped so a caller can
// surface/measure it, never silently.
export class BoundedPlaybackQueue {
  constructor({maxSamples}) {
    this.maxSamples = maxSamples;
    this.items = [];
    this.totalSamples = 0;
  }
  push(int16) {
    this.items.push(int16);
    this.totalSamples += int16.length;
    let droppedSamples = 0;
    while (this.totalSamples > this.maxSamples && this.items.length > 1) {
      const removed = this.items.shift();
      this.totalSamples -= removed.length;
      droppedSamples += removed.length;
    }
    return droppedSamples;
  }
  shift() {
    const item = this.items.shift();
    if (item) this.totalSamples -= item.length;
    return item ?? null;
  }
  clear() {
    const removedCount = this.items.length;
    this.items = [];
    this.totalSamples = 0;
    return removedCount;
  }
  get length() {return this.items.length;}
}

const noop = () => {};

// --- real browser I/O adapters (the production defaults for `deps`) -----
//
// Each factory closes over the caller's own `win` (derived from the actual
// root DOM node, exactly like the rest of this codebase's *-view.mjs files -
// never a bare global) so this module works correctly if ever loaded
// alongside more than one window/realm, and so it can be exercised in a
// jsdom-backed test by simply supplying that jsdom window as `win`.

// Only reached if this module is ever used with no `win` available at all
// (no browser, no injected fake) - fails clearly rather than silently.
function realConnectFallback() {throw new Error('no window available for a live voice WebSocket connection');}
function realRequestMicrophoneFallback() {return Promise.reject(new Error('no window available to request the microphone'));}
function unsupportedCreateCapture() {throw new Error('no window available for audio capture');}
function unsupportedCreatePlayer() {throw new Error('no window available for audio playback');}

function makeRealConnect(win) {
  return url => new win.WebSocket(url);
}
function makeRealRequestMicrophone(win) {
  return () => win.navigator.mediaDevices.getUserMedia({audio: {channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true}});
}
// A ScriptProcessorNode is deprecated but universally supported without a
// separate worklet module file to load/serve; ok for this bounded, mono,
// modest-rate capture. `onFrame` is called with a Float32Array the caller
// must treat as transient - the node buffer is never queued or retained
// after the call returns unless the caller itself copies/queues it.
function makeRealCreateCapture(win) {
  return (stream, onFrame) => {
    const AudioCtx = win.AudioContext || win.webkitAudioContext;
    const context = new AudioCtx();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    // A ScriptProcessorNode only fires while connected into the graph, but
    // the capture itself must never be audible - route it through a silent
    // gain rather than straight to destination.
    const silence = context.createGain();
    silence.gain.value = 0;
    processor.onaudioprocess = event => onFrame(event.inputBuffer.getChannelData(0), context.sampleRate);
    source.connect(processor);
    processor.connect(silence);
    silence.connect(context.destination);
    return {
      stop() {
        try {processor.disconnect();} catch {}
        try {source.disconnect();} catch {}
        try {silence.disconnect();} catch {}
        try {context.close();} catch {}
      }
    };
  };
}
function makeRealCreatePlayer(win) {
  return () => realCreatePlayer(win);
}
function realCreatePlayer(win) {
  const AudioCtx = win.AudioContext || win.webkitAudioContext;
  const context = new AudioCtx({sampleRate: OUTPUT_SAMPLE_RATE});
  let nextStartTime = 0;
  const active = new Set();
  return {
    schedule(int16, sampleRate) {
      const buffer = context.createBuffer(1, int16.length, sampleRate);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < int16.length; i++) channel[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7fff);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      const startAt = Math.max(nextStartTime, context.currentTime);
      source.start(startAt);
      nextStartTime = startAt + buffer.duration;
      active.add(source);
      source.onended = () => active.delete(source);
    },
    stopAll() {
      for (const source of active) {try {source.stop();} catch {}}
      active.clear();
      nextStartTime = context.currentTime;
    },
    close() {
      for (const source of active) {try {source.stop();} catch {}}
      active.clear();
      try {context.close();} catch {}
    }
  };
}

// deps: {url, connect, requestMicrophone, createCapture, createPlayer, doc,
//   win, setTimeout, clearTimeout, maxAudioChunkBytes, maxPlaybackQueueSeconds,
//   reconnectDelaysMs, maxReconnectAttempts, onEvent}
export function createLiveVoiceClient(deps = {}) {
  const url = deps.url;
  const doc = deps.doc ?? (typeof document !== 'undefined' ? document : null);
  const win = deps.win ?? (typeof window !== 'undefined' ? window : null);
  const connect = deps.connect ?? (win ? makeRealConnect(win) : realConnectFallback);
  const requestMicrophone = deps.requestMicrophone ?? (win ? makeRealRequestMicrophone(win) : realRequestMicrophoneFallback);
  const createCapture = deps.createCapture ?? (win ? makeRealCreateCapture(win) : unsupportedCreateCapture);
  const createPlayer = deps.createPlayer ?? (win ? makeRealCreatePlayer(win) : unsupportedCreatePlayer);
  const setTimer = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimeout ?? (id => clearTimeout(id));
  const maxAudioChunkBytes = deps.maxAudioChunkBytes ?? MAX_AUDIO_CHUNK_BYTES;
  const maxPlaybackSamples = Math.round((deps.maxPlaybackQueueSeconds ?? MAX_PLAYBACK_QUEUE_SECONDS) * OUTPUT_SAMPLE_RATE);
  const reconnectDelaysMs = deps.reconnectDelaysMs ?? DEFAULT_RECONNECT_DELAYS_MS;
  const maxReconnectAttempts = deps.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;
  const onEvent = deps.onEvent ?? noop;

  let started = false;
  let explicitlyStopped = true;
  let emergencyStop = false;
  let connectionEpoch = 0;
  let reconnectAttempt = 0;
  let reconnectTimer = null;
  let socket = null;
  let capture = null;
  let player = null;
  let micStream = null;
  const playbackQueue = new BoundedPlaybackQueue({maxSamples: maxPlaybackSamples});
  let lifecycleAttached = false;

  function emit(event) {try {onEvent(event);} catch {}}

  function clearReconnectTimer() {
    if (reconnectTimer !== null) {clearTimer(reconnectTimer); reconnectTimer = null;}
  }
  function teardownCapture() {
    if (capture) {try {capture.stop();} catch {} capture = null;}
  }
  function teardownPlayer() {
    if (player) {try {player.close();} catch {} player = null;}
    playbackQueue.clear();
  }
  function teardownMic() {
    if (micStream) {for (const track of micStream.getTracks()) {try {track.stop();} catch {}} micStream = null;}
  }
  function teardownSocket() {
    if (socket) {try {socket.close();} catch {} socket = null;}
  }

  function beginCapture(epoch) {
    if (capture || !micStream) return;
    capture = createCapture(micStream, (float32, sampleRate) => {
      // A stale capture callback (old connection, already stopped/emergency-
      // stopped) must never reach the socket - checked on every single frame,
      // not just at connect time, since a frame can arrive mid-teardown.
      if (epoch !== connectionEpoch || explicitlyStopped || emergencyStop) return;
      if (!socket || socket.readyState !== 1) return;
      const pcm16 = downsampleTo16kMono(float32, sampleRate);
      if (!pcm16.length) return;
      for (const chunk of chunkPcm16(pcm16, maxAudioChunkBytes)) {
        socket.send(JSON.stringify({type: 'audio', data: bytesToBase64(int16ToBytes(chunk))}));
      }
    });
  }

  function handleServerMessage(epoch, raw) {
    if (epoch !== connectionEpoch) return;
    let msg;
    try {msg = JSON.parse(raw);} catch {return;}
    if (!msg || typeof msg.type !== 'string') return;
    // Every branch below only ever plays audio or reports text - there is no
    // branch, here or anywhere else in this module, that takes a name/args
    // field from a server message and calls anything with it. A hypothetical
    // {type:'tool_call', name, args} message (the server never actually
    // sends one) falls through to the default no-op just like any other
    // unrecognized type.
    if (msg.type === 'blocked') {emit({type: 'blocked', reason: msg.reason}); stop('blocked'); return;}
    if (msg.type === 'drop_playback') {
      player?.stopAll();
      const dropped = playbackQueue.clear();
      emit({type: 'barge_in', droppedChunks: dropped});
      return;
    }
    if (msg.type === 'transcript') {emit({type: 'transcript', role: msg.role, text: msg.text}); return;}
    if (msg.type === 'audio' && Array.isArray(msg.chunks)) {
      for (const b64 of msg.chunks) {
        if (typeof b64 !== 'string') continue;
        const int16 = bytesToInt16(base64ToBytes(b64));
        if (!int16.length) continue;
        const dropped = playbackQueue.push(int16);
        if (dropped) emit({type: 'playback_overflow', droppedSamples: dropped});
        player?.schedule(int16, OUTPUT_SAMPLE_RATE);
      }
    }
  }

  function scheduleReconnect() {
    if (reconnectAttempt >= maxReconnectAttempts) {
      explicitlyStopped = true;
      emit({type: 'state', state: 'fallback_required'});
      return;
    }
    const delay = reconnectDelaysMs[Math.min(reconnectAttempt, reconnectDelaysMs.length - 1)];
    reconnectAttempt++;
    emit({type: 'state', state: 'reconnecting', attempt: reconnectAttempt});
    reconnectTimer = setTimer(() => {
      reconnectTimer = null;
      if (!explicitlyStopped && !emergencyStop) connectSocket();
    }, delay);
  }

  function connectSocket() {
    const epoch = ++connectionEpoch;
    teardownCapture();
    let ws;
    try {ws = connect(url);}
    catch {emit({type: 'error', message: 'connect_failed'}); scheduleReconnect(); return;}
    socket = ws;
    ws.addEventListener('open', () => {
      if (epoch !== connectionEpoch) return;
      // reconnectAttempt is deliberately NOT reset here: a connection that
      // opens and immediately drops every time (a flapping/half-broken
      // transport) must still exhaust the attempt budget and report
      // fallback_required rather than retry forever. It only resets on an
      // explicit start() - i.e. the user pressing the mic again.
      if (!player) player = createPlayer();
      emit({type: 'state', state: 'listening'});
      beginCapture(epoch);
    });
    ws.addEventListener('message', event => handleServerMessage(epoch, event.data));
    ws.addEventListener('close', () => {
      if (epoch !== connectionEpoch) return;
      teardownCapture();
      if (explicitlyStopped || emergencyStop) {emit({type: 'state', state: 'stopped'}); return;}
      scheduleReconnect();
    });
    ws.addEventListener('error', () => emit({type: 'error', message: 'transport_error'}));
  }

  function attachLifecycle() {
    if (lifecycleAttached) return;
    lifecycleAttached = true;
    if (doc) doc.addEventListener('visibilitychange', onVisibilityChange);
    if (win) {
      win.addEventListener('offline', onOffline);
      win.addEventListener('pagehide', onPageHide);
    }
  }
  function detachLifecycle() {
    if (!lifecycleAttached) return;
    lifecycleAttached = false;
    if (doc) doc.removeEventListener('visibilitychange', onVisibilityChange);
    if (win) {
      win.removeEventListener('offline', onOffline);
      win.removeEventListener('pagehide', onPageHide);
    }
  }
  function onVisibilityChange() {if (doc?.hidden) stop('hidden');}
  function onOffline() {stop('offline');}
  function onPageHide() {stop('page_hidden');}

  // The only entry point that ever requests the microphone, and only ever
  // in direct response to a caller-driven call (the caller's job is to
  // invoke this from an explicit user gesture, e.g. a button click handler -
  // this module never calls it on its own, not on construction, not on
  // reconnect, not after an explicit stop()).
  async function start() {
    if (started) return;
    if (emergencyStop) {emit({type: 'blocked', reason: 'emergency_stop'}); return;}
    started = true;
    explicitlyStopped = false;
    reconnectAttempt = 0;
    attachLifecycle();
    emit({type: 'state', state: 'connecting'});
    let stream;
    try {stream = await requestMicrophone();}
    catch {
      started = false;
      explicitlyStopped = true;
      emit({type: 'error', message: 'microphone_permission_denied'});
      return;
    }
    if (explicitlyStopped) {for (const track of stream.getTracks()) {try {track.stop();} catch {}} return;}
    micStream = stream;
    connectSocket();
  }

  function stop(reason = 'stopped') {
    explicitlyStopped = true;
    started = false;
    connectionEpoch++; // invalidate any in-flight capture/message callbacks immediately
    clearReconnectTimer();
    teardownCapture();
    teardownPlayer();
    teardownMic();
    teardownSocket();
    detachLifecycle();
    emit({type: 'state', state: reason});
  }

  // Emergency stop is a hard stop: no new audio leaves the client, nothing
  // plays, and (per policy) only the separate fallback/observation surface
  // (typed input, SpeechRecognition, transcript history already shown)
  // stays available - none of that is this module's concern once stopped.
  function setEmergencyStop(active) {
    emergencyStop = active;
    if (active && started) stop('emergency_stop');
  }

  return {
    start,
    stop,
    setEmergencyStop,
    get state() {
      return {started, explicitlyStopped, emergencyStop, connectionEpoch, reconnectAttempt, queued: playbackQueue.length};
    }
  };
}
