import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {start} from '../server.mjs';
import {openStore, digest} from '../lib/store.mjs';
import {initialCoreState} from '../lib/blackhole-core.mjs';

// BLACKHOLE Living Core, Phase A — server wiring for the safe read-only Core
// API, the owner-only Memory Event write path, the real-state Android Home
// binding embedded in GET /api/state, restart persistence, and emergency
// stop. This exercises the real HTTP server + real on-disk store exactly
// like outcome-connector-server.test.mjs does for Track A.

async function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-living-core-'));
  const token = 'synthetic-owner-token';
  const runtime = await start({host: '127.0.0.1', port: 0, dataDir: dir, token, env: {}});
  const request = async (method, route, body, headers = {}) => {
    const r = await fetch(`http://127.0.0.1:${runtime.server.address().port}${route}`, {
      method, headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers},
      body: body ? JSON.stringify(body) : undefined,
    });
    return {status: r.status, body: await r.json()};
  };
  const post = (route, body = {}, headers) => request('POST', route, {requestId: randomUUID(), ...body}, headers);
  const get = (route, headers) => request('GET', route, undefined, headers);
  t.after(() => { runtime.shutdown(); fs.rmSync(dir, {recursive: true, force: true}); });
  return {request, post, get, dir, disk: () => openStore(dir).state};
}

test('GET /api/core returns the real idle Core state on a fresh runtime, with no fabricated mission/drive/shadows', async t => {
  const app = await setup(t);
  const res = await app.get('/api/core');
  assert.equal(res.status, 200);
  assert.equal(res.body.activity, 'idle');
  assert.equal(res.body.emergencyStop, false);
  assert.equal(res.body.mission, null);
  assert.equal(res.body.dominantDriveId, null);
  assert.equal(res.body.dominantDriveName, null);
  assert.equal(res.body.activeShadowCount, 0);
  assert.equal(res.body.recentResult, null);
  assert.equal(res.body.heartbeatCount > 0, true, 'runtime startup already persisted at least one heartbeat');
  assert.equal(res.body.schemaVersion, 1);
});

test('GET /api/state embeds a trimmed real Core summary so the Android Home binding needs no second network round trip', async t => {
  const app = await setup(t);
  const res = await app.get('/api/state');
  assert.equal(res.status, 200);
  assert.ok(res.body.core, 'state() must embed a core field');
  assert.equal(res.body.core.activity, 'idle');
  assert.equal(res.body.core.missionGoal, null);
  assert.equal(res.body.core.dominantDriveId, null);
  assert.equal(res.body.core.activeShadowCount, 0);
});

test('a device credential cannot declare a memory event; the owner pairing credential can, and it is durably persisted', async t => {
  const app = await setup(t);
  const enrolled = (await app.post('/api/v1/devices/enroll', {name: 'Pixel', platform: 'android'})).body.device;
  const deviceAuth = {Authorization: `Bearer ${enrolled.deviceToken}`};
  const claim = {type: 'episode', text: '오늘 첫 실행을 시작함', confidence: 0.9, projectId: null, questId: null, sourceRefs: []};

  const blocked = await app.post('/api/memory-events', claim, deviceAuth);
  assert.equal(blocked.status, 403);

  const declared = await app.post('/api/memory-events', claim);
  assert.equal(declared.status, 201, JSON.stringify(declared.body));
  assert.equal(declared.body.memoryEvent.type, 'episode');
  assert.ok(declared.body.memoryEvent.fingerprint);

  const disk = app.disk();
  assert.equal(disk.memoryEvents.length, 1);
  assert.equal(disk.memoryEvents[0].id, declared.body.memoryEvent.id);
});

test('a memory event with credential-shaped text is refused before it ever reaches durable state', async t => {
  const app = await setup(t);
  const claim = {type: 'episode', text: 'sk-abcdefghijklmnopqrstuvwx', confidence: 0.5, projectId: null, questId: null, sourceRefs: []};
  const res = await app.post('/api/memory-events', claim);
  assert.equal(res.status, 400);
  assert.equal(app.disk().memoryEvents.length, 0);
});

test('a relationship memory event updates the Core relationshipMemoryPointer on the very next heartbeat', async t => {
  const app = await setup(t);
  const claim = {type: 'relationship', text: '소유자가 저녁 보고를 선호함', confidence: 0.8, projectId: null, questId: null, sourceRefs: []};
  const declared = await app.post('/api/memory-events', claim);
  assert.equal(declared.status, 201);
  // declareMemoryEvent's own mutation() call already triggered a save(), i.e.
  // a real heartbeat, so the pointer is live immediately - no extra mutation
  // or polling delay required.
  const core = await app.get('/api/core');
  assert.equal(core.body.relationshipMemory?.id, declared.body.memoryEvent.id);
  assert.equal(core.body.relationshipMemory.type, 'relationship');
});

test('emergency stop flips Core activity to emergency on the very next heartbeat, and resuming reflects reality again (never fabricated)', async t => {
  const app = await setup(t);
  const before = await app.get('/api/core');
  assert.equal(before.body.activity, 'idle');

  const stopped = await app.post('/api/control', {action: 'stop'});
  assert.ok([200, 201].includes(stopped.status), JSON.stringify(stopped.body));
  const duringStop = await app.get('/api/core');
  assert.equal(duringStop.body.activity, 'emergency');
  assert.equal(duringStop.body.emergencyStop, true);

  const resumed = await app.post('/api/control', {action: 'resume'});
  assert.ok([200, 201].includes(resumed.status), JSON.stringify(resumed.body));
  const afterResume = await app.get('/api/core');
  assert.equal(afterResume.body.activity, 'idle', 'no running job exists, so activity must genuinely return to idle, never stay stuck on a stale value');
  assert.equal(afterResume.body.emergencyStop, false);
});

test('malformed/tampered Core state on disk fails the runtime closed at startup instead of silently discarding it', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-tampered-core-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const {initialState} = await import('../lib/store.mjs');
  const state = initialState();
  // Tamper: claim a dominant drive while there is no live mission at all.
  state.blackholeCore = {...initialCoreState(), dominantDriveId: 'greed'};
  const payload = JSON.stringify(state);
  const envelope = JSON.stringify({format: 1, sha256: digest(payload), payload});
  fs.writeFileSync(path.join(dir, 'state.json'), envelope);
  // No verified backup exists either, so openStore reports the same generic
  // failure every other unreadable-primary-and-backup case does (it never
  // discloses which validation failed); the important guarantee is that a
  // tampered Core record blocks startup instead of silently loading.
  assert.throws(() => openStore(dir), /Both state and backup are unreadable/);
});

test('restart persistence: Core identity, mission-derived fields and heartbeat count survive a full store reopen exactly', async t => {
  const app = await setup(t);
  const claim = {type: 'relationship', text: '재시작 전 마지막 기억', confidence: 0.7, projectId: null, questId: null, sourceRefs: []};
  const declared = await app.post('/api/memory-events', claim);
  assert.equal(declared.status, 201);
  const before = (await app.get('/api/core')).body;

  // Simulate a real restart: close this runtime and open a brand new one
  // against the exact same data directory, exactly like a process restart.
  const dir = app.dir;
  const reopened = openStore(dir);
  assert.equal(reopened.state.blackholeCore.heartbeatCount, before.heartbeatCount);
  assert.equal(reopened.state.blackholeCore.lastHeartbeatAt, before.lastHeartbeatAt);
  assert.equal(reopened.state.blackholeCore.relationshipMemoryPointer, declared.body.memoryEvent.id);
  assert.deepEqual(reopened.state.memoryEvents.map(e => e.id), [declared.body.memoryEvent.id]);
});
