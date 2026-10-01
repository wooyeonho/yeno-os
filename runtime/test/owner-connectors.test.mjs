import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import * as ownerPanel from '../owner-remote-provider.mjs';

const row = { id: 'quantum-circuit', kind: 'quantum', title: 'Quantum circuit', mode: 'local',
  upstream: { name: 'quantum-circuit', license: 'MIT', pinnedVersion: 'fixture' },
  auth: { shape: 'toggle', fields: [] }, requires: [], implemented: true,
  status: 'installed', reason: 'ready_for_check', canCheck: true, lastCheck: null, authorizesDispatch: false };

async function fixture(t, respond = request => request.method === 'GET' ? { connectors: [row] } : { connector: row }) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-owner-connectors-'));
  const token = crypto.randomBytes(24).toString('base64url');
  const requests = [];
  const server = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({ method: request.method, url: request.url, headers: request.headers, body });
    response.setHeader('content-type', 'application/json');
    if (request.headers.authorization !== `Bearer ${token}`) response.statusCode = 401;
    response.end(JSON.stringify(respond(request)));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const config = { version: 1, dataDir: path.join(home, 'data'), controlDir: path.join(home, 'control'),
    tokenFile: path.join(home, 'token'), port: server.address().port, phone: null };
  fs.writeFileSync(config.tokenFile, token);
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify(config));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(home, { recursive: true, force: true }); });
  return { home, token, requests };
}

test('owner connector list uses one private bearer GET without credential or settings writes', async t => {
  // Given an existing resident configuration and an owner-only loopback endpoint.
  const f = await fixture(t);
  const original = fs.readFileSync(path.join(f.home, 'config.json'), 'utf8');
  // When the owner requests the list.
  const result = await ownerPanel.ownerRemoteConnectors(f.home, { action: 'list' });
  // Then it reads one route and leaves the resident configuration intact.
  assert.deepEqual(result, { connectors: [row] });
  assert.deepEqual(f.requests.map(request => [request.method, request.url, request.body]), [['GET', '/api/connectors', '']]);
  assert.equal(JSON.stringify(result).includes(f.token), false);
  assert.equal(fs.readFileSync(path.join(f.home, 'config.json'), 'utf8'), original);
  assert.deepEqual(fs.readdirSync(f.home).sort(), ['config.json', 'token']);
});

test('owner connector check makes exactly one owner request with a fresh requestId', async t => {
  // Given a configured private core.
  const f = await fixture(t);
  // When the owner selects one explicit connector check.
  const result = await ownerPanel.ownerRemoteConnectors(f.home, { action: 'check', id: 'quantum-circuit' });
  // Then the bridge requests one check, without enabling any module.
  assert.deepEqual(result, { connector: row });
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].method, 'POST');
  assert.equal(f.requests[0].url, '/api/connectors/quantum-circuit/check');
  assert.match(JSON.parse(f.requests[0].body).requestId, /^[a-f0-9-]{36}$/);
});

test('owner connector commands reject extra fields and route injection before network access', async () => {
  // Given malformed requests, including a path that would escape the check route.
  const invalid = [{ action: 'check', id: '../settings' }, { action: 'list', id: 'ollama' }, { action: 'check', id: 'ollama', apiKey: 'private-value' }];
  let calls = 0;
  // When those requests cross the private bridge boundary.
  for (const input of invalid) await assert.rejects(ownerPanel.ownerRemoteConnectors(path.resolve('missing-owner-fixture'), input,
    async () => { calls++; throw new Error('should not call'); }), /OWNER_CONNECTOR_INPUT_INVALID/);
  // Then none can reach the core.
  assert.equal(calls, 0);
});

test('owner connector failures discard downstream messages without repeating the check', async t => {
  // Given a core that rejects the selected check with a body that must stay private.
  const f = await fixture(t);
  let calls = 0;
  // When the owner check fails.
  await assert.rejects(ownerPanel.ownerRemoteConnectors(f.home, { action: 'check', id: 'ollama' }, async () => {
    calls++; return Response.json({ error: 'private-downstream-message' }, { status: 403 });
  }), { message: 'OWNER_CONNECTOR_UNAVAILABLE' });
  // Then no retry or raw error propagation occurs.
  assert.equal(calls, 1);
});

test('owner connector response rejects credential fields before entering the GUI pipe', async t => {
  // Given an invalid response containing an accidental credential field.
  const f = await fixture(t, () => ({ connectors: [{ ...row, apiKey: 'private-value' }] }));
  // When the list is read.
  const result = await ownerPanel.ownerRemoteConnectors(f.home, { action: 'list' }).then(() => null, error => error);
  // Then the GUI receives a fixed safe error, not the original response.
  assert.equal(result?.message, 'OWNER_CONNECTOR_RESPONSE_INVALID');
  assert.equal(String(result).includes('private-value'), false);
});

test('owner connector response preserves the bounded generation metric without treating it as a credential', async t => {
  // Given the real Ollama receipt shape, whose token count is a numeric safety bound.
  const checked = { ...row, id: 'ollama', lastCheck: { ok: true, evidenceClass: 'live',
    evidence: { class: 'live', operation: 'bounded_chat_completion', backend: 'local_openai_compatible', maxOutputTokens: 8 } } };
  const f = await fixture(t, () => ({ connector: checked }));
  // When the owner reads the successful check response.
  const result = await ownerPanel.ownerRemoteConnectors(f.home, { action: 'check', id: 'ollama' });
  // Then the metric remains visible and unchanged.
  assert.deepEqual(result, { connector: checked });
});

test('owner connector metric allowance rejects a credential disguised as a token count', async t => {
  // Given a malformed receipt using a safety metric field for text.
  const checked = { ...row, lastCheck: { evidence: { maxOutputTokens: 'private-value' } } };
  const f = await fixture(t, () => ({ connector: checked }));
  // When the owner reads it.
  const result = await ownerPanel.ownerRemoteConnectors(f.home, { action: 'check', id: 'quantum-circuit' }).then(() => null, error => error);
  // Then the numeric allowance does not bypass the credential boundary.
  assert.equal(result?.message, 'OWNER_CONNECTOR_RESPONSE_INVALID');
});

test('existing private GUI pipe dispatches list and selected check without exposing its owner bearer', async t => {
  // Given the existing owner-pairing child process and a fixture core.
  const f = await fixture(t);
  const bridge = spawn(process.execPath, [fileURLToPath(new URL('../owner-pairing.mjs', import.meta.url)), '--gui-pipe'],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  t.after(() => bridge.kill());
  let output = '', errors = '';
  bridge.stdout.on('data', chunk => { output += chunk; });
  bridge.stderr.on('data', chunk => { errors += chunk; });
  const exited = once(bridge, 'close');
  // When the same GUI pipe sends list, then one explicit check.
  bridge.stdin.end([{ home: f.home, action: 'connectors' }, { home: f.home, action: 'check-connector', id: 'quantum-circuit' }]
    .map(request => JSON.stringify(request)).join('\n') + '\n');
  const [code] = await exited;
  // Then both replies reflect the core and the private bearer never leaves the child.
  assert.equal(code, 0);
  assert.deepEqual(output.trim().split('\n').map(line => JSON.parse(line)), [{ ok: true, connectors: [row] }, { ok: true, connector: row }]);
  assert.equal((output + errors).includes(f.token), false);
  assert.equal(f.requests.length, 2);
});
