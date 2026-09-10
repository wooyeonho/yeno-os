import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decryptBackup, restoreBackup } from '../lib/backup.mjs';
import { fingerprintRequest, initializeRequestLedger, REQUEST_LEDGER_MAX_ENTRIES } from '../lib/request-ledger.mjs';

const runtimeRoot = fileURLToPath(new URL('../', import.meta.url));
const OWNER = 'request-ledger-owner-test-only-20260910';
const NATIVE_ORIGIN = 'http://tauri.localhost';
const hash = value => createHash('sha256').update(value).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'yeno-ledger-api-'));
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  const base = `http://127.0.0.1:${port}`;
  let child, logs = '', activeDir = path.join(root, 'original');
  async function stop() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const current = child;
    const closed = new Promise(resolve => current.once('exit', resolve));
    current.kill('SIGTERM');
    const timer = setTimeout(() => current.kill('SIGKILL'), 1500);
    await closed; clearTimeout(timer);
  }
  async function start({ dataDir = activeDir, owner = OWNER } = {}) {
    assert.ok(!child || child.exitCode !== null || child.signalCode !== null, 'stop the previous process before starting');
    activeDir = dataDir; logs = '';
    child = spawn(process.execPath, ['server.mjs'], {
      cwd: runtimeRoot,
      env: { ...process.env, YENO_AI_BASE_URL: '', YENO_AI_MODEL: '', YENO_AI_API_KEY: '', YENO_PORT: String(port), YENO_HOST: '127.0.0.1', YENO_DATA_DIR: dataDir, YENO_TOKEN: owner },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', chunk => { logs += chunk; });
    child.stderr.on('data', chunk => { logs += chunk; });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) assert.fail(`Runtime exited: ${logs}`);
      try { if ((await fetch(`${base}/api/health`)).ok) return; } catch { /* Waiting for the new process socket. */ }
      await sleep(30);
    }
    assert.fail(`Runtime did not start: ${logs}`);
  }
  async function api(route, { method = 'GET', body, token = OWNER, native = route.startsWith('/api/v1/') } = {}) {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(native ? { origin: NATIVE_ORIGIN } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    let result = bytes.toString('utf8');
    if (response.headers.get('content-type')?.includes('application/json')) result = JSON.parse(result);
    return { status: response.status, body: result, bytes, headers: response.headers };
  }
  async function enroll(owner = OWNER) {
    const response = await api('/api/v1/devices/enroll', { method: 'POST', token: owner, body: { name: 'Ledger integration Android', platform: 'android', requestId: randomUUID() } });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    return response.body.device;
  }
  async function state(token) {
    const response = await api('/api/v1/state', { token });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    return response.body;
  }
  async function document(token, text = '문서 만들어: preserve ledger identity and artifact') {
    const body = { text, requestId: randomUUID() };
    const response = await api('/api/v1/commands', { method: 'POST', token, body });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    for (let attempt = 0; attempt < 120; attempt++) {
      const job = (await state(token)).jobs.find(job => job.id === response.body.job.id);
      if (job.status === 'completed') return { body, job };
      assert.notEqual(job.status, 'failed'); await sleep(30);
    }
    assert.fail('Document did not complete');
  }
  async function diskState() {
    const envelope = JSON.parse(await readFile(path.join(activeDir, 'state.json'), 'utf8'));
    assert.equal(hash(envelope.payload), envelope.sha256);
    return JSON.parse(envelope.payload);
  }
  async function changeStoppedState(change) {
    assert.ok(child.exitCode !== null || child.signalCode !== null, 'fixtures must never edit a running store');
    const state = await diskState(); change(state); initializeRequestLedger(state);
    const payload = JSON.stringify(state);
    await writeFile(path.join(activeDir, 'state.json'), JSON.stringify({ format: 1, sha256: hash(payload), payload }), { mode: 0o600 });
  }
  t.after(async () => { await stop(); await rm(root, { recursive: true, force: true }); });
  await start();
  return { root, api, enroll, state, document, stop, start, diskState, changeStoppedState };
}

test('native writes require requestId before mutation while legacy idless commands remain compatible', async t => {
  const f = await fixture(t);
  const missingEnrollment = await f.api('/api/v1/devices/enroll', { method: 'POST', body: { name: 'No identity', platform: 'android' } });
  assert.equal(missingEnrollment.status, 400, JSON.stringify(missingEnrollment.body));
  const device = await f.enroll();
  const token = device.deviceToken, before = await f.state(token);
  for (const [route, body] of [
    ['/api/v1/commands', { text: '문서 만들어: must not be created' }],
    ['/api/v1/jobs', { type: 'document', text: 'must not be created' }],
    [`/api/v1/jobs/${randomUUID()}/action`, { action: 'cancel' }],
    ['/api/v1/control', { action: 'stop' }],
    ['/api/v1/devices/revoke', {}],
  ]) {
    const response = await f.api(route, { method: 'POST', token, body });
    assert.equal(response.status, 400, `${route}: ${JSON.stringify(response.body)}`);
  }
  for (const requestId of ['', '   ', 123, 'x'.repeat(161)]) {
    assert.equal((await f.api('/api/v1/commands', { method: 'POST', token, body: { text: '문서 만들어: invalid identity', requestId } })).status, 400);
  }
  const after = await f.state(token);
  assert.deepEqual(after.jobs, before.jobs);
  assert.equal(after.emergencyStop, before.emergencyStop);
  const legacy = await f.api('/api/commands', { method: 'POST', body: { text: '문서 만들어: legacy idless compatibility' } });
  assert.equal(legacy.status, 201, JSON.stringify(legacy.body));
  assert.equal((await f.state(token)).jobs.length, before.jobs.length + 1);
});

test('self-revocation request identity cannot replay another authenticated device receipt', async t => {
  const f = await fixture(t), first = await f.enroll(), second = await f.enroll();
  const sharedBody = { requestId: randomUUID() };
  const firstRevocation = await f.api('/api/v1/devices/revoke', { method: 'POST', token: first.deviceToken, body: sharedBody });
  assert.equal(firstRevocation.status, 200, JSON.stringify(firstRevocation.body));
  assert.equal(firstRevocation.body.deviceId, first.id);
  const collision = await f.api('/api/v1/devices/revoke', { method: 'POST', token: second.deviceToken, body: sharedBody });
  assert.equal(collision.status, 409, JSON.stringify(collision.body));
  assert.equal((await f.api('/api/v1/state', { token: second.deviceToken })).status, 200, 'a rejected collision must not revoke the second device');
  const secondRevocation = await f.api('/api/v1/devices/revoke', { method: 'POST', token: second.deviceToken, body: { requestId: randomUUID() } });
  assert.equal(secondRevocation.status, 200, JSON.stringify(secondRevocation.body));
  assert.equal(secondRevocation.body.deviceId, second.id);
  for (const device of [first, second]) {
    assert.equal((await f.api('/api/v1/state', { token: device.deviceToken })).status, 401);
  }
});

test('an evicted command receipt remains retryable across a real restart without a second job or artifact', async t => {
  const f = await fixture(t), device = await f.enroll(), token = device.deviceToken;
  const original = await f.document(token);
  const artifactId = original.job.artifacts[0].id;
  const artifact = await f.api(`/api/v1/artifacts/${artifactId}`, { token });
  assert.equal(artifact.status, 200); assert.equal(hash(artifact.bytes), artifact.headers.get('x-content-sha256'));
  await f.stop();
  await f.changeStoppedState(state => {
    assert.ok(Object.hasOwn(state.requestLedger, original.body.requestId));
    delete state.requests[original.body.requestId];
  });
  await f.start();
  for (const missingToken of [null, 'invalid-token', OWNER]) {
    assert.equal((await f.api(`/api/v1/requests/${original.body.requestId}`, { token: missingToken })).status, 401);
  }
  const lookup = await f.api(`/api/v1/requests/${original.body.requestId}`, { token });
  assert.equal(lookup.status, 200, JSON.stringify(lookup.body));
  assert.deepEqual(lookup.body, { request: { requestId: original.body.requestId, status: 201, cached: false, reference: { collection: 'jobs', id: original.job.id, payloadKey: 'job', kind: 'job' } } });
  assert.equal((await f.api(`/api/v1/requests/${randomUUID()}`, { token })).status, 404);
  const retry = await f.api('/api/v1/commands', { method: 'POST', token, body: original.body });
  assert.equal(retry.status, 201, JSON.stringify(retry.body));
  assert.equal(retry.body.job.id, original.job.id);
  assert.deepEqual(retry.body.job.artifacts, original.job.artifacts);
  for (const hidden of ['input', 'normalized', 'draft']) assert.equal(Object.hasOwn(retry.body.job, hidden), false);
  const conflict = await f.api('/api/v1/commands', { method: 'POST', token, body: { ...original.body, text: '문서 만들어: different command with reused identity' } });
  assert.equal(conflict.status, 409);
  assert.equal((await f.state(token)).jobs.length, 1);
  const repeatedArtifact = await f.api(`/api/v1/artifacts/${artifactId}`, { token });
  assert.deepEqual(repeatedArtifact.bytes, artifact.bytes);
  await f.stop();
  assert.equal(Object.keys((await f.diskState()).artifacts).length, 1);
});

test('full durable ledger blocks new work but preserves retries and owner stop and revocation', async t => {
  const f = await fixture(t), device = await f.enroll(), token = device.deviceToken;
  const original = await f.document(token);
  await f.stop();
  await f.changeStoppedState(state => {
    // Seed capacity on the stopped, checksummed store instead of executing
    // 20,000 mutations. Every identity passes the real module's validator.
    const ledger = state.requestLedger;
    const fingerprint = fingerprintRequest('POST', '/api/control', { action: 'resume' });
    for (let i = Object.keys(ledger).length; i < REQUEST_LEDGER_MAX_ENTRIES; i++) ledger[randomUUID()] = { hash: fingerprint, status: 200 };
  });
  await f.start();
  const before = await f.state(token);
  const blockedId = randomUUID();
  const blocked = await f.api('/api/v1/commands', { method: 'POST', token, body: { text: '문서 만들어: ledger full must not create', requestId: blockedId } });
  assert.equal(blocked.status, 507, JSON.stringify(blocked.body));
  assert.equal(blocked.body.code, 'REQUEST_LEDGER_CAPACITY');
  assert.deepEqual((await f.state(token)).jobs, before.jobs);
  assert.equal((await f.api(`/api/v1/requests/${blockedId}`, { token })).status, 404);
  const retry = await f.api('/api/v1/commands', { method: 'POST', token, body: original.body });
  assert.equal(retry.status, 201); assert.equal(retry.body.job.id, original.job.id);
  const stopId = randomUUID();
  const stopped = await f.api('/api/v1/control', { method: 'POST', token, body: { action: 'stop', requestId: stopId } });
  assert.equal(stopped.status, 200, JSON.stringify(stopped.body));
  assert.equal(stopped.body.receiptPersisted, false);
  assert.equal((await f.state(token)).emergencyStop, true);
  assert.equal((await f.api('/api/v1/control', { method: 'POST', token, body: { action: 'resume', requestId: randomUUID() } })).status, 507);
  const revoked = await f.api(`/api/devices/${device.id}/revoke`, { method: 'POST', body: { requestId: randomUUID() } });
  assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
  assert.equal(revoked.body.receiptPersisted, false);
  assert.equal((await f.api('/api/v1/state', { token })).status, 401);
  await f.stop();
  const persisted = await f.diskState();
  assert.equal(persisted.emergencyStop, true);
  assert.equal(persisted.jobs.length, 1);
  assert.equal(Object.keys(persisted.requestLedger).length, REQUEST_LEDGER_MAX_ENTRIES);
  assert.equal(Object.hasOwn(persisted.requestLedger, stopId), false);
  assert.ok(persisted.devices[device.id].revokedAt);
});

test('encrypted HTTP export and clean restore retain evicted command identity under fresh authentication', async t => {
  const f = await fixture(t), device = await f.enroll(), token = device.deviceToken;
  const original = await f.document(token);
  const artifactId = original.job.artifacts[0].id;
  const artifact = await f.api(`/api/v1/artifacts/${artifactId}`, { token });
  await f.stop();
  await f.changeStoppedState(state => { delete state.requests[original.body.requestId]; });
  await f.start();
  const key = randomBytes(32);
  const exported = await f.api('/api/backups/export', { method: 'POST', body: { encryptionKey: key.toString('hex') } });
  assert.equal(exported.status, 200, JSON.stringify(exported.body));
  assert.equal(hash(exported.bytes), exported.headers.get('x-content-sha256'));
  const snapshot = decryptBackup(exported.bytes, key);
  assert.equal(Object.hasOwn(snapshot.state.requests, original.body.requestId), false);
  assert.equal(snapshot.state.requestLedger[original.body.requestId].reference.id, original.job.id);
  await f.stop();
  const targetDir = path.join(f.root, 'restored'), newOwner = 'fresh-restored-ledger-owner-test-only';
  restoreBackup({ archive: exported.bytes, key, targetDir }); key.fill(0);
  await f.start({ dataDir: targetDir, owner: newOwner });
  assert.equal((await f.api('/api/v1/state', { token })).status, 401);
  const newDevice = await f.enroll(newOwner), newToken = newDevice.deviceToken;
  assert.equal((await f.state(newToken)).emergencyStop, true);
  const lookup = await f.api(`/api/v1/requests/${original.body.requestId}`, { token: newToken });
  assert.equal(lookup.status, 200); assert.equal(lookup.body.request.cached, false);
  assert.equal(lookup.body.request.reference.id, original.job.id);
  const retry = await f.api('/api/v1/commands', { method: 'POST', token: newToken, body: original.body });
  assert.equal(retry.status, 201, JSON.stringify(retry.body));
  assert.equal(retry.body.job.id, original.job.id);
  assert.deepEqual(retry.body.job.artifacts, original.job.artifacts);
  assert.equal((await f.state(newToken)).jobs.length, 1);
  const restoredArtifact = await f.api(`/api/v1/artifacts/${artifactId}`, { token: newToken });
  assert.equal(restoredArtifact.status, 200); assert.deepEqual(restoredArtifact.bytes, artifact.bytes);
});
