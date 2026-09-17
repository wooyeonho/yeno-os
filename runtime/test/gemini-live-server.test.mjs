import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {start} from '../server.mjs';

// Track B server wiring: voice client -> this WS endpoint -> a Gemini Live
// session -> the owner/config-declared audioLive model (routed exactly like
// any other agent job, never hardcoded) -> streaming -> a model tool ask ->
// the existing read-only AGENT_TOOLS executor -> a real toolResponse back.
// The outbound (this process -> Gemini) socket is injected so this test
// needs no real Gemini credential or network access, while the INBOUND
// (browser -> this process) side is real RFC 6455 wire traffic against the
// real HTTP server, since Node's global `WebSocket` client cannot set the
// Authorization header a device credential needs on the handshake.

const VERIFIED = '2026-09-01T00:00:00.000Z';
const declareModel = (provider, model, overrides = {}) => ({provider, model, taskCapabilities: ['audio-live', 'reasoning', 'tool-calling'], reasoningClass: 'high', codingClass: 'none', realtime: true, vision: false, audioLive: true, toolCalling: true, contextLimit: 128000, costTier: 'medium', quotaClass: 'metered', dailyBudget: {calls: 20, used: 0}, availability: 'available', lastVerifiedAt: VERIFIED, ...overrides});
const LIVE_MODEL = 'gemini-2.0-flash-live-001';
const ENV = {YENO_AGENT_PROVIDER: 'gemini', YENO_GEMINI_API_KEY: 'synthetic-gemini-key', YENO_GEMINI_MODEL: LIVE_MODEL, YENO_AGENT_DAILY_CALL_LIMIT: '6', YENO_BRAIN_POOL: JSON.stringify([declareModel('gemini', LIVE_MODEL)])};

class FakeGeminiSocket extends EventTarget {
  constructor(url) {
    super();
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    FakeGeminiSocket.instances.push(this);
    queueMicrotask(() => {this.readyState = 1; this.dispatchEvent(new Event('open'));});
  }
  send(data) {this.sent.push(JSON.parse(data));}
  close() {if (this.readyState === 3) return; this.readyState = 3; this.dispatchEvent(new Event('close'));}
  emitServer(obj) {this.dispatchEvent(new MessageEvent('message', {data: JSON.stringify(obj)}));}
}

// Minimal RFC 6455 CLIENT for tests only: Node's global `WebSocket` cannot
// set the Authorization header a native/device credential needs on the
// handshake, so this sends real masked frames over a raw socket instead.
async function connectRaw(port, pathAndQuery, headers = {}) {
  const socket = net.connect(port, '127.0.0.1');
  await new Promise(resolve => socket.once('connect', resolve));
  const key = crypto.randomBytes(16).toString('base64');
  const headerLines = Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join('');
  socket.write(`GET ${pathAndQuery} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n${headerLines}\r\n`);
  const head = await new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const onData = chunk => {
      buf = Buffer.concat([buf, chunk]);
      const end = buf.indexOf('\r\n\r\n');
      if (end === -1) return;
      socket.off('data', onData);
      resolve({status: buf.toString('utf8', 0, buf.indexOf('\r\n')), rest: buf.subarray(end + 4)});
    };
    socket.on('data', onData);
    socket.once('error', reject);
  });
  const client = {socket, status: head.status, messages: [], closed: false, _buf: head.rest};
  const consume = () => {
    for (;;) {
      const buf = client._buf;
      if (buf.length < 2) return;
      const opcode = buf[0] & 0x0f;
      let len = buf[1] & 0x7f, offset = 2;
      if (len === 126) {if (buf.length < 4) return; len = buf.readUInt16BE(2); offset = 4;}
      if (buf.length < offset + len) return;
      const payload = buf.subarray(offset, offset + len);
      client._buf = buf.subarray(offset + len);
      if (opcode === 0x8) {client.closed = true; return;}
      if (opcode === 0x1) client.messages.push(payload.toString('utf8'));
      else if (opcode === 0x2) client.messages.push(payload);
    }
  };
  consume();
  socket.on('data', chunk => {client._buf = Buffer.concat([client._buf, chunk]); consume();});
  client.send = (text, {binary = false} = {}) => {
    const payload = Buffer.from(text, binary ? undefined : 'utf8');
    const mask = crypto.randomBytes(4);
    const masked = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i & 3];
    const len = payload.length;
    const header = len < 126 ? Buffer.from([0x80 | (binary ? 0x2 : 0x1), 0x80 | len]) : Buffer.from([0x80 | (binary ? 0x2 : 0x1), 0x80 | 126, len >> 8, len & 0xff]);
    socket.write(Buffer.concat([header, mask, masked]));
  };
  client.waitFor = async (count, timeoutMs = 2000) => {
    const start = Date.now();
    while (client.messages.length < count) {
      if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${count} messages, have ${client.messages.length}`);
      await new Promise(r => setTimeout(r, 10));
    }
    return client.messages;
  };
  return client;
}

async function setup(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-gemini-live-')), token = 'synthetic-owner-token';
  FakeGeminiSocket.instances = [];
  const runtime = await start({host: '127.0.0.1', port: 0, dataDir: dir, token, env: ENV, liveSocketFactory: FakeGeminiSocket, ...options});
  const port = runtime.server.address().port;
  const post = async (route, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${route}`, {method: 'POST', headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}, body: JSON.stringify({requestId: randomUUID(), ...body})});
    return {status: r.status, body: await r.json()};
  };
  const get = async route => {
    const r = await fetch(`http://127.0.0.1:${port}${route}`, {headers: {Authorization: `Bearer ${token}`}});
    return {status: r.status, body: await r.json()};
  };
  const enrolled = (await post('/api/v1/devices/enroll', {name: 'Pixel', platform: 'android'})).body.device;
  const settings = await post('/api/settings', {modules: {ai: true}});
  assert.equal(settings.status, 200, JSON.stringify(settings.body));
  t.after(() => runtime.shutdown());
  return {dir, port, token, deviceToken: enrolled.deviceToken, post, get, disk: () => runtime.state()};
}

test('a valid device credential opens a real live session, routed to the owner-declared audioLive model (never hardcoded); a missing/invalid credential is rejected before any Gemini connection is attempted',async t=>{
  const app = await setup(t);
  const unauthorized = await connectRaw(app.port, '/api/v1/voice/live');
  assert.equal(unauthorized.status, 'HTTP/1.1 401 Unauthorized');
  assert.equal(FakeGeminiSocket.instances.length, 0, 'no outbound Gemini connection for a rejected upgrade');

  const client = await connectRaw(app.port, '/api/v1/voice/live', {Authorization: `Bearer ${app.deviceToken}`});
  assert.equal(client.status, 'HTTP/1.1 101 Switching Protocols');
  await new Promise(r => setTimeout(r, 30));
  assert.equal(FakeGeminiSocket.instances.length, 1);
  assert.equal(FakeGeminiSocket.instances[0].url.startsWith('wss://generativelanguage.googleapis.com/'), true);
  await new Promise(r => setTimeout(r, 30));
  const setupSent = FakeGeminiSocket.instances[0].sent.find(m => m.setup);
  assert.ok(setupSent, 'a real setup message was sent');
  assert.equal(setupSent.setup.model, `models/${LIVE_MODEL}`, 'the owner/config-declared model, never a hardcoded one');
  client.socket.destroy();
});

test('a model tool call is never authority: it is routed through settleToolCall + the existing read-only AGENT_TOOLS executor, and a real toolResponse is sent back; emergency stop rechecked immediately before executing',async t=>{
  const app = await setup(t);
  const client = await connectRaw(app.port, '/api/v1/voice/live', {Authorization: `Bearer ${app.deviceToken}`});
  await new Promise(r => setTimeout(r, 30));
  const gemini = FakeGeminiSocket.instances[0];
  gemini.emitServer({setupComplete: {}});
  gemini.emitServer({toolCall: {functionCalls: [{id: 'call-1', name: 'runtime_inspect', args: {}}]}});
  await new Promise(r => setTimeout(r, 50));
  const response = gemini.sent.find(m => m.toolResponse);
  assert.ok(response, 'a real toolResponse was sent back to Gemini');
  const fr = response.toolResponse.functionResponses[0];
  assert.equal(fr.id, 'call-1');
  assert.equal(fr.response.status, 'executed');
  assert.equal(typeof fr.response.result.jobCounts, 'object', 'the real agentTool()/runtime_inspect result, not a stub');

  // The exact same call id can never execute twice, even if Gemini resends it.
  gemini.sent.length = 0;
  gemini.emitServer({toolCall: {functionCalls: [{id: 'call-1', name: 'runtime_inspect', args: {}}]}});
  await new Promise(r => setTimeout(r, 50));
  assert.equal(gemini.sent.find(m => m.toolResponse), undefined, 'a duplicate tool call id produces no second response');
  client.socket.destroy();
});

test('emergency stop blocks a NEW session before any outbound Gemini connection is attempted',async t=>{
  const app = await setup(t);
  assert.equal((await app.post('/api/control', {action: 'stop'})).status, 200);
  const client = await connectRaw(app.port, '/api/v1/voice/live', {Authorization: `Bearer ${app.deviceToken}`});
  assert.equal(client.status, 'HTTP/1.1 101 Switching Protocols'); // the WS upgrade itself still succeeds (auth only)...
  await client.waitFor(1);
  const blocked = JSON.parse(client.messages[0]);
  assert.equal(blocked.type, 'blocked');
  assert.equal(blocked.reason, 'emergency_stop');
  assert.equal(FakeGeminiSocket.instances.length, 0, '...but no session/outbound connection is ever opened');
  client.socket.destroy();
});

test('a tool call still genuinely in flight when a barge-in interruption lands is aborted via its AbortSignal and answered as cancelled, never as a stale "executed"',async t=>{
  // A fast, synchronous tool (runtime_inspect) always finishes before a
  // second, separate WS message could ever be queued behind it - this uses
  // source_read_release instead, whose real execution awaits an injected
  // fetch this test controls, so the interruption message can genuinely
  // arrive while the tool call is still pending.
  let releaseFetch;
  const pendingFetch = new Promise(resolve => {releaseFetch = resolve;});
  const REPO = 'openai/codex', TAG = 'v1.0.0', URL_ = `https://github.com/${REPO}/releases/tag/${TAG}`;
  const app = await setup(t, {agentFetch: async () => {await pendingFetch; return new Response(JSON.stringify({html_url: URL_, draft: false, prerelease: false, body: 'release notes'}), {status: 200, headers: {'Content-Type': 'application/json'}});}});
  const source = (await app.post('/api/sources', {title: 'codex release', url: URL_})).body.source;
  const client = await connectRaw(app.port, '/api/v1/voice/live', {Authorization: `Bearer ${app.deviceToken}`});
  await new Promise(r => setTimeout(r, 30));
  const gemini = FakeGeminiSocket.instances[0];
  gemini.emitServer({setupComplete: {}});
  gemini.emitServer({toolCall: {functionCalls: [{id: 'call-2', name: 'source_read_release', args: {sourceId: source.id}}]}});
  await new Promise(r => setTimeout(r, 30)); // let settleToolCall/authorization + the fetch call actually start
  // The call is now authorized and awaiting the injected fetch - genuinely
  // in flight. Interrupt now.
  gemini.emitServer({serverContent: {interrupted: true}});
  await new Promise(r => setTimeout(r, 30));
  releaseFetch(); // let the (now-aborted) fetch settle, if it hasn't already rejected
  await new Promise(r => setTimeout(r, 50));
  const responses = gemini.sent.filter(m => m.toolResponse);
  assert.equal(responses.length, 1, 'exactly one toolResponse for this call, never zero and never a duplicate');
  assert.notEqual(responses[0].toolResponse.functionResponses[0].response.status, 'executed', JSON.stringify(responses[0]));
  client.socket.destroy();
});

test('readiness reflects a real opened session (SYNTHETIC_VERIFIED for the injected test transport, never NOT_WIRED once one has opened; never LIVE_VERIFIED for an injected transport)',async t=>{
  const app = await setup(t);
  const before = await app.get('/api/readiness');
  assert.equal(before.body.voice.liveVoice, 'NOT_WIRED');
  const client = await connectRaw(app.port, '/api/v1/voice/live', {Authorization: `Bearer ${app.deviceToken}`});
  await new Promise(r => setTimeout(r, 30));
  FakeGeminiSocket.instances[0].emitServer({setupComplete: {}});
  await new Promise(r => setTimeout(r, 30));
  const after = await app.get('/api/readiness');
  assert.equal(after.body.voice.liveVoice, 'SYNTHETIC_VERIFIED');
  client.socket.destroy();
});
