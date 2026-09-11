import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { start } from '../server.mjs';
import { openStore, digest } from '../lib/store.mjs';
import { exportBackup, restoreBackup } from '../lib/backup.mjs';
import { WORLD_FEED, WORLD_MAX_BYTES, parseWorldFeed, fetchWorldSnapshot, validateWorldSnapshot, worldOverview } from '../lib/world.mjs';

const TOKEN = 'synthetic-world-test-pairing-key';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function feed(count = 2, at = Date.now()) {
  return { type: 'FeatureCollection', metadata: { generated: at, count, status: 200 }, features: Array.from({ length: count }, (_, i) => ({ type: 'Feature', id: `test${i}`, properties: { type: 'earthquake', mag: 3 + i / 100, place: `Test location ${i}`, time: at - (i + 1) * 1000, updated: at, status: 'reviewed', url: 'http://localhost/private' }, geometry: { type: 'Point', coordinates: [128, 37, 10] } })) };
}
const response = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
async function eventually(read, predicate) { for (let i = 0; i < 150; i++) { const v = read(); if (predicate(v)) return v; await delay(30); } assert.fail('world condition timed out'); }
async function fixture(t, worldFetch) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-world-'));
  let runtime = await start({ dataDir: dir, token: TOKEN, port: 0, env: {}, worldFetch });
  t.after(() => { runtime.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); });
  const api = async (route, body, token = TOKEN) => {
    const r = await fetch(`http://127.0.0.1:${runtime.server.address().port}${route}`, { headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
    const raw = await r.text(); let value; try { value = JSON.parse(raw); } catch { value = raw; }
    return { status: r.status, body: value, headers: r.headers };
  };
  return { dir, api, get runtime() { return runtime; }, async restart() { runtime.shutdown(); runtime = await start({ dataDir: dir, token: TOKEN, port: 0, env: {}, worldFetch }); }, job: id => runtime.state().jobs.find(j => j.id === id), queue: () => api('/api/commands', { text: '세계 현황', requestId: randomUUID() }) };
}

test('world feed validates bounded events, omits unsupported rows and does not trust supplied links', async () => {
  const at = Date.now(), raw = feed(105, at); raw.features[0].geometry.coordinates[0] = 181;
  const snapshot = parseWorldFeed(Buffer.from(JSON.stringify(raw)), at);
  assert.equal(snapshot.events.length, 100); assert.equal(snapshot.invalidCount, 1); assert.equal(snapshot.omittedCount, 4);
  assert.equal(snapshot.events[0].url, 'https://earthquake.usgs.gov/earthquakes/eventpage/test1');
  assert.equal(parseWorldFeed(Buffer.from(JSON.stringify(feed(0, at))), at).events.length, 0);
  assert.throws(() => parseWorldFeed(Buffer.alloc(WORLD_MAX_BYTES + 1), at));
  assert.throws(() => parseWorldFeed(Buffer.from(JSON.stringify(feed(1, at + 600_000))), at));
  const bad = structuredClone(snapshot); bad.events[0].url = 'https://evil.example/'; assert.throws(() => validateWorldSnapshot(bad));
  const missing = feed(1, at); delete missing.features[0].id; assert.throws(() => parseWorldFeed(Buffer.from(JSON.stringify(missing)), at));
  await assert.rejects(fetchWorldSnapshot({ fetchImpl: async () => new Response('<html/>', { headers: { 'content-type': 'text/html' } }) }));
  await assert.rejects(fetchWorldSnapshot({ timeoutMs: 15, fetchImpl: async (_, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('timeout')))) }));
  const signal = AbortSignal.abort(); let called = 0;
  await assert.rejects(fetchWorldSnapshot({ signal, fetchImpl: async () => { called++; return response(feed()); } }));
  assert.equal(called, 0);
});

test('world command produces durable evidence, caches without lying about time and survives backup restore', async t => {
  let calls = 0;
  const f = await fixture(t, async (url, options) => { assert.equal(url, WORLD_FEED); assert.equal(options.redirect, 'error'); assert.deepEqual(Object.keys(options.headers), ['Accept']); calls++; return response(feed()); });
  assert.equal((await f.api('/api/world', undefined, '')).status, 401);
  const request = { text: '세계 현황', requestId: randomUUID() };
  const accepted = await f.api('/api/commands', request); assert.equal(accepted.status, 201);
  const job = await eventually(() => f.job(accepted.body.job.id), j => j.status === 'completed');
  assert.equal(job.type, 'world'); assert.equal(job.worldSnapshot, undefined);
  const report = await f.api(`/api/artifacts/${job.artifacts[0].id}`); assert.match(report.body, /USGS/); assert.equal(digest(report.body), report.headers.get('x-content-sha256'));
  const first = await f.api('/api/world'); assert.equal(first.body.snapshot.events.length, 2); assert.equal(calls, 1);
  assert.equal((await f.api('/api/commands', request)).body.job.id, job.id);
  const again = await f.queue(); await eventually(() => f.job(again.body.job.id), j => j.status === 'completed');
  assert.equal(calls, 1); assert.deepEqual((await f.api('/api/world')).body.snapshot, first.body.snapshot);
  await f.restart(); assert.deepEqual((await f.api('/api/world')).body.snapshot, first.body.snapshot);
  const future = worldOverview(openStore(f.dir).state.jobs, Date.parse(first.body.snapshot.generatedAt) + 901_000); assert.equal(future.stale, true);
  const key = randomBytes(32), targetDir = path.join(f.dir, 'restored');
  const archive = exportBackup({ state: openStore(f.dir).state, dataDir: f.dir, key });
  restoreBackup({ archive, key, targetDir });
  const restored = openStore(targetDir).state; assert.equal(restored.emergencyStop, true); assert.deepEqual(restored.jobs.find(j => j.id === job.id).worldSnapshot, first.body.snapshot);
  const view = await f.api('/world-view.mjs'); assert.equal(view.status, 200);
});

test('world pause aborts external reading; late results cannot finish a stopped job', async t => {
  let release, requestedSignal, calls = 0;
  const f = await fixture(t, async (_, { signal }) => { calls++; requestedSignal = signal; if (calls === 1) await new Promise(resolve => { release = resolve; }); return response(feed()); });
  const reply = await f.queue(); const id = reply.body.job.id;
  await eventually(() => release, Boolean);
  assert.equal((await f.api('/api/control', { action: 'stop', requestId: randomUUID() })).status, 200);
  assert.equal(requestedSignal.aborted, true); release(); await delay(100);
  assert.equal(f.job(id).status, 'paused'); assert.equal(f.job(id).artifacts.length, 0); assert.equal((await f.api('/api/world')).body.snapshot, null);
  assert.equal((await f.queue()).status, 409);
  await f.api('/api/control', { action: 'resume', requestId: randomUUID() });
  const paused = f.job(id); await f.api(`/api/jobs/${id}/action`, { action: 'resume', revision: paused.version, requestId: randomUUID() });
  await eventually(() => f.job(id), j => j.status === 'completed'); assert.equal(calls, 2); assert.equal(f.job(id).artifacts.length, 1);
});
