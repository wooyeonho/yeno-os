import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes, randomUUID, createHash} from 'node:crypto';
import {start} from '../server.mjs';
import {createWebSessions} from '../lib/web-session.mjs';
import {decryptBackup, restoreBackup} from '../lib/backup.mjs';

const OWNER = 'web-session-test-owner-never-a-real-key';
const cookiePart = value => value?.split(';')[0] ?? '';

async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-web-session-'));
  let time = Date.now(), core;
  const boot = async () => {
    core = await start({dataDir: path.join(dir, 'original'), port: 0, token: OWNER, env: {}, webSessionNow: () => time});
  };
  await boot();
  t.after(() => { core.shutdown(); fs.rmSync(dir, {recursive: true, force: true}); });
  const base = () => `http://127.0.0.1:${core.server.address().port}`;
  async function request(route, {body, cookie, bearer, headers = {}, browser = true} = {}) {
    const outgoing = {
      ...(browser ? {'X-Yeno-Browser': '1'} : {}),
      ...(body === undefined ? {} : {'Content-Type': 'application/json', Origin: base()}),
      ...(cookie ? {Cookie: cookie} : {}),
      ...(bearer ? {Authorization: `Bearer ${bearer}`} : {}), ...headers,
    };
    for (const key of Object.keys(outgoing)) if (outgoing[key] === null) delete outgoing[key];
    const response = await fetch(base() + route, {method: body === undefined ? 'GET' : 'POST', headers: outgoing, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
    const bytes = Buffer.from(await response.arrayBuffer());
    let value; try { value = JSON.parse(bytes.toString('utf8')); } catch { value = bytes; }
    return {status: response.status, headers: response.headers, body: value, bytes, cookie: cookiePart(response.headers.get('set-cookie'))};
  }
  const login = (body = {requestId: randomUUID(), name: 'Synthetic phone browser', remember: true}, options = {}) => request('/api/web/session', {body, bearer: OWNER, ...options});
  const native = async () => {
    const response = await request('/api/v1/devices/enroll', {body: {requestId: randomUUID(), name: 'Preserved native APK', platform: 'android'}, bearer: OWNER, browser: false, headers: {Origin: 'http://tauri.localhost'}});
    assert.equal(response.status, 201); return response.body.device;
  };
  return {dir, base, request, login, native, core: () => core, advance: ms => {time += ms;}, restart: async () => {core.shutdown(); await boot();}};
}

test('web login persists a separate device, replays a lost cookie response, and contains no raw credential', async t => {
  const f = await fixture(t), native = await f.native();
  const body = {requestId: randomUUID(), name: 'Synthetic Android browser', remember: true};
  const first = await f.login(body); assert.equal(first.status, 201);
  assert.equal(first.body.authenticated, true); assert.equal(first.body.device.platform, 'web');
  assert.notEqual(first.body.device.id, native.id);
  assert.match(first.body.storageScope, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(Object.keys(first.body.device), ['id', 'name', 'platform', 'createdAt']);
  assert.match(first.headers.get('set-cookie'), /^yeno-web-dev-v1=.*; Path=\/; HttpOnly; SameSite=Strict; Max-Age=/);
  assert.equal(first.headers.get('cache-control'), 'no-store');
  const retry = await f.login(body); assert.equal(retry.status, 201);
  assert.deepEqual(retry.body, first.body); assert.equal(retry.cookie, first.cookie);
  assert.equal((await f.request('/api/devices', {bearer: OWNER})).body.devices.length, 2);
  const session = await f.request('/api/web/session', {cookie: first.cookie});
  assert.equal(session.status, 200); assert.deepEqual(session.body, first.body);
  assert.equal((await f.request('/api/state', {cookie: first.cookie})).status, 200);
  const disk = fs.readFileSync(path.join(f.core().dataDir, 'state.json'), 'utf8');
  for (const secret of [OWNER, native.deviceToken, first.cookie.split('=')[1]]) assert.equal(disk.includes(secret), false);
  assert.doesNotMatch(JSON.stringify(first.body), /deviceToken|tokenHash|cookie|Bearer/);
  assert.equal((await f.login({...body, name: 'Changed under same ID'})).status, 409);
  await f.restart();
  assert.deepEqual((await f.request('/api/web/session', {cookie: first.cookie})).body, first.body);
  assert.deepEqual((await f.login(body)).body, first.body);
  assert.equal((await f.request('/api/v1/state', {bearer: native.deviceToken, browser: false, headers: {Origin: 'http://tauri.localhost'}})).status, 200);
});

test('signed expiry, tampering, host-only cookie policy and public TLS origin are enforced', async t => {
  const f = await fixture(t);
  const short = await f.login({requestId: randomUUID(), remember: false});
  assert.equal(short.status, 201); assert.doesNotMatch(short.headers.get('set-cookie'), /Max-Age|Expires=/);
  assert.equal(Date.parse(short.body.expiresAt) - Date.parse(short.body.device.createdAt), 8 * 60 * 60 * 1000);
  const tampered = short.cookie.slice(0, -1) + (short.cookie.endsWith('a') ? 'b' : 'a');
  assert.equal((await f.request('/api/state', {cookie: tampered})).status, 401);
  assert.equal((await f.request('/api/state', {cookie: `${short.cookie}; ${short.cookie}`})).status, 401);
  f.advance(8 * 60 * 60 * 1000 + 1000);
  assert.equal((await f.request('/api/state', {cookie: short.cookie})).status, 401);
  assert.equal((await f.request('/api/web/logout', {cookie: short.cookie, body: {requestId: randomUUID()}})).status, 200, 'expired signed capability can still revoke itself');
  const clock = Date.now(), sessions = createWebSessions({key: OWNER, now: () => clock});
  const req = {headers: {host: 'core.example.com', origin: 'https://core.example.com', 'x-yeno-browser': '1', 'content-type': 'application/json', 'x-forwarded-proto': 'http'}, socket: {}};
  sessions.guard(req, {mutation: true});
  const issued = sessions.issue(req, {id: randomUUID(), createdAt: new Date(clock).toISOString()}, true);
  assert.match(issued.cookie, /^__Host-yeno-web-v1=/); assert.match(issued.cookie, /; Secure;/); assert.doesNotMatch(issued.cookie, /; Domain=/);
  assert.equal(issued.expiresAt - clock, 30 * 24 * 60 * 60 * 1000);
  assert.throws(() => sessions.guard({...req, headers: {...req.headers, origin: 'http://core.example.com'}}, {mutation: true}), error => error.status === 403);
  assert.throws(() => sessions.guard({...req, headers: {...req.headers, origin: 'https://alias.example.com'}}, {mutation: true}), error => error.status === 403);
  assert.equal(sessions.read({...req, headers: {...req.headers, cookie: issued.cookie.split(';')[0].replace('__Host-yeno-web-v1', 'yeno-web-dev-v1')}}), null);
});

test('cookie reads and writes reject CSRF and cannot become native or owner credentials', async t => {
  const f = await fixture(t), login = await f.login(), cookie = login.cookie;
  for (const headers of [{Origin: null}, {Origin: 'null'}, {Origin: 'https://attacker.invalid'}, {Origin: 'http://tauri.localhost'}, {'X-Yeno-Browser': null}]) {
    const response = await f.request('/api/memory', {cookie, body: {requestId: randomUUID(), text: 'Must not save'}, headers});
    assert.equal(response.status, 403);
  }
  assert.equal((await f.request('/api/memory', {cookie, body: {requestId: randomUUID(), text: 'Must not save'}, headers: {'Content-Type': 'text/plain'}})).status, 415);
  assert.equal((await f.request('/api/memory', {cookie, body: {text: 'Missing identity'}})).status, 400);
  assert.equal((await f.request('/api/state', {cookie, browser: false})).status, 403);
  assert.equal((await f.request('/api/state', {cookie, headers: {Origin: 'null'}})).status, 403);
  assert.equal((await f.request('/api/v1/state', {cookie})).status, 401);
  assert.equal((await f.request('/api/state', {cookie, bearer: 'incorrect-explicit-bearer'})).status, 401);
  assert.equal((await f.request('/api/devices', {cookie})).status, 403);
  assert.equal((await f.request('/api/backups/export', {cookie, body: {encryptionKey: randomBytes(32).toString('hex')}})).status, 403);
  assert.equal((await f.request(`/api/devices/${login.body.device.id}/revoke`, {cookie, body: {requestId: randomUUID()}})).status, 403);
  assert.equal((await f.request('/api/v1/devices/enroll', {cookie, body: {requestId: randomUUID(), name: 'No permission', platform: 'android'}})).status, 401);
  assert.equal((await f.request('/api/state', {bearer: OWNER, browser: false})).body.memories.length, 0);
  for (const route of ['/api/web/session', '/api/web/logout']) {
    assert.equal((await f.request(route, {cookie, bearer: OWNER, body: {requestId: randomUUID()}, headers: {Origin: null}})).status, 403);
    assert.equal((await f.request(route, {cookie, bearer: OWNER, body: {requestId: randomUUID()}, browser: false})).status, 403);
  }
});

test('web mutations retain exact request identity after lost responses and browser/core restart', async t => {
  const f = await fixture(t), login = await f.login(), cookie = login.cookie;
  const command = {requestId: randomUUID(), text: '문서 만들어: browser closed after acceptance'};
  const accepted = await f.request('/api/commands', {cookie, body: command}); assert.equal(accepted.status, 201);
  for (let i = 0; i < 100 && !f.core().state().jobs.find(job => job.id === accepted.body.job.id)?.artifacts.length; i++) await new Promise(resolve => setTimeout(resolve, 30));
  const job = f.core().state().jobs.find(job => job.id === accepted.body.job.id); assert.equal(job.status, 'completed');
  const artifact = await f.request(`/api/artifacts/${job.artifacts[0].id}`, {cookie}); assert.equal(artifact.status, 200);
  assert.equal(artifact.headers.get('x-content-sha256'), createHash('sha256').update(artifact.bytes).digest('hex'));
  assert.equal((await f.request(`/api/artifacts/${job.artifacts[0].id}`, {cookie, browser: false})).status, 403);
  await f.restart();
  const retried = await f.request('/api/commands', {cookie, body: command});
  assert.equal(retried.status, 201); assert.deepEqual(retried.body, accepted.body);
  assert.equal(f.core().state().jobs.length, 1);
  assert.deepEqual((await f.request(`/api/artifacts/${job.artifacts[0].id}`, {cookie})).bytes, artifact.bytes);
});

test('logout revokes only its browser, replays safely, and survives restart', async t => {
  const f = await fixture(t), native = await f.native(), first = await f.login(), second = await f.login();
  const staleLogout = {requestId: randomUUID(), deviceId: first.body.device.id};
  assert.equal((await f.request('/api/web/logout', {cookie: second.cookie, body: staleLogout})).status, 409, 'a newly connected browser is not revoked by a previous-tab logout');
  assert.equal((await f.request('/api/state', {cookie: second.cookie})).status, 200);
  assert.equal((await f.request('/api/web/logout', {cookie: first.cookie, body: {}})).status, 400);
  assert.equal((await f.request('/api/state', {cookie: first.cookie})).status, 200);
  const body = {requestId: randomUUID(), deviceId: first.body.device.id}, logout = await f.request('/api/web/logout', {cookie: first.cookie, body});
  assert.equal(logout.status, 200); assert.deepEqual(logout.body, {loggedOut: true, revoked: true, deviceId: first.body.device.id});
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  assert.deepEqual((await f.request('/api/web/logout', {cookie: first.cookie, body})).body, logout.body);
  assert.equal((await f.request('/api/web/logout', {body})).status, 200, 'lost clear-cookie acknowledgement remains recoverable');
  assert.equal((await f.request('/api/state', {cookie: first.cookie})).status, 401);
  assert.equal((await f.request('/api/state', {cookie: second.cookie})).status, 200);
  assert.equal((await f.request('/api/v1/state', {bearer: native.deviceToken, browser: false})).status, 200);
  await f.restart();
  assert.equal((await f.request('/api/state', {cookie: first.cookie})).status, 401);
  assert.equal((await f.request('/api/state', {cookie: second.cookie})).status, 200);
  assert.equal((await f.request('/api/v1/state', {bearer: native.deviceToken, browser: false})).status, 200);
});

test('logout never acknowledges or clears a cookie when persistence fails', async t => {
  const f = await fixture(t), login = await f.login(), body = {requestId: randomUUID()};
  const original = fs.fsyncSync;
  fs.fsyncSync = () => { throw new Error('Injected storage failure'); };
  let failed;
  try { failed = await f.request('/api/web/logout', {cookie: login.cookie, body}); }
  finally { fs.fsyncSync = original; }
  assert.equal(failed.status, 500); assert.equal(failed.headers.get('set-cookie'), null);
  const retried = await f.request('/api/web/logout', {cookie: login.cookie, body});
  assert.equal(retried.status, 200); assert.equal(retried.body.revoked, true);
  await f.restart();
  assert.equal((await f.request('/api/state', {cookie: login.cookie})).status, 401);
});

test('browser auth preserves encrypted backup schema and restored browsers are revoked', async t => {
  const f = await fixture(t), login = await f.login(), native = await f.native();
  const memory = {requestId: randomUUID(), text: 'Synthetic browser memory survives restoration'};
  const accepted = await f.request('/api/memory', {cookie: login.cookie, body: memory}); assert.equal(accepted.status, 201);
  const key = randomBytes(32), backup = await f.request('/api/backups/export', {bearer: OWNER, body: {encryptionKey: key.toString('hex')}});
  assert.equal(backup.status, 200);
  const decoded = decryptBackup(backup.bytes, key);
  assert.equal(decoded.state.memories.length, 1);
  for (const device of Object.values(decoded.state.devices)) assert.deepEqual(Object.keys(device), ['id', 'name', 'platform', 'tokenHash', 'createdAt', 'lastSeenAt', 'revokedAt']);
  assert.equal(JSON.stringify(decoded).includes(login.cookie.split('=')[1]), false);
  const targetDir = path.join(f.dir, 'restored'); restoreBackup({archive: backup.bytes, key, targetDir});
  // Use the same signer only in this isolated test so rejection proves restore
  // revocation rather than merely the effect of rotating the owner key.
  const restored = await start({dataDir: targetDir, token: OWNER, env: {}, port: 0});
  t.after(() => restored.shutdown());
  const base = `http://127.0.0.1:${restored.server.address().port}`;
  assert.equal((await fetch(base + '/api/state', {headers: {Cookie: login.cookie, 'X-Yeno-Browser': '1'}})).status, 401);
  assert.equal((await fetch(base + '/api/v1/state', {headers: {Authorization: `Bearer ${native.deviceToken}`}})).status, 401);
  assert.equal(restored.state().emergencyStop, true); assert.equal(restored.state().memories[0].text, memory.text);
  restored.shutdown();
});

test('login rate limiting is bounded, expires, and never enrolls for invalid credentials', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 10; i++) assert.equal((await f.login(undefined, {bearer: 'incorrect-owner'})).status, 401);
  const blocked = await f.login(); assert.equal(blocked.status, 429); assert.equal(Number(blocked.headers.get('retry-after')) > 0, true);
  assert.equal((await f.request('/api/devices', {bearer: OWNER})).body.devices.length, 0);
  f.advance(5 * 60 * 1000 + 1);
  assert.equal((await f.login()).status, 201);
});
