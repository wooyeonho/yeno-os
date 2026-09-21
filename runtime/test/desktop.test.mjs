import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { startDesktop } from '../desktop.mjs';
import { start } from '../server.mjs';
import { openStore } from '../lib/store.mjs';

const EMPTY = { version: 1, providers: [], primaryProvider: null, dailyCallLimit: 1 };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// This injected AES-GCM adapter proves the application's encryption boundary,
// not Windows DPAPI, ACL enforcement, physical Android or live model quality.
function syntheticCrypto() {
  const key = crypto.randomBytes(32);
  const calls = { protect: 0, unprotect: 0 };
  return { calls,
    async protect(text) {
      calls.protect++;
      const nonce = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
      const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64');
    },
    async unprotect(text) {
      calls.unprotect++;
      const bytes = Buffer.from(text, 'base64');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
}

function request(url, { body, headers = {}, method = body === undefined ? 'GET' : 'POST' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { agent: false, method, headers: { 'Content-Type': 'application/json', ...headers } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const bytes = Buffer.concat(chunks), text = bytes.toString('utf8');
        let json; try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, bytes, text, json });
      });
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-desktop-test-'));
  const home = path.join(root, 'desktop'), cryptoAdapter = syntheticCrypto(), secured = [], apps = [];
  const key = crypto.randomBytes(32).toString('base64url');
  const secureDirectory = async directory => { secured.push(directory); fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); };
  const options = { home, corePort: 0, setupPort: 0, cryptoAdapter, secureDirectory, sourceRevision: 'test-only-local-revision' };
  t.after(async () => { for (const app of apps) await app.close().catch(() => {}); fs.rmSync(root, { recursive: true, force: true }); });
  const begin = async overrides => { const app = await startDesktop({ ...options, ...overrides }); apps.push(app); return app; };
  const setup = (app, route, body, headers = {}) => {
    const url = new URL(app.url);
    return request(`${url.origin}${route}`, { body, headers: { Origin: url.origin, 'X-Blackhole-Setup': new URLSearchParams(url.hash.slice(1)).get('setup'), ...headers } });
  };
  const initialize = (app, providers = EMPTY) => setup(app, '/setup/initialize', { pairingKey: key, confirmNewStore: true, providers });
  const core = (app, route, body, cookie) => request(`${app.state().coreUrl}${route}`, { body, headers: cookie
    ? { Cookie: cookie, Origin: app.state().coreUrl, 'X-Yeno-Browser': '1' }
    : { Authorization: `Bearer ${key}` } });
  return { root, home, options, key, cryptoAdapter, secured, begin, setup, initialize, core };
}

async function waitFor(fn, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const result = await fn(); if (result) return result; await delay(40); }
  throw new Error('Desktop integration condition did not complete');
}
const cookieFrom = response => response.headers['set-cookie']?.[0]?.split(';')[0];

test('desktop requires explicit crypto/filesystem adapters and refuses existing non-desktop data', async t => {
  const f = await fixture(t);
  await assert.rejects(startDesktop({ ...f.options, cryptoAdapter: undefined }), { code: 'DESKTOP_CONFIGURATION_REQUIRED' });
  await assert.rejects(startDesktop({ ...f.options, secureDirectory: undefined }), { code: 'DESKTOP_CONFIGURATION_REQUIRED' });
  assert.equal(fs.existsSync(f.home), false);
  fs.mkdirSync(f.home); fs.writeFileSync(path.join(f.home, 'existing-state.json'), 'preserve owner data');
  await assert.rejects(f.begin(), { code: 'DESKTOP_EXISTING_DATA_REFUSED' });
  assert.equal(fs.readFileSync(path.join(f.home, 'existing-state.json'), 'utf8'), 'preserve owner data');
  assert.equal(f.secured.length, 0);
});

test('desktop permission setup failure prevents configuration, core and browser launch', async t => {
  const f = await fixture(t); let opened = false;
  await assert.rejects(f.begin({
    secureDirectory: async () => { throw Object.assign(new Error('synthetic access denied'), { code: 'EACCES' }); },
    openBrowser: () => { opened = true; },
  }), { code: 'EACCES' });
  assert.equal(opened, false);
  assert.equal(fs.existsSync(path.join(f.home, 'desktop.dpapi')), false);
  assert.equal(fs.existsSync(path.join(f.home, 'data')), false);
  assert.equal(f.cryptoAdapter.calls.protect, 0);
});

test('desktop setup mutations require nonce, exact host/origin and explicit new-store confirmation', async t => {
  const f = await fixture(t), app = await f.begin();
  const input = { pairingKey: f.key, confirmNewStore: true, providers: EMPTY };
  for (const [headers, code] of [
    [{ 'X-Blackhole-Setup': '' }, 'DESKTOP_SESSION_REQUIRED'],
    [{ Origin: 'https://outside.invalid' }, 'DESKTOP_ORIGIN_REJECTED'],
    [{ Host: 'outside.invalid' }, 'DESKTOP_HOST_REJECTED'],
  ]) {
    const denied = await f.setup(app, '/setup/initialize', input, headers);
    assert.equal(denied.status, 403); assert.equal(denied.json.code, code);
  }
  const missingOrigin = await request(`${new URL(app.url).origin}/setup/initialize`, { body: input,
    headers: { 'X-Blackhole-Setup': new URLSearchParams(new URL(app.url).hash.slice(1)).get('setup') } });
  assert.equal(missingOrigin.status, 403);
  assert.equal((await f.setup(app, '/setup/initialize', { ...input, confirmNewStore: false })).json.code, 'DESKTOP_NEW_STORE_CONFIRMATION_REQUIRED');
  assert.equal(fs.existsSync(path.join(f.home, 'desktop.dpapi')), false);
  assert.equal(app.state().running, false);
  const accepted = await f.initialize(app);
  assert.equal(accepted.status, 201);
  assert.equal((await f.initialize(app)).status, 409);
  assert.equal(f.secured.includes(path.join(f.home, 'data')), true);
});

test('encrypted setup issues canonical HttpOnly cookie without returning credential in state or URLs', async t => {
  const f = await fixture(t), app = await f.begin();
  const initialized = await f.initialize(app);
  assert.equal(initialized.status, 201);
  assert.match(initialized.headers['set-cookie'][0], /^blackhole-desktop-v1=/);
  assert.match(initialized.headers['set-cookie'][0], /HttpOnly/);
  assert.match(initialized.headers['set-cookie'][0], /SameSite=Strict/);
  const cookie = cookieFrom(initialized), session = await f.core(app, '/api/web/session', undefined, cookie);
  assert.equal(session.status, 200); assert.equal(session.json.authenticated, true);
  const state = await f.setup(app, '/setup/state');
  assert.equal(state.json.phoneStatus, 'not_connected');
  const configText = fs.readFileSync(path.join(f.home, 'desktop.dpapi'), 'utf8');
  for (const publicText of [app.url, initialized.text, state.text, configText]) assert.equal(publicText.includes(f.key), false);
  assert.equal(JSON.parse(await f.cryptoAdapter.unprotect(configText.trim())).pairingKey, f.key);
  assert.equal(f.cryptoAdapter.calls.protect, 1);
  assert.equal((await request(`${app.state().coreUrl}/api/state`)).status, 401);
});

test('desktop cookie namespace preserves a simultaneous existing loopback core browser session', async t => {
  const f = await fixture(t), legacyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-legacy-session-test-'));
  const legacyKey = crypto.randomBytes(32).toString('base64url');
  const legacy = await start({ dataDir: legacyRoot, host: '127.0.0.1', port: 0, token: legacyKey, env: {} });
  t.after(async () => {
    const closed = new Promise(resolve => legacy.server.listening ? legacy.server.once('close', resolve) : resolve());
    legacy.shutdown(); legacy.server.closeAllConnections?.(); await closed;
    fs.rmSync(legacyRoot, { recursive: true, force: true });
  });
  const legacyUrl = `http://127.0.0.1:${legacy.server.address().port}`;
  const legacyLogin = await request(`${legacyUrl}/api/web/session`, {
    body: { requestId: crypto.randomUUID(), name: 'Existing local owner browser', remember: true },
    headers: { Authorization: `Bearer ${legacyKey}`, Origin: legacyUrl, 'X-Yeno-Browser': '1' },
  });
  assert.equal(legacyLogin.status, 201);
  assert.match(legacyLogin.headers['set-cookie'][0], /^yeno-web-dev-v1=/);
  const legacyCookie = cookieFrom(legacyLogin);
  const legacySession = cookie => request(`${legacyUrl}/api/web/session`, { headers: { Cookie: cookie, Origin: legacyUrl, 'X-Yeno-Browser': '1' } });
  const originalSession = await legacySession(legacyCookie);
  assert.equal(originalSession.status, 200);
  const app = await f.begin(), desktopLogin = await f.initialize(app), desktopCookie = cookieFrom(desktopLogin);
  assert.equal(desktopLogin.status, 201);
  assert.match(desktopCookie, /^blackhole-desktop-v1=/);
  assert.notEqual(desktopCookie.split('=')[0], legacyCookie.split('=')[0]);
  // A real browser sends both host-scoped cookies across loopback ports.
  // Each existing session engine must select only its own cookie name.
  const browserCookies = `${legacyCookie}; ${desktopCookie}`;
  const preserved = await legacySession(browserCookies);
  const desktopSession = await f.core(app, '/api/web/session', undefined, browserCookies);
  assert.equal(preserved.status, 200);
  assert.deepEqual(preserved.json, originalSession.json);
  assert.equal(desktopSession.status, 200);
  assert.notEqual(desktopSession.json.device.id, originalSession.json.device.id);
  assert.notEqual(desktopSession.json.storageScope, originalSession.json.storageScope);
  assert.equal((await legacySession(desktopCookie)).status, 401);
  assert.equal((await f.core(app, '/api/web/session', undefined, legacyCookie)).status, 401);
  await app.close();
  assert.deepEqual((await legacySession(legacyCookie)).json, originalSession.json);
});

test('desktop uses actual document and memory engines; cookie, identity, job and artifact survive restart', async t => {
  const f = await fixture(t); let app = await f.begin();
  const initialized = await f.initialize(app), cookie = cookieFrom(initialized);
  const initial = (await f.core(app, '/api/state', undefined, cookie)).json;
  const command = { text: '문서 만들어: desktop durable local result', requestId: crypto.randomUUID() };
  const accepted = await f.core(app, '/api/commands', command, cookie);
  assert.equal(accepted.status, 201);
  const jobId = accepted.json.job.id;
  const job = await waitFor(async () => (await f.core(app, '/api/state', undefined, cookie)).json.jobs.find(j => j.id === jobId && j.status === 'completed'));
  const artifact = await f.core(app, `/api/artifacts/${job.artifacts[0].id}`, undefined, cookie);
  assert.equal(artifact.status, 200);
  assert.equal(crypto.createHash('sha256').update(artifact.bytes).digest('hex'), artifact.headers['x-content-sha256']);
  const memory = await f.core(app, '/api/memory', { text: 'Keep local desktop acceptance memory', requestId: crypto.randomUUID() }, cookie);
  assert.equal(memory.status, 201);
  const configBefore = fs.readFileSync(path.join(f.home, 'desktop.dpapi'), 'utf8');
  await app.close(); app = await f.begin();
  assert.equal(app.state().unlocked, false);
  assert.equal(app.state().running, true);
  assert.equal(fs.readFileSync(path.join(f.home, 'desktop.dpapi'), 'utf8'), configBefore);
  const recovered = await f.core(app, '/api/state', undefined, cookie);
  assert.equal(recovered.status, 200);
  assert.deepEqual(recovered.json.core.identity, initial.core.identity);
  assert.equal(recovered.json.memories.find(m => m.id === memory.json.memory.id)?.text, 'Keep local desktop acceptance memory');
  const replay = await f.core(app, '/api/commands', command, cookie);
  assert.equal(replay.json.job.id, jobId);
  assert.equal(recovered.json.jobs.filter(j => j.id === jobId).length, 1);
  assert.deepEqual((await f.core(app, `/api/artifacts/${job.artifacts[0].id}`, undefined, cookie)).bytes, artifact.bytes);
  assert.equal((await f.setup(app, '/setup/unlock', { pairingKey: 'incorrect-but-long-enough' })).status, 401);
  const unlocked = await f.setup(app, '/setup/unlock', { pairingKey: f.key });
  assert.equal(unlocked.status, 200);
  const again = await f.core(app, '/api/web/session', undefined, cookieFrom(unlocked));
  const before = await f.core(app, '/api/web/session', undefined, cookie);
  assert.equal(again.json.device.id, before.json.device.id);
  assert.equal(again.json.storageScope, before.json.storageScope);
});

test('desktop rejects a duplicate setup listener before decryption without disrupting the existing core', async t => {
  const f = await fixture(t), app = await f.begin(); await f.initialize(app);
  const encryptedBefore = fs.readFileSync(path.join(f.home, 'desktop.dpapi'), 'utf8');
  const decryptions = f.cryptoAdapter.calls.unprotect;
  await assert.rejects(f.begin({ setupPort: Number(new URL(app.url).port) }), { code: 'EADDRINUSE' });
  assert.equal(f.cryptoAdapter.calls.unprotect, decryptions);
  assert.equal(fs.readFileSync(path.join(f.home, 'desktop.dpapi'), 'utf8'), encryptedBefore);
  assert.equal((await f.core(app, '/api/state')).status, 200);
});

test('desktop rate limits incorrect keys without changing credentials or closing existing sessions', async t => {
  const f = await fixture(t), app = await f.begin();
  const initialized = await f.initialize(app), cookie = cookieFrom(initialized);
  const configBefore = fs.readFileSync(path.join(f.home, 'desktop.dpapi'), 'utf8');
  for (let attempt = 0; attempt < 10; attempt++) {
    const denied = await f.setup(app, '/setup/unlock', { pairingKey: `incorrect-owner-key-${attempt}` });
    assert.equal(denied.status, 401);
  }
  const limited = await f.setup(app, '/setup/unlock', { pairingKey: f.key });
  assert.equal(limited.status, 429); assert.equal(limited.json.code, 'DESKTOP_RATE_LIMITED');
  assert.equal(fs.readFileSync(path.join(f.home, 'desktop.dpapi'), 'utf8'), configBefore);
  assert.equal((await f.core(app, '/api/state', undefined, cookie)).status, 200);
});

test('desktop refuses corrupted or invalid encrypted configuration and preserves prior data', async t => {
  const f = await fixture(t); let app = await f.begin(); await f.initialize(app); await app.close();
  const configFile = path.join(f.home, 'desktop.dpapi'), stateFile = path.join(f.home, 'data', 'state.json');
  const original = fs.readFileSync(configFile, 'utf8'), state = fs.readFileSync(stateFile, 'utf8');
  const valid = JSON.parse(await f.cryptoAdapter.unprotect(original.trim()));
  for (const bad of [original.slice(0, -10) + 'tampered', await f.cryptoAdapter.protect(JSON.stringify({ ...valid, version: 99 }))]) {
    fs.writeFileSync(configFile, bad);
    await assert.rejects(f.begin(), { code: 'DESKTOP_CREDENTIALS_UNAVAILABLE' });
    assert.equal(fs.readFileSync(configFile, 'utf8'), bad);
    assert.equal(fs.readFileSync(stateFile, 'utf8'), state);
    assert.equal(fs.existsSync(path.join(f.home, 'data', 'runtime.lock')), false);
  }
  fs.writeFileSync(configFile, original);
  app = await f.begin(); assert.equal((await f.core(app, '/api/state')).status, 200);
});

test('desktop persists encrypted provider settings without enabling AI or claiming live provider validation', async t => {
  const f = await fixture(t), app = await f.begin(); await f.initialize(app);
  const providers = { version: 1, providers: [{ provider: 'openai', model: 'synthetic-test-model', apiKey: 'synthetic-provider-secret-value' }], primaryProvider: 'openai', dailyCallLimit: 1 };
  const result = await f.setup(app, '/setup/providers', { pairingKey: f.key, providers });
  assert.equal(result.status, 200);
  assert.equal(result.json.providers.configured, true);
  assert.equal(result.json.providers.liveVerification, 'not_checked');
  assert.equal(result.json.providers.automaticCalls, false);
  const state = await f.core(app, '/api/state');
  assert.equal(state.json.modules.ai, false);
  assert.equal(state.json.agent.automaticReviews, false);
  assert.equal(state.json.agent.usage.attempts, 0);
  for (const value of [result.text, JSON.stringify(app.state()), state.text, fs.readFileSync(path.join(f.home, 'desktop.dpapi'), 'utf8')]) {
    assert.equal(value.includes(providers.providers[0].apiKey), false);
    assert.equal(value.includes(f.key), false);
  }
  const saved = JSON.parse(await f.cryptoAdapter.unprotect(fs.readFileSync(path.join(f.home, 'desktop.dpapi'), 'utf8').trim()));
  assert.deepEqual(saved.providers, providers);
});

test('desktop intake registers canonical projects and required keywords once without pretending they executed', async t => {
  const f = await fixture(t); let app = await f.begin(); await f.initialize(app);
  assert.equal((await f.core(app, '/api/memory', { text: 'Existing owner memory must remain', requestId: crypto.randomUUID() })).status, 201);
  assert.equal((await f.core(app, '/api/projects', { name: 'Existing owner project', requestId: crypto.randomUUID() })).status, 201);
  const before = (await f.core(app, '/api/state')).json;
  assert.equal(before.sources.length, 0);
  assert.equal((await f.setup(app, '/setup/intake', { pairingKey: 'wrong-owner-pairing-key' })).status, 401);
  assert.equal((await f.setup(app, '/setup/intake', { pairingKey: f.key, run: true })).status, 400);
  assert.equal((await f.core(app, '/api/state')).json.sources.length, 0);
  const first = await f.setup(app, '/setup/intake', { pairingKey: f.key });
  assert.equal(first.status, 200);
  assert.equal(first.json.canonicalCount, 50);
  assert.ok(first.json.createdCount >= 50);
  assert.equal(first.json.implementationStatus, 'intake_only');
  const imported = (await f.core(app, '/api/state')).json;
  assert.equal(imported.sources.length, first.json.createdCount);
  for (const term of ['자동매매', '엔화', '당근', '식물로봇', '다마고치', '음식물쓰레기', '산양게임', '코리아타운', '소설', 'Grok', 'God Eye']) {
    assert.ok(imported.sources.some(source => [source.title, source.sourceLocator, ...(source.aliases ?? [])].includes(term)), `Required keyword is reachable: ${term}`);
  }
  for (const source of imported.sources) {
    assert.ok(['unread', 'partial'].includes(source.readingStatus));
    assert.equal(source.decision, 'pending');
  }
  assert.deepEqual(imported.memories, before.memories);
  assert.deepEqual(imported.projects, before.projects);
  assert.deepEqual(imported.jobs, before.jobs);
  const second = await f.setup(app, '/setup/intake', { pairingKey: f.key });
  assert.equal(second.status, 200);
  assert.equal(second.json.createdCount, 0);
  assert.equal(second.json.implementationStatus, 'intake_only');
  assert.deepEqual((await f.core(app, '/api/state')).json.sources, imported.sources);
  await app.close(); app = await f.begin();
  const third = await f.setup(app, '/setup/intake', { pairingKey: f.key });
  assert.equal(third.json.createdCount, 0);
  const restored = (await f.core(app, '/api/state')).json;
  assert.deepEqual(restored.sources, imported.sources);
  assert.deepEqual(restored.memories, before.memories);
  assert.deepEqual(restored.projects, before.projects);
  assert.deepEqual(restored.jobs, before.jobs);
});

test('desktop keeps unfinished work paused and emergency stop durable through actual stop/start', async t => {
  const f = await fixture(t); let app = await f.begin(); await f.initialize(app);
  const accepted = await f.core(app, '/api/commands', { text: '문서 만들어: paused desktop task', requestId: crypto.randomUUID() });
  assert.equal(accepted.status, 201);
  await app.close(); app = await f.begin();
  const jobId = accepted.json.job.id;
  assert.equal((await f.core(app, '/api/state')).json.jobs.find(j => j.id === jobId).status, 'paused');
  await delay(300);
  assert.equal((await f.core(app, '/api/state')).json.jobs.find(j => j.id === jobId).status, 'paused');
  assert.equal((await f.core(app, `/api/jobs/${jobId}/action`, { action: 'resume', requestId: crypto.randomUUID() })).status, 200);
  await waitFor(async () => (await f.core(app, '/api/state')).json.jobs.find(j => j.id === jobId && j.status === 'completed'));
  assert.equal((await f.core(app, '/api/control', { action: 'stop', requestId: crypto.randomUUID() })).status, 200);
  await app.close(); app = await f.begin();
  assert.equal((await f.core(app, '/api/state')).json.emergencyStop, true);
  assert.equal((await f.core(app, '/api/commands', { text: '문서 만들어: must be blocked', requestId: crypto.randomUUID() })).status, 409);
});

test('desktop restart preserves unknown provider outcome without resending or duplicating a durable call', async t => {
  const f = await fixture(t); let app = await f.begin(); await f.initialize(app); await app.close();
  const store = openStore(path.join(f.home, 'data')), id = crypto.randomUUID(), callId = crypto.randomUUID(), at = new Date().toISOString();
  store.state.jobs.push({ id, title: 'Synthetic interrupted desktop receipt', type: 'agent', input: 'test', status: 'running', step: 0,
    totalSteps: 3, createdAt: at, updatedAt: at, error: null, version: 1, artifacts: [],
    agentJournal: { provider: 'openai', model: 'synthetic-not-a-model', calls: [{ id: callId, at, status: 'reserved', inputTokens: null, outputTokens: null }], history: [] } });
  store.save();
  for (let restart = 0; restart < 2; restart++) {
    app = await f.begin();
    const current = (await f.core(app, '/api/state')).json;
    assert.equal(current.jobs.find(j => j.id === id).status, 'paused');
    assert.equal(current.agent.usage.unknown, 1);
    assert.equal((await f.core(app, `/api/jobs/${id}/action`, { action: 'resume', requestId: crypto.randomUUID() })).status, 409);
    await app.close();
    const saved = openStore(path.join(f.home, 'data')).state.jobs.find(j => j.id === id);
    assert.equal(saved.agentJournal.calls.length, 1);
    assert.equal(saved.agentJournal.calls[0].id, callId);
    assert.equal(saved.agentJournal.calls[0].status, 'unknown');
  }
});
