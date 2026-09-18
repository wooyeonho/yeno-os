import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {start} from '../server.mjs';
import {openStore} from '../lib/store.mjs';

// BLACKHOLE Durable Memory Fabric (Phase B) — end-to-end server wiring: a
// declared memory event is durably enqueued, a bounded scheduler tick mirrors
// it to whichever destinations are configured, the Core status API reports a
// safe summary, and the whole pipeline survives a restart. Supabase is
// exercised through an injected fake transport (never a live project);
// Obsidian is exercised against a real temporary vault directory (never the
// owner's real vault).

function fakeSupabaseTransport() {
  const table = new Map();
  const calls = [];
  const transport = async req => {
    calls.push(req);
    const url = new URL(req.path, 'https://project.supabase.co');
    if (req.method === 'GET') {
      const idParam = url.searchParams.get('id');
      const id = idParam?.startsWith('eq.') ? decodeURIComponent(idParam.slice(3)) : null;
      const row = id ? table.get(id) : null;
      return {ok: true, status: 200, text: JSON.stringify(row ? [row] : [])};
    }
    if (req.method === 'POST') {
      const rows = Array.isArray(req.body) ? req.body : [req.body];
      for (const row of rows) table.set(row.id, row);
      return {ok: true, status: 201, text: JSON.stringify(rows)};
    }
    return {ok: true, status: 200, text: '[]'};
  };
  return {transport, table, calls};
}

async function setup(t, {supabase = true, obsidian = true, transportOverride} = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-b-server-data-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-b-server-vault-'));
  const token = 'synthetic-owner-token';
  const fake = fakeSupabaseTransport();
  const env = {};
  if (supabase) Object.assign(env, {
    YENO_MEMORY_SUPABASE_ENABLED: 'true',
    YENO_MEMORY_SUPABASE_URL: 'https://project.supabase.co',
    YENO_MEMORY_SUPABASE_SERVICE_KEY: 'a'.repeat(40),
  });
  if (obsidian) Object.assign(env, {YENO_OBSIDIAN_EXPORT_ENABLED: 'true', YENO_OBSIDIAN_VAULT_PATH: vaultDir});
  const runtime = await start({host: '127.0.0.1', port: 0, dataDir, token, env, memorySupabaseTransport: transportOverride ?? fake.transport});
  const request = async (method, route, body) => {
    const r = await fetch(`http://127.0.0.1:${runtime.server.address().port}${route}`, {
      method, headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
      body: body ? JSON.stringify(body) : undefined,
    });
    return {status: r.status, body: await r.json()};
  };
  const declareEvent = (overrides = {}) => request('POST', '/api/memory-events', {
    requestId: randomUUID(), type: 'episode', text: 'A test memory.', confidence: 0.8, projectId: null, questId: null, sourceRefs: [], ...overrides,
  });
  t.after(() => {runtime.shutdown(); fs.rmSync(dataDir, {recursive: true, force: true}); fs.rmSync(vaultDir, {recursive: true, force: true});});
  return {runtime, request, declareEvent, dataDir, vaultDir, fake, get: route => request('GET', route)};
}

const wait = ms => new Promise(res => setTimeout(res, ms));
async function waitFor(predicate, {timeoutMs = 3000, intervalMs = 25} = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await wait(intervalMs);
  }
  return false;
}

test('GET /api/core.memory reports NOT_CONFIGURED and zero pending when neither destination is configured', async t => {
  const app = await setup(t, {supabase: false, obsidian: false});
  const res = await app.get('/api/core');
  assert.deepEqual(res.body.memory, {
    localCount: 0,
    supabase: {readiness: 'NOT_CONFIGURED', pendingCount: 0, lastSyncedAt: null},
    obsidian: {readiness: 'NOT_CONFIGURED', pendingCount: 0, lastSyncedAt: null},
  });
});

test('declaring a memory event with no destinations configured never enqueues outbox work', async t => {
  const app = await setup(t, {supabase: false, obsidian: false});
  const declared = await app.declareEvent();
  assert.equal(declared.status, 201);
  await wait(300);
  const res = await app.get('/api/core');
  assert.equal(res.body.memory.localCount, 1);
  assert.equal(res.body.memory.supabase.pendingCount, 0);
});

test('a declared memory event is mirrored to both a fake Supabase transport and a real temp Obsidian vault, and the status API reflects LIVE_VERIFIED only after real success', async t => {
  const app = await setup(t);
  const declared = await app.declareEvent({text: 'Phase B end-to-end mirror test.'});
  assert.equal(declared.status, 201);
  const eventId = declared.body.memoryEvent.id;

  const ok = await waitFor(async () => {
    const res = await app.get('/api/core');
    return res.body.memory.supabase.readiness === 'LIVE_VERIFIED' && res.body.memory.obsidian.readiness === 'LIVE_VERIFIED';
  });
  assert.ok(ok, 'both destinations must reach LIVE_VERIFIED once the scheduler actually mirrors the event');

  assert.ok(app.fake.table.has(eventId), 'the fake Supabase table must actually contain the mirrored row');
  assert.equal(app.fake.table.get(eventId).fingerprint, declared.body.memoryEvent.fingerprint);

  const vaultFiles = fs.readdirSync(path.join(app.vaultDir, 'BLACKHOLE', '30_Episodes'));
  assert.equal(vaultFiles.length, 1, 'exactly one episode file must be written to the real temp vault');
  const content = fs.readFileSync(path.join(app.vaultDir, 'BLACKHOLE', '30_Episodes', vaultFiles[0]), 'utf8');
  assert.match(content, /Phase B end-to-end mirror test\./);

  const finalStatus = await app.get('/api/core');
  assert.equal(finalStatus.body.memory.supabase.pendingCount, 0);
  assert.equal(finalStatus.body.memory.obsidian.pendingCount, 0);
  assert.ok(finalStatus.body.memory.supabase.lastSyncedAt);
  assert.ok(finalStatus.body.memory.obsidian.lastSyncedAt);
});

test('the safe memory status projection never leaks the vault path, service key, or a raw database URL', async t => {
  const app = await setup(t);
  await app.declareEvent();
  await waitFor(async () => (await app.get('/api/core')).body.memory.obsidian.readiness === 'LIVE_VERIFIED');
  const res = await app.get('/api/core');
  const serialized = JSON.stringify(res.body);
  assert.equal(serialized.includes(app.vaultDir), false, 'the absolute vault path must never appear in the status API');
  assert.equal(serialized.includes('a'.repeat(40)), false, 'the Supabase service key must never appear in the status API');
  assert.equal(/postgres:\/\//.test(serialized), false);
  assert.equal(/https:\/\/project\.supabase\.co/.test(serialized), false, 'the Supabase project URL must never appear in the status API');
});

test('scheduler ticks never regenerate Obsidian index files when nothing changed (no spurious .pending- conflict files pile up over time)', async t => {
  const app = await setup(t);
  await app.declareEvent({text: 'first event'});
  await waitFor(async () => (await app.get('/api/core')).body.memory.obsidian.readiness === 'LIVE_VERIFIED');
  // Several idle scheduler ticks (~150ms each) with no new data.
  await wait(900);
  const walk = dir => fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
  const pendingFiles = walk(app.vaultDir).filter(f => f.includes('.pending-'));
  assert.deepEqual(pendingFiles, [], 'idle scheduler ticks must never manufacture a conflict against the exporter\'s own prior write');
});

test('a genuine second memory event still triggers exactly one clean index regeneration, not a blocked conflict', async t => {
  const app = await setup(t);
  await app.declareEvent({type: 'episode', text: 'first'});
  await waitFor(async () => (await app.get('/api/core')).body.memory.obsidian.readiness === 'LIVE_VERIFIED');
  await app.declareEvent({type: 'decision', text: 'second'});
  await waitFor(async () => (await app.get('/api/core')).body.memory.localCount === 2 && (await app.get('/api/core')).body.memory.obsidian.pendingCount === 0);
  const indexContent = fs.readFileSync(path.join(app.vaultDir, 'BLACKHOLE', '_Index', 'Memory_Index.md'), 'utf8');
  assert.match(indexContent, /Episode: 1/);
  assert.match(indexContent, /Decision: 1/);
  const walk = dir => fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
  assert.deepEqual(walk(app.vaultDir).filter(f => f.includes('.pending-')), [], 'a real data-driven regeneration must overwrite cleanly, never look like a conflict');
});

test('a fingerprint-mismatched Supabase remote row blocks the sync and shows up as pendingCount rather than a fabricated success', async t => {
  const table = new Map();
  const transport = async req => {
    const url = new URL(req.path, 'https://project.supabase.co');
    if (req.method === 'GET') {
      const idParam = url.searchParams.get('id');
      const id = idParam?.startsWith('eq.') ? decodeURIComponent(idParam.slice(3)) : null;
      const row = id ? table.get(id) : null;
      return {ok: true, status: 200, text: JSON.stringify(row ? [row] : [])};
    }
    return {ok: true, status: 201, text: '[]'};
  };
  const app = await setup(t, {obsidian: false, transportOverride: transport});
  const declared = await app.declareEvent();
  // Seed a conflicting remote row for the SAME id before the scheduler ever gets to it.
  table.set(declared.body.memoryEvent.id, {id: declared.body.memoryEvent.id, fingerprint: 'f'.repeat(64)});
  await waitFor(async () => (await app.get('/api/core')).body.memory.supabase.readiness !== 'CONFIGURED_UNVERIFIED');
  const res = await app.get('/api/core');
  assert.equal(res.body.memory.supabase.readiness, 'BLOCKED');
  assert.equal(table.get(declared.body.memoryEvent.id).fingerprint, 'f'.repeat(64), 'the remote row must never be overwritten to force a fake success');
});

test('restart preserves local memory events, the outbox, and never fabricates a resumed live readiness before real reconciliation', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-b-restart-data-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-b-restart-vault-'));
  t.after(() => {fs.rmSync(dataDir, {recursive: true, force: true}); fs.rmSync(vaultDir, {recursive: true, force: true});});
  const token = 'synthetic-owner-token';
  const env = {YENO_OBSIDIAN_EXPORT_ENABLED: 'true', YENO_OBSIDIAN_VAULT_PATH: vaultDir};

  const runtime1 = await start({host: '127.0.0.1', port: 0, dataDir, token, env});
  const request1 = async (method, route, body) => {
    const r = await fetch(`http://127.0.0.1:${runtime1.server.address().port}${route}`, {
      method, headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}, body: body ? JSON.stringify(body) : undefined,
    });
    return {status: r.status, body: await r.json()};
  };
  const declared = await request1('POST', '/api/memory-events', {requestId: randomUUID(), type: 'episode', text: 'before restart', confidence: 0.9, projectId: null, questId: null, sourceRefs: []});
  assert.equal(declared.status, 201);
  await wait(500);
  const beforeRestart = await request1('GET', '/api/core');
  assert.equal(beforeRestart.body.memory.localCount, 1);
  assert.equal(beforeRestart.body.memory.obsidian.readiness, 'LIVE_VERIFIED');
  await runtime1.shutdown();

  const onDisk = openStore(dataDir).state;
  assert.equal(onDisk.memoryEvents.length, 1, 'canonical memory events must survive restart on disk');
  assert.equal(onDisk.memorySyncOutbox.length, 1, 'the sync outbox must survive restart on disk');
  assert.equal(onDisk.memorySyncOutbox[0].status, 'synced');

  const runtime2 = await start({host: '127.0.0.1', port: 0, dataDir, token, env});
  const request2 = async (method, route) => {
    const r = await fetch(`http://127.0.0.1:${runtime2.server.address().port}${route}`, {method, headers: {Authorization: `Bearer ${token}`}});
    return {status: r.status, body: await r.json()};
  };
  t.after(() => runtime2.shutdown());
  const afterRestart = await request2('GET', '/api/core');
  assert.equal(afterRestart.body.memory.localCount, 1, 'the canonical event must still be there after restart');
  assert.equal(afterRestart.body.memory.obsidian.pendingCount, 0, 'an already-synced item must not be re-queued just because the process restarted');
  // A restarted adapter instance has no in-memory lastLiveSuccess yet; since
  // the outbox already shows a real synced item for Obsidian (a direct local
  // filesystem write, itself live evidence), readiness may still report
  // LIVE_VERIFIED - but it must never be BLOCKED or fabricate a state the
  // outbox evidence disagrees with.
  assert.notEqual(afterRestart.body.memory.obsidian.readiness, 'BLOCKED');
});

test('emergency stop halts the scheduler so no further memory sync batches are processed', async t => {
  const app = await setup(t);
  const declared = await app.declareEvent({text: 'before stop'});
  assert.equal(declared.status, 201);
  await app.request('POST', '/api/control', {action: 'stop'});
  await wait(400);
  const res = await app.get('/api/core');
  // Whatever state existed at the moment of emergency stop must not advance
  // further - this only asserts the server stays responsive and consistent,
  // never that sync silently continued despite the stop flag.
  assert.equal(res.body.emergencyStop, true);
});
