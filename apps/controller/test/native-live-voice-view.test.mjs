import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createNativeLiveVoiceView } from '../src/native-live-voice-view.ts';

// Native controller wiring for issue #21: this view owns the #live-voice
// section (pairing-gated, explicit-gesture start/stop) and the per-connection
// lifecycle of the reused runtime/public/live-voice-client.mjs state
// machine, via an injected `createClient` fake so no real Tauri runtime or
// microphone/socket is ever needed. The reconnect/barge-in/emergency-stop/
// bounded-queue state machine itself is already exhaustively covered
// elsewhere (runtime/test/live-voice-client.test.mjs); this file only checks
// the GLUE this native controller adds on top of it - visibility gating on
// pairing, the explicit-gesture toggle, lifecycle hooks (offline/logout/
// emergency-stop/destroy), and that a model can never reach a tool through
// this surface (it only ever renders text).

const connection = { origin: 'https://core.example', deviceId: 'device-a', token: 'synthetic-device-token' };

function fakeClient() {
  const instances = [];
  const createClient = deps => {
    const instance = { deps, started: false, stopped: [], emergencyStop: false, emit: null };
    instance.client = {
      async start() { instance.started = true; },
      stop(reason) { instance.stopped.push(reason); instance.started = false; },
      setEmergencyStop(active) { instance.emergencyStop = active; },
    };
    instance.emit = event => deps.onEvent?.(event);
    instances.push(instance);
    return instance.client;
  };
  return { createClient, instances };
}

function setup({ supported = true } = {}) {
  const dom = new JSDOM('<div id="live-voice" hidden><button type="button" data-live-toggle></button><p data-live-status></p><div data-live-transcript></div></div>', { url: 'https://example.test' });
  const root = dom.window.document.getElementById('live-voice');
  const { createClient, instances } = fakeClient();
  const view = createNativeLiveVoiceView(root, { doc: dom.window.document, win: dom.window, createClient, supported });
  const toggle = () => root.querySelector('[data-live-toggle]');
  const click = () => toggle().dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  return { dom, root, view, instances, toggle, click, close: () => dom.window.close() };
}

test('the section stays hidden with no connection, and appears (with a distinct client per connection) once one is set', () => {
  const h = setup();
  assert.equal(h.root.hidden, true);
  h.view.setConnection(connection);
  h.view.update({ online: true, emergencyStop: false, busy: false });
  assert.equal(h.root.hidden, false);
  assert.equal(h.instances.length, 1);
  // The connection target is the fixed live endpoint on the paired origin, never an arbitrary URL.
  assert.equal(h.instances[0].deps.url, 'wss://core.example/api/v1/voice/live');
  h.close();
});

test('unsupported (no getUserMedia) keeps the section hidden and inert even when paired - the typed-command UI is completely unaffected', () => {
  const h = setup({ supported: false });
  h.view.setConnection(connection);
  h.view.update({ online: true, emergencyStop: false, busy: false });
  assert.equal(h.root.hidden, true);
  assert.equal(h.instances.length, 0, 'no client is ever constructed when unsupported');
  h.close();
});

test('start is explicit-user-gesture only: setConnection/update alone never call start()', () => {
  const h = setup();
  h.view.setConnection(connection);
  h.view.update({ online: true, emergencyStop: false, busy: false });
  assert.equal(h.instances[0].started, false);
  h.click();
  assert.equal(h.instances[0].started, true);
  h.close();
});

test('the toggle button is disabled while offline/emergency-stopped/busy, and clicking it then does nothing', () => {
  const h = setup();
  h.view.setConnection(connection);
  h.view.update({ online: false, emergencyStop: false, busy: false });
  assert.equal(h.toggle().disabled, true);
  h.click();
  assert.equal(h.instances[0].started, false);
  h.close();
});

test('emergency stop reaches the client (setEmergencyStop) on every update(), matching the existing global stop control', () => {
  const h = setup();
  h.view.setConnection(connection);
  h.view.update({ online: true, emergencyStop: false, busy: false });
  h.view.update({ online: true, emergencyStop: true, busy: false });
  assert.equal(h.instances[0].emergencyStop, true);
  h.close();
});

test('going offline stops the live call (mic/socket released) without tearing down the whole view', () => {
  const h = setup();
  h.view.setConnection(connection);
  h.view.update({ online: true, emergencyStop: false, busy: false });
  h.click();
  h.view.update({ online: false, emergencyStop: false, busy: false });
  assert.ok(h.instances[0].stopped.includes('offline'));
  h.close();
});

test('logout/disconnect (setConnection(null)) stops the active call and hides the section again', () => {
  const h = setup();
  h.view.setConnection(connection);
  h.view.update({ online: true, emergencyStop: false, busy: false });
  h.click();
  h.view.setConnection(null);
  assert.ok(h.instances[0].stopped.includes('logout'));
  assert.equal(h.root.hidden, true);
  h.close();
});

test('re-pairing (setConnection called again with a different connection) stops the old client - no crossover between two paired devices', () => {
  const h = setup();
  h.view.setConnection(connection);
  h.view.update({ online: true, emergencyStop: false, busy: false });
  const second = { origin: 'https://core.example', deviceId: 'device-b', token: 'second-token' };
  h.view.setConnection(second);
  assert.ok(h.instances[0].stopped.includes('logout'));
  assert.equal(h.instances.length, 2);
  assert.notEqual(h.instances[0].deps.connect, h.instances[1].deps.connect);
  h.close();
});

test('a stale client event after re-pairing/disconnect is ignored - it can never render into the new session', () => {
  const h = setup();
  h.view.setConnection(connection);
  h.view.update({ online: true, emergencyStop: false, busy: false });
  const stale = h.instances[0];
  h.view.setConnection(null);
  stale.emit({ type: 'transcript', role: 'assistant', text: 'late reply for a session that is gone' });
  assert.equal(h.root.querySelector('[data-live-transcript]').innerHTML, '');
  h.close();
});

test('destroy() stops the active call and detaches the click listener', () => {
  const h = setup();
  h.view.setConnection(connection);
  h.view.update({ online: true, emergencyStop: false, busy: false });
  h.click();
  assert.equal(h.instances[0].started, true);
  h.view.destroy();
  assert.ok(h.instances[0].stopped.includes('destroyed'));
  assert.equal(h.instances[0].started, false);
  h.click(); // must be a no-op post-destroy (listener detached)
  assert.equal(h.instances[0].started, false, 'a stray click after destroy() must never resurrect the stopped call');
  h.close();
});

test('a transcript event is rendered as escaped text - this view has no code path that executes a tool call or arbitrary HTML from the server', () => {
  const h = setup();
  h.view.setConnection(connection);
  h.view.update({ online: true, emergencyStop: false, busy: false });
  h.instances[0].emit({ type: 'transcript', role: 'user', text: '<img src=x onerror=alert(1)>' });
  const html = h.root.querySelector('[data-live-transcript]').innerHTML;
  assert.ok(html.includes('&lt;img'));
  assert.ok(!html.includes('<img'));
  h.close();
});

test('a microphone permission error surfaces a clear status message', () => {
  const h = setup();
  h.view.setConnection(connection);
  h.view.update({ online: true, emergencyStop: false, busy: false });
  h.instances[0].emit({ type: 'error', message: 'microphone_permission_denied' });
  assert.match(h.root.querySelector('[data-live-status]').textContent, /마이크 권한/);
  h.close();
});
