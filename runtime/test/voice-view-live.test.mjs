import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createVoiceView} from '../public/voice-view.mjs';
const {JSDOM} = createRequire(new URL('../../apps/controller/package.json', import.meta.url))('jsdom');

// LANE A: voice-view.mjs's wiring of the real live-voice-client.mjs into the
// existing UI. The client module itself (mic capture, downsampling, bounded
// queues, barge-in, reconnect, emergency stop, tool-execution refusal) is
// already exhaustively covered in live-voice-client.test.mjs with injected
// fakes; this file only checks the GLUE - button visibility/state, click
// wiring, and that emergencyStop/update()/destroy() actually reach the
// live client - using a fake getUserMedia/WebSocket on the jsdom window so
// `liveSupported` is true, without ever touching real audio hardware.

class FakeMediaStreamTrack {
  constructor() {this.stopped = false;}
  stop() {this.stopped = true;}
}
class FakeMediaStream {
  constructor() {this.track = new FakeMediaStreamTrack();}
  getTracks() {return [this.track];}
}
class FakeWebSocket extends EventTarget {
  constructor(url) {super(); this.url = url; this.readyState = 0; this.sent = []; FakeWebSocket.instances.push(this);}
  send(data) {this.sent.push(data);}
  close() {if (this.readyState === 3) return; this.readyState = 3; this.dispatchEvent(new Event('close'));}
}
FakeWebSocket.instances = [];

// jsdom does not implement the Web Audio API at all - a minimal fake stands
// in for it here so these GLUE tests (button wiring, emergency stop,
// transcript rendering) don't need real audio hardware. Real capture/
// playback logic itself is exercised with injected deps directly in
// live-voice-client.test.mjs.
class FakeAudioContext {
  constructor() {this.currentTime = 0; this.destination = {};}
  createMediaStreamSource() {return {connect() {}, disconnect() {}};}
  createScriptProcessor() {return {onaudioprocess: null, connect() {}, disconnect() {}};}
  createGain() {return {gain: {value: 0}, connect() {}, disconnect() {}};}
  createBuffer(channels, length, rate) {return {getChannelData: () => new Float32Array(length), duration: length / rate};}
  createBufferSource() {return {buffer: null, connect() {}, start() {}, stop() {}, onended: null};}
  close() {}
}

function setup({micGranted = true} = {}) {
  const dom = new JSDOM('<main></main>', {pretendToBeVisual: true, url: 'https://example.test'});
  const win = dom.window, root = win.document.querySelector('main');
  FakeWebSocket.instances = [];
  const getUserMediaCalls = [];
  win.WebSocket = FakeWebSocket;
  win.AudioContext = FakeAudioContext;
  win.navigator.mediaDevices = {getUserMedia: async constraints => {
    getUserMediaCalls.push(constraints);
    if (!micGranted) throw new Error('denied');
    return new FakeMediaStream();
  }};
  const view = createVoiceView(root, {onSend: async () => ({jobId: 'job-1'}), onReadResult: async () => '실제 답변'});
  view.update({online: true, jobs: []});
  const query = selector => root.querySelector(selector);
  const click = action => query(`[data-voice-action="${action}"]`).click();
  return {dom, win, root, view, query, click, getUserMediaCalls, close() {view.destroy(); dom.window.close();}};
}

test('the live section is visible when WebSocket + getUserMedia are available, and clicking it requests the microphone only then (never before)', async () => {
  const h = setup();
  assert.equal(h.query('[data-voice-live]').hidden, false);
  assert.equal(h.getUserMediaCalls.length, 0);
  h.click('live-toggle');
  await new Promise(r => setTimeout(r, 10));
  assert.equal(h.getUserMediaCalls.length, 1);
  assert.equal(h.getUserMediaCalls[0].audio.channelCount, 1);
  await new Promise(r => setTimeout(r, 10));
  assert.equal(FakeWebSocket.instances.length, 1, 'a live WS connection opens once the mic is granted');
  h.close();
});

test('the live section stays hidden and inert when the browser lacks WebSocket/getUserMedia - the existing SpeechRecognition/typed fallback is completely unaffected', () => {
  const dom = new JSDOM('<main></main>', {pretendToBeVisual: true, url: 'https://example.test'});
  const win = dom.window, root = win.document.querySelector('main');
  // No win.WebSocket, no win.navigator.mediaDevices assigned - the default jsdom navigator.
  const view = createVoiceView(root, {onSend: async () => ({jobId: 'j'}), onReadResult: async () => 'ok'});
  view.update({online: true, jobs: []});
  assert.equal(root.querySelector('[data-voice-live]').hidden, true);
  // The ordinary controls are still present and enabled as before.
  assert.ok(root.querySelector('[data-voice-action="send"]'));
  view.destroy(); dom.window.close();
});

test('a denied microphone permission surfaces a clear message and never opens a connection', async () => {
  const h = setup({micGranted: false});
  h.click('live-toggle');
  await new Promise(r => setTimeout(r, 10));
  assert.equal(FakeWebSocket.instances.length, 0);
  assert.match(h.query('[data-voice-live-status]').textContent, /마이크 권한/);
  h.close();
});

test('emergency stop reaching update() hard-stops an active live call (mic released, socket closed)', async () => {
  const h = setup();
  h.click('live-toggle');
  await new Promise(r => setTimeout(r, 10));
  const socket = FakeWebSocket.instances[0];
  socket.readyState = 1; socket.dispatchEvent(new Event('open'));
  h.view.update({online: true, jobs: [], emergencyStop: true});
  assert.equal(socket.readyState, 3);
  assert.match(h.query('[data-voice-live-status]').textContent, /전체 멈춤/);
  h.close();
});

test('destroy() releases the live call (mic tracks stopped, socket closed) even if a call is active - no lingering microphone after the view is torn down', async () => {
  const h = setup();
  h.click('live-toggle');
  await new Promise(r => setTimeout(r, 10));
  const socket = FakeWebSocket.instances[0];
  socket.readyState = 1; socket.dispatchEvent(new Event('open'));
  h.view.destroy();
  assert.equal(socket.readyState, 3);
  h.dom.window.close();
});

test('a live transcript event from the client is rendered as text, HTML-escaped, and bounded in count - it never grows the DOM without limit', async () => {
  const h = setup();
  h.click('live-toggle');
  await new Promise(r => setTimeout(r, 10));
  const socket = FakeWebSocket.instances[0];
  socket.readyState = 1; socket.dispatchEvent(new Event('open'));
  const emit = (role, text) => socket.dispatchEvent(new MessageEvent('message', {data: JSON.stringify({type: 'transcript', role, text})}));
  emit('user', '<script>alert(1)</script>');
  assert.ok(h.query('[data-voice-live-transcript]').innerHTML.includes('&lt;script&gt;'));
  for (let i = 0; i < 30; i++) emit('assistant', `turn ${i}`);
  assert.equal(h.query('[data-voice-live-transcript]').querySelectorAll('p').length, 20);
  h.close();
});
