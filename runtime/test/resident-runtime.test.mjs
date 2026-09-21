import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { startResident, validateResidentConfig, serveConfigurationIsEmpty } from '../resident.mjs';
import { openStore } from '../lib/store.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function availablePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port === 9443 ? availablePort() : port;
}
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-resident-test-'));
  const config = { version: 1, dataDir: path.join(root, 'data'), tokenFile: path.join(root, 'token'),
    controlDir: path.join(root, 'control'), port: await availablePort(), phone: null };
  fs.mkdirSync(config.dataDir); fs.mkdirSync(config.controlDir);
  const token = crypto.randomBytes(24).toString('base64url');
  fs.writeFileSync(config.tokenFile, token, { mode: 0o600 });
  const residents = [];
  t.after(async () => {
    for (const resident of residents) await resident.stop().catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
  });
  const begin = async adapters => { const resident = await startResident(config, adapters); residents.push(resident); return resident; };
  async function call(route, body, credential = token, headers = {}) {
    return new Promise((resolve, reject) => {
      const request = http.request(`http://127.0.0.1:${config.port}${route}`, { agent: false, method: body === undefined ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json', ...headers } }, response => {
        const chunks = []; response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => { try { resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }); } catch (error) { reject(error); } });
      });
      request.on('error', reject); request.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }
  return { root, config, token, begin, call };
}
async function waitFor(fn, timeout = 10000) {
  const expires = Date.now() + timeout;
  while (Date.now() < expires) { const value = await fn(); if (value) return value; await delay(40); }
  throw new Error('Timed out waiting for test condition');
}
function phoneAdapter(config, { serving = {}, health = true } = {}) {
  config.phone = { dnsName: 'windows.example.ts.net', executable: path.resolve('synthetic-tailscale') };
  const calls = [], child = new EventEmitter();
  Object.assign(child, { exitCode: null, signalCode: null, killed: false });
  child.kill = signal => { child.killed = true; child.signalCode = signal; setImmediate(() => { child.emit('exit', null, signal); child.emit('close', null, signal); }); return true; };
  return { calls, child, adapters: {
    runTailscale: async (executable, args) => { calls.push({ executable, args }); return args[0] === 'status'
      ? { BackendState: 'Running', Self: { DNSName: `${config.phone.dnsName}.` } } : serving; },
    spawn: (executable, args, options) => { calls.push({ executable, args, options }); setImmediate(() => child.emit('spawn')); return child; },
    probePhoneHealth: async () => health,
  } };
}

test('resident validates strict paths, ports and DNS; rejects inherited configuration fields', async t => {
  const { config } = await fixture(t);
  assert.deepEqual(validateResidentConfig(config), config);
  for (const change of [{ port: 80 }, { port: 9443 }, { dataDir: 'relative' }, { controlDir: config.dataDir }, { extra: true },
    { phone: { dnsName: 'evil.ts.net/path', executable: process.execPath } }, { phone: { dnsName: 'windows.example.ts.net', executable: 'tailscale' } }]) {
    assert.throws(() => validateResidentConfig({ ...config, ...change }));
  }
});

test('resident really boots loopback core with explicit token and no inherited host/provider override', async t => {
  const f = await fixture(t);
  const names = ['YENO_TOKEN', 'YENO_TOKEN_FILE', 'YENO_HOST', 'YENO_PORT', 'YENO_ALLOWED_HOSTS', 'YENO_AGENT_API_KEY'];
  const prior = names.map(key => [key, process.env[key]]);
  for (const name of names) process.env[name] = name === 'YENO_HOST' ? '0.0.0.0' : 'untrusted-environment-value';
  t.after(() => { for (const [key, value] of prior) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const resident = await f.begin();
  assert.equal(resident.runtime.server.address().address, '127.0.0.1');
  assert.equal((await f.call('/api/health')).status, 200);
  assert.equal((await f.call('/api/state')).body.ai.configured, false);
  assert.equal((await f.call('/api/state', undefined, 'untrusted-environment-value')).status, 401);
  assert.equal((await f.call('/api/health', undefined, f.token, { Host: 'outside.example' })).status, 403);
  const info = fs.readFileSync(path.join(f.config.controlDir, 'instance.json'), 'utf8');
  assert.equal(info.includes(f.token), false);
  assert.equal(info.includes('untrusted-environment-value'), false);
  assert.equal(JSON.parse(info).state, 'running');
});

test('duplicate startup preserves original instance and data writer; port collision fails without active claim', async t => {
  const f = await fixture(t); await f.begin();
  const instanceFile = path.join(f.config.controlDir, 'instance.json');
  const prior = fs.readFileSync(instanceFile, 'utf8');
  await assert.rejects(f.begin(), { code: 'RESIDENT_ALREADY_RUNNING' });
  assert.equal(fs.readFileSync(instanceFile, 'utf8'), prior);
  const other = await fixture(t); other.config.port = f.config.port;
  await assert.rejects(other.begin(), { code: 'EADDRINUSE' });
  assert.equal(fs.existsSync(path.join(other.config.controlDir, 'instance.json')), false);
  assert.equal((await f.call('/api/health')).status, 200);
});

test('phone API enrollment, document, request identity and artifact bytes survive actual core restart', async t => {
  const f = await fixture(t); let resident = await f.begin();
  const native = { Origin: 'http://tauri.localhost' };
  const enrolled = await f.call('/api/v1/devices/enroll', { name: 'Synthetic Android API client', platform: 'android', requestId: crypto.randomUUID() }, f.token, native);
  assert.equal(enrolled.status, 201);
  const credential = enrolled.body.device.deviceToken;
  const initialIdentity = resident.runtime.state().core.identity;
  const request = { text: '문서 만들어: resident restart acceptance', requestId: crypto.randomUUID() };
  const accepted = await f.call('/api/v1/commands', request, credential, native);
  assert.equal(accepted.status, 201);
  const id = accepted.body.job.id;
  const completed = await waitFor(() => resident.runtime.state().jobs.find(job => job.id === id && job.status === 'completed'));
  const artifact = completed.artifacts[0];
  const readArtifact = () => fetch(`http://127.0.0.1:${f.config.port}/api/v1/artifacts/${artifact.id}`, { headers: { Authorization: `Bearer ${credential}`, ...native } }).then(async response => { assert.equal(response.status, 200); return response.text(); });
  const content = await readArtifact();
  await resident.stop(); await resident.closed;
  resident = await f.begin();
  assert.deepEqual(resident.runtime.state().core.identity, initialIdentity);
  const replay = await f.call('/api/v1/commands', request, credential, native);
  assert.equal(replay.body.job.id, id);
  assert.equal(resident.runtime.state().jobs.filter(job => job.id === id).length, 1);
  assert.equal(await readArtifact(), content);
});

test('nonce-bound stop is graceful; unfinished jobs stay paused until explicit owner resume', async t => {
  const f = await fixture(t); let resident = await f.begin();
  const request = { text: '문서 만들어: pause before scheduler starts', requestId: crypto.randomUUID() };
  const accepted = await f.call('/api/commands', request);
  assert.equal(accepted.status, 201);
  await resident.stop(); await resident.closed;
  const id = accepted.body.job.id;
  resident = await f.begin();
  assert.equal(resident.runtime.state().jobs.find(job => job.id === id).status, 'paused');
  await delay(350);
  assert.equal(resident.runtime.state().jobs.find(job => job.id === id).status, 'paused');
  const resume = await f.call(`/api/jobs/${id}/action`, { action: 'resume', requestId: crypto.randomUUID() });
  assert.equal(resume.status, 200);
  await waitFor(() => resident.runtime.state().jobs.find(job => job.id === id)?.status === 'completed');
  fs.writeFileSync(path.join(f.config.controlDir, 'stop.json'), JSON.stringify({ instanceId: 'stale-other-process' }));
  await delay(350); assert.equal(resident.info.state, 'running');
  fs.writeFileSync(path.join(f.config.controlDir, 'stop.json'), JSON.stringify({ instanceId: resident.info.instanceId }));
  await resident.closed;
  assert.equal(resident.info.state, 'stopped');
  await assert.rejects(fetch(`http://127.0.0.1:${f.config.port}/api/health`));
});

test('emergency stop persists through resident restart and blocks new work without model calls', async t => {
  const f = await fixture(t); let resident = await f.begin();
  assert.equal((await f.call('/api/control', { action: 'stop', requestId: crypto.randomUUID() })).status, 200);
  await resident.stop(); resident = await f.begin();
  assert.equal(resident.runtime.state().emergencyStop, true);
  assert.equal((await f.call('/api/commands', { text: '문서 만들어: blocked', requestId: crypto.randomUUID() })).status, 409);
  assert.equal(resident.runtime.state().jobs.length, 0);
});

test('unknown provider receipt remains unknown and paused across resident boots, never resent', async t => {
  const f = await fixture(t);
  const store = openStore(f.config.dataDir), id = crypto.randomUUID(), callId = crypto.randomUUID(), at = new Date().toISOString();
  store.state.jobs.push({ id, title: 'Synthetic interrupted model receipt', type: 'agent', input: 'test', status: 'running', step: 0,
    totalSteps: 3, createdAt: at, updatedAt: at, error: null, version: 1, artifacts: [],
    agentJournal: { provider: 'openai', model: 'synthetic-not-a-model', calls: [{ id: callId, at, status: 'reserved', inputTokens: null, outputTokens: null }], history: [] } });
  store.save();
  let resident = await f.begin();
  assert.equal(resident.runtime.state().jobs.find(job => job.id === id).status, 'paused');
  assert.equal(resident.runtime.state().agent.usage.unknown, 1);
  assert.equal((await f.call(`/api/jobs/${id}/action`, { action: 'resume', requestId: crypto.randomUUID() })).status, 409);
  await resident.stop(); resident = await f.begin();
  await delay(250);
  const saved = openStore(f.config.dataDir).state.jobs.find(job => job.id === id);
  assert.equal(saved.status, 'paused');
  assert.equal(saved.agentJournal.calls.length, 1);
  assert.equal(saved.agentJournal.calls[0].id, callId);
  assert.equal(saved.agentJournal.calls[0].status, 'unknown');
});

test('recorded live orphan bridge blocks new instance without overwriting its evidence', async t => {
  const f = await fixture(t), filename = path.join(f.config.controlDir, 'instance.json');
  // Current process is an actually-live PID, not a fake process-liveness answer.
  const record = JSON.stringify({ version: 1, pid: 0, state: 'running', instanceId: crypto.randomUUID(), phonePid: process.pid });
  fs.writeFileSync(filename, record);
  await assert.rejects(f.begin(), { code: 'RESIDENT_ORPHANED_BRIDGE' });
  assert.equal(fs.readFileSync(filename, 'utf8'), record);
  assert.equal(fs.existsSync(path.join(f.config.dataDir, 'runtime.lock')), false);
});

test('empty Serve configurations include fresh defaults but reject nested foreground routes', () => {
  for (const value of [null, {}, { TCP: null, Web: {}, Foreground: {} }]) assert.equal(serveConfigurationIsEmpty(value), true);
  for (const value of [{ TCP: { 9443: { HTTPS: true } } }, { Foreground: { abc: { TCP: { 9443: { HTTPS: true } } } } }, { unknown: false }, '']) assert.equal(serveConfigurationIsEmpty(value), false);
});

test('synthetic Tailscale uses configured port, verifies health, and terminates only its own child', async t => {
  const f = await fixture(t); const fake = phoneAdapter(f.config); const resident = await f.begin(fake.adapters);
  const launch = fake.calls.find(call => call.options);
  assert.deepEqual(launch.args, ['serve', '--https=9443', `http://127.0.0.1:${f.config.port}`]);
  assert.equal(launch.options.shell, false); assert.equal(launch.options.stdio, 'ignore');
  assert.deepEqual(resident.info.phone, { status: 'available', verified: true });
  assert.equal((await f.call('/api/health', undefined, f.token, { Host: `${f.config.phone.dnsName}:9443` })).status, 200);
  await resident.stop(); await resident.closed;
  assert.equal(fake.child.killed, true);
  assert.deepEqual(resident.info.phone, { status: 'stopped', verified: false });
  assert.equal(fake.calls.some(call => call.args.some(arg => ['reset', 'off', '--bg', 'funnel'].includes(arg))), false);
});

test('phone remains pending on failed HTTPS probe; route conflict/logout blocks bridge but local core runs', async t => {
  const f = await fixture(t); const fake = phoneAdapter(f.config, { health: false });
  const resident = await f.begin(fake.adapters);
  assert.deepEqual(resident.info.phone, { status: 'pending', verified: false });
  await resident.stop();
  const conflict = phoneAdapter(f.config, { serving: { Foreground: { other: { TCP: { 9443: { HTTPS: true } } } } } });
  const conflicted = await f.begin(conflict.adapters);
  assert.equal(conflicted.info.phone.reason, 'RESIDENT_TAILSCALE_CONFLICT');
  assert.equal(conflicted.info.phone.status, 'blocked');
  assert.equal(conflict.calls.some(call => call.options), false);
  assert.equal((await f.call('/api/health')).status, 200);
  assert.equal((await f.call('/api/health', undefined, f.token, { Host: `${f.config.phone.dnsName}:9443` })).status, 403);
  await conflicted.stop();
  const loggedOut = await f.begin({ ...fake.adapters, runTailscale: async () => ({ BackendState: 'NeedsLogin' }) });
  assert.equal(loggedOut.info.phone.reason, 'RESIDENT_TAILSCALE_NOT_READY');
  assert.equal((await f.call('/api/health')).status, 200);
});

test('metadata write failure cannot prevent core and owned phone process cleanup', async t => {
  const f = await fixture(t), fake = phoneAdapter(f.config);
  let failWrites = false;
  const resident = await f.begin({ ...fake.adapters, writeInstance: (filename, info) => {
    if (failWrites) throw Object.assign(new Error('synthetic filesystem failure'), { code: 'EACCES' });
    fs.writeFileSync(filename, JSON.stringify(info));
  } });
  failWrites = true;
  await assert.rejects(resident.stop(), { code: 'EACCES' });
  await assert.rejects(resident.closed, { code: 'EACCES' });
  assert.equal(fake.child.killed, true);
  assert.equal(resident.runtime.server.listening, false);
  assert.equal(fs.existsSync(path.join(f.config.dataDir, 'runtime.lock')), false);
});
