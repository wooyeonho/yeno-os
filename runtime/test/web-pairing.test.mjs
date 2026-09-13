import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {request as httpRequest} from 'node:http';
import {randomUUID} from 'node:crypto';
import {start} from '../server.mjs';
import {createWebPairings} from '../lib/web-pairing.mjs';

const OWNER = 'synthetic-owner-for-device-pairing-tests';
const ROUTE = '/api/web/pairing';
async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-device-connect-'));
  let time = Date.now(), core;
  const boot = async () => { core = await start({dataDir: dir, port: 0, token: OWNER, env: {YENO_ALLOWED_HOSTS: 'pairing.example.test'}, webSessionNow: () => time}); };
  await boot();
  t.after(() => {core.shutdown(); fs.rmSync(dir, {recursive: true, force: true});});
  const origin = () => `http://127.0.0.1:${core.server.address().port}`;
  async function request(route, {body, cookie, bearer, browser = true, headers = {}} = {}) {
    const outgoing = {...(browser ? {'X-Yeno-Browser': '1'} : {}), ...(body === undefined ? {} : {'Content-Type': 'application/json', Origin: origin()}), ...(cookie ? {Cookie: cookie} : {}), ...(bearer ? {Authorization: `Bearer ${bearer}`} : {}), ...headers};
    for (const key of Object.keys(outgoing)) if (outgoing[key] === null) delete outgoing[key];
    const response = await fetch(origin() + route, {method: body === undefined ? 'GET' : 'POST', headers: outgoing, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
    const value = await response.json();
    return {status: response.status, body: value, headers: response.headers, cookie: response.headers.get('set-cookie')?.split(';')[0] ?? ''};
  }
  const begin = (remember = true, cookie) => request(ROUTE, {body: {remember}, cookie});
  const approve = id => request(ROUTE + '/approve', {body: {requestId: id}, bearer: OWNER, browser: false});
  const devices = async () => (await request('/api/devices', {bearer: OWNER})).body.devices;
  return {dir, origin, request, begin, approve, devices, advance: ms => {time += ms;}, restart: async () => {core.shutdown(); await boot();}};
}

test('public reference grants no access; proof-bound approval opens ordinary session without returning credentials', async t => {
  const f = await fixture(t), started = await f.begin();
  assert.equal(started.status, 201); assert.equal(started.body.status, 'pending');
  assert.deepEqual(Object.keys(started.body), ['id', 'status', 'expiresAt', 'remember']);
  assert.match(started.body.id, /^[a-f0-9-]{36}$/);
  assert.match(started.headers.get('set-cookie'), /Path=\/; HttpOnly; SameSite=Strict; Max-Age=600/);
  assert.equal((await f.devices()).length, 0);
  assert.equal((await f.request(ROUTE)).status, 401);
  assert.equal((await f.request(ROUTE, {cookie: `yeno-pair-dev-v1=${started.body.id}.${'a'.repeat(43)}`})).status, 401);
  assert.equal((await f.request('/api/state', {cookie: started.cookie})).status, 401);
  assert.equal((await f.request(ROUTE, {cookie: started.cookie})).body.status, 'pending');
  const approval = await f.approve(started.body.id);
  assert.equal(approval.status, 200); assert.equal(approval.body.status, 'approved'); assert.equal(approval.cookie, '');
  assert.equal((await f.request(ROUTE, {cookie: `yeno-pair-dev-v1=${started.body.id}.${'a'.repeat(43)}`})).status, 401);
  const collected = await f.request(ROUTE, {cookie: started.cookie});
  assert.equal(collected.status, 200); assert.equal(collected.body.authenticated, true);
  assert.equal(collected.body.device.platform, 'web'); assert.equal((await f.devices()).length, 1);
  assert.match(collected.cookie, /^yeno-web-dev-v1=/);
  assert.equal((await f.request('/api/web/session', {cookie: collected.cookie})).body.device.id, collected.body.device.id);
  assert.equal((await f.request('/api/state', {cookie: collected.cookie})).status, 200);
  assert.doesNotMatch(JSON.stringify([started.body, approval.body, collected.body]), /deviceToken|tokenHash|proof|Bearer|synthetic-owner/);
  const disk = fs.readFileSync(path.join(f.dir, 'state.json'), 'utf8');
  for (const credential of [OWNER, started.cookie.split('=')[1], collected.cookie.split('=')[1]]) assert.equal(disk.includes(credential), false);
});

test('refresh preserves the same proof, request identity and duration without spending creation limit', async t => {
  const f = await fixture(t), first = await f.begin(false);
  for (let index = 0; index < 15; index++) {
    const repeated = await f.begin(true, first.cookie);
    assert.equal(repeated.status, 200); assert.deepEqual(repeated.body, first.body); assert.equal(repeated.cookie, first.cookie);
  }
  await f.approve(first.body.id);
  const collected = await f.request(ROUTE, {cookie: first.cookie});
  assert.doesNotMatch(collected.headers.get('set-cookie'), /Max-Age|Expires=/);
  assert.equal(Date.parse(collected.body.expiresAt) - Date.parse(collected.body.device.createdAt), 8 * 60 * 60 * 1000);
  assert.equal((await f.devices()).length, 1);
});

test('lost approval and cookie replies replay one durable device and cannot revive a revoked enrollment', async t => {
  const f = await fixture(t), started = await f.begin();
  await f.approve(started.body.id); // Deliberately discard the response.
  const retry = await f.approve(started.body.id);
  assert.equal(retry.status, 200); assert.equal((await f.devices()).length, 1);
  const lost = await f.request(ROUTE, {cookie: started.cookie});
  const repeated = await f.request(ROUTE, {cookie: started.cookie});
  assert.equal(repeated.cookie, lost.cookie); assert.deepEqual(repeated.body, lost.body);
  const revoked = await f.request(`/api/devices/${lost.body.device.id}/revoke`, {body: {requestId: randomUUID()}, bearer: OWNER});
  assert.equal(revoked.status, 200);
  const oldProof = await f.request(ROUTE, {cookie: started.cookie});
  assert.equal(oldProof.status, 409); assert.equal(oldProof.body.code, 'WEB_PAIRING_REVOKED');
  assert.match(oldProof.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await f.approve(started.body.id)).status, 409);
  assert.equal((await f.request('/api/state', {cookie: lost.cookie})).status, 401);
  assert.equal((await f.devices()).length, 1);
  const fresh = await f.begin(); assert.notEqual(fresh.body.id, started.body.id); assert.equal(fresh.body.status, 'pending');
});

test('owner approval cannot be performed with missing, wrong, native or browser credentials', async t => {
  const f = await fixture(t), started = await f.begin();
  const native = await f.request('/api/v1/devices/enroll', {body: {requestId: randomUUID(), name: 'Preserved native', platform: 'android'}, bearer: OWNER});
  assert.equal(native.status, 201);
  for (const options of [{}, {bearer: 'wrong-owner-token'}, {bearer: native.body.device.deviceToken}, {cookie: started.cookie}]) {
    assert.equal((await f.request(ROUTE + '/approve', {body: {requestId: started.body.id}, ...options})).status, 401);
  }
  assert.equal((await f.devices()).length, 1);
  assert.equal((await f.request(ROUTE + '/approve', {body: {requestId: started.body.id, deviceId: native.body.device.id}, bearer: OWNER})).status, 400);
  await f.approve(started.body.id);
  const session = await f.request(ROUTE, {cookie: started.cookie});
  assert.equal((await f.request(ROUTE + '/approve', {body: {requestId: started.body.id}, cookie: session.cookie})).status, 401);
  assert.equal((await f.request('/api/devices', {cookie: session.cookie})).status, 403);
  assert.equal((await f.request('/api/backups/export', {body: {encryptionKey: '0'.repeat(64)}, cookie: session.cookie})).status, 403);
  assert.equal((await f.request('/api/v1/state', {cookie: session.cookie})).status, 401);
  assert.equal((await f.request('/api/v1/state', {bearer: native.body.device.deviceToken})).status, 200);
});

test('CSRF and host boundaries protect creation and collection; public-host proof is Secure and host-only', async t => {
  const f = await fixture(t);
  for (const headers of [{Origin: null}, {Origin: 'https://attacker.example'}, {'X-Yeno-Browser': null}]) assert.equal((await f.request(ROUTE, {body: {remember: true}, headers})).status, 403);
  assert.equal((await f.request(ROUTE, {body: {remember: true}, headers: {'Content-Type': 'text/plain'}})).status, 415);
  const started = await f.begin();
  assert.equal((await f.request(ROUTE, {cookie: started.cookie, browser: false})).status, 403);
  assert.equal((await f.request(ROUTE, {cookie: started.cookie, headers: {Origin: 'https://attacker.example'}})).status, 403);
  assert.equal((await f.request(ROUTE, {cookie: started.cookie + '; ' + started.cookie})).status, 401);
  // node:fetch replaces a custom Host on this runtime; use the HTTP transport
  // to exercise the same headers presented by the production TLS terminator.
  const publicStart = await new Promise((resolve, reject) => {
    const req = httpRequest(f.origin() + ROUTE, {method: 'POST', headers: {Host: 'pairing.example.test', Origin: 'https://pairing.example.test', 'X-Yeno-Browser': '1', 'Content-Type': 'application/json'}}, res => {
      res.resume(); res.on('end', () => resolve({status: res.statusCode, cookie: res.headers['set-cookie']?.[0]}));
    }); req.on('error', reject); req.end(JSON.stringify({remember: true}));
  });
  assert.equal(publicStart.status, 201); assert.match(publicStart.cookie, /^__Host-yeno-pair-v1=.*; Path=\/; HttpOnly; SameSite=Strict; Secure;/);
  assert.doesNotMatch(publicStart.cookie, /Domain=/);
});

test('expiry and restart fail closed; established sessions and records survive restart', async t => {
  const f = await fixture(t), expired = await f.begin();
  f.advance(10 * 60 * 1000 + 1);
  assert.equal((await f.request(ROUTE, {cookie: expired.cookie})).status, 410);
  assert.equal((await f.approve(expired.body.id)).status, 410);
  const fresh = await f.begin(true, expired.cookie); assert.notEqual(fresh.body.id, expired.body.id);
  await f.approve(fresh.body.id);
  const session = await f.request(ROUTE, {cookie: fresh.cookie});
  const abandoned = await f.begin();
  await f.restart();
  assert.equal((await f.request(ROUTE, {cookie: fresh.cookie})).status, 401);
  assert.equal((await f.request(ROUTE, {cookie: abandoned.cookie})).status, 401);
  assert.equal((await f.approve(fresh.body.id)).status, 410);
  assert.equal((await f.approve(abandoned.body.id)).status, 410);
  assert.equal((await f.request('/api/web/session', {cookie: session.cookie})).body.device.id, session.body.device.id);
  assert.equal((await f.devices()).length, 1);
});

test('logout revocation also blocks an unexpired pairing proof from issuing another session', async t => {
  const f = await fixture(t), started = await f.begin(); await f.approve(started.body.id);
  const session = await f.request(ROUTE, {cookie: started.cookie});
  const logout = await f.request('/api/web/logout', {body: {requestId: randomUUID(), deviceId: session.body.device.id}, cookie: session.cookie});
  assert.equal(logout.status, 200);
  assert.equal((await f.request(ROUTE, {cookie: started.cookie})).status, 409);
  assert.equal((await f.approve(started.body.id)).status, 409);
  assert.equal((await f.devices()).filter(device => !device.revokedAt).length, 0);
});

test('only new requests consume bounded creation capacity, recovered after expiry', () => {
  let time = Date.now(); const pairs = createWebPairings({now: () => time, capacity: 2});
  const req = {headers: {host: 'localhost'}, socket: {remoteAddress: 'test'}};
  const first = pairs.begin(req, true); pairs.begin(req, false);
  const linked = {...req, headers: {...req.headers, cookie: first.cookie.split(';')[0]}};
  assert.equal(pairs.begin(linked, false).entry.id, first.entry.id);
  assert.throws(() => pairs.begin(req, true), error => error.status === 429);
  time += 600001;
  assert.notEqual(pairs.begin(req, true).entry.id, first.entry.id);
});
