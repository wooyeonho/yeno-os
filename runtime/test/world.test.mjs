import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { start } from '../server.mjs';
import { openStore, digest } from '../lib/store.mjs';
import { exportBackup, restoreBackup } from '../lib/backup.mjs';
import { WORLD_FEED, WORLD_HAZARD_FEED, WORLD_MAX_BYTES, parseWorldFeed, parseHazardFeed, fetchWorldSnapshot, validateWorldSnapshot, worldOverview, worldDocument } from '../lib/world.mjs';

const TOKEN = 'synthetic-world-test-pairing-key';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function feed(count = 2, at = Date.now()) {
  return { type: 'FeatureCollection', metadata: { generated: at, count, status: 200 }, features: Array.from({ length: count }, (_, i) => ({ type: 'Feature', id: `test${i}`, properties: { type: 'earthquake', mag: 3 + i / 100, place: `Test location ${i}`, time: at - (i + 1) * 1000, updated: at, status: 'reviewed', url: 'http://localhost/private' }, geometry: { type: 'Point', coordinates: [128, 37, 10] } })) };
}
const response = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
function hazards(at = Date.now(), count = 2) {
  return { title: 'EONET Events', events: Array.from({ length: count }, (_, i) => ({ id: `EONET_${i}`, title: `Test hazard ${i}`, closed: null, categories: [{ id: i % 2 ? 'severeStorms' : 'wildfires', title: 'ignored supplied title' }], link: 'https://evil.example/', geometry: [{ date: new Date(at - 86_400_000).toISOString(), type: 'Point', coordinates: [120, 30] }, { date: new Date(at - i * 1000).toISOString(), type: 'Point', coordinates: [128, 37] }] })) };
}
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

test('NASA hazard parsing preserves original point/time, bounds rows and never trusts external links', () => {
  const at = Date.now(), raw = hazards(at, 53);
  raw.events[0].geometry.at(-1).type = 'Polygon';
  raw.events[1].geometry.at(-1).coordinates = [181, 0];
  raw.events[2].title = '<script>alert(1)</script> wildfire';
  const snapshot = parseHazardFeed(Buffer.from(JSON.stringify(raw)), at);
  assert.equal(snapshot.events.length, 50);
  assert.equal(snapshot.invalidCount, 2);
  assert.equal(snapshot.omittedCount, 1);
  assert.deepEqual([snapshot.events[0].longitude, snapshot.events[0].latitude], [128, 37]);
  assert.equal(snapshot.events[0].url, 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_2');
  assert.equal(snapshot.latestEventAt, new Date(at - 2000).toISOString());
  assert.equal(snapshot.checkedAt, new Date(at).toISOString());
  assert.equal(Object.hasOwn(snapshot, 'generatedAt'), false);
  assert.equal(parseHazardFeed(Buffer.from(JSON.stringify(hazards(at, 0))), at).latestEventAt, null);
  assert.throws(() => parseHazardFeed(Buffer.alloc(WORLD_MAX_BYTES + 1), at));
  assert.throws(() => parseHazardFeed(Buffer.from('<rss/>'), at));
  const invalid = hazards(at, 1); invalid.events[0].geometry = [{ date: new Date(at + 600_000).toISOString(), type: 'Point', coordinates: [0, 0] }];
  assert.throws(() => parseHazardFeed(Buffer.from(JSON.stringify(invalid)), at));
});

test('combined source reads are isolated, preserve legacy injection and reject partial metadata corruption', async () => {
  const at = Date.now(), calls = [];
  const transport = async (url, options) => { calls.push(url); assert.equal(options.redirect, 'error'); return response(url === WORLD_FEED ? feed(1, at) : hazards(at)); };
  const legacy = await fetchWorldSnapshot({ fetchImpl: transport, clock: () => at });
  assert.equal(legacy.format, 1); assert.deepEqual(calls, [WORLD_FEED]);
  calls.length = 0;
  const combined = await fetchWorldSnapshot({ fetchImpl: transport, includeHazards: true, clock: () => at });
  assert.equal(combined.format, 2); assert.equal(combined.hazards.events.length, 2);
  assert.deepEqual(calls.sort(), [WORLD_FEED, WORLD_HAZARD_FEED].sort());
  assert.equal(validateWorldSnapshot(structuredClone(combined)).format, 2);
  const bad = structuredClone(combined); bad.hazards.events[0].url = 'https://evil.example/'; assert.throws(() => validateWorldSnapshot(bad));
  const wrongTime = structuredClone(combined); wrongTime.hazards.latestEventAt = new Date(at + 1000).toISOString(); assert.throws(() => validateWorldSnapshot(wrongTime));
  const wrongCounts = structuredClone(combined); wrongCounts.hazards.invalidCount++; assert.throws(() => validateWorldSnapshot(wrongCounts));
  assert.match(worldDocument(combined, at), /원자료 생성 시각: 제공되지 않음/);
  assert.match(worldDocument(combined, at), /NASA EONET/);
  const overview = worldOverview([{ id: 'x', type: 'world', status: 'completed', updatedAt: new Date(at).toISOString(), worldSnapshot: combined }], at + 901_000);
  assert.equal(overview.hazards.stale, true); assert.equal(overview.hazards.feedGeneratedAt, null);
});

test('one failed world source leaves the other usable; two failures keep prior results at the job boundary', async () => {
  const at = Date.now();
  for (const failedSource of [WORLD_FEED, WORLD_HAZARD_FEED]) {
    const snapshot = await fetchWorldSnapshot({ includeHazards: true, clock: () => at, fetchImpl: async url => {
      if (url === failedSource) throw new Error('private transport diagnostic must never persist');
      return response(url === WORLD_FEED ? feed(1, at) : hazards(at));
    } });
    assert.equal(snapshot.earthquakeError, failedSource === WORLD_FEED ? 'source_unavailable' : null);
    assert.equal(snapshot.hazards.status, failedSource === WORLD_HAZARD_FEED ? 'error' : 'ok');
    assert.equal(snapshot.generatedAt, failedSource === WORLD_FEED ? null : new Date(at).toISOString());
    assert.doesNotMatch(JSON.stringify(snapshot), /private transport/);
    assert.match(worldDocument(snapshot, at), /조회 실패/);
    assert.equal(validateWorldSnapshot(snapshot), snapshot);
  }
  await assert.rejects(fetchWorldSnapshot({ includeHazards: true, fetchImpl: async () => new Response('bad', { status: 503 }) }), /모두 실패/);
});

test('NASA JSON with observed RSS content type remains schema checked; timeouts and stop abort both sources', async () => {
  const at = Date.now();
  const snapshot = await fetchWorldSnapshot({ fetchImpl: async () => response(feed(1, at)), hazardFetchImpl: async () => new Response(JSON.stringify(hazards(at)), { headers: { 'content-type': 'application/rss+xml; charset=utf-8' } }), clock: () => at });
  assert.equal(snapshot.hazards.status, 'ok');
  const xml = await fetchWorldSnapshot({ fetchImpl: async () => response(feed()), hazardFetchImpl: async () => new Response('<rss/>', { headers: { 'content-type': 'application/rss+xml' } }) });
  assert.equal(xml.hazards.status, 'error');
  const signals = [], controller = new AbortController();
  const pending = fetchWorldSnapshot({ signal: controller.signal, includeHazards: true, timeoutMs: 20, fetchImpl: async (_, options) => { signals.push(options.signal); return new Promise(() => {}); } });
  controller.abort(); await assert.rejects(pending, /중단/); assert.equal(signals.length, 2); assert.equal(signals.every(signal => signal.aborted), true);
  await assert.rejects(fetchWorldSnapshot({ includeHazards: true, timeoutMs: 10, fetchImpl: async () => new Promise(() => {}) }), /모두 실패/);
});

test('combined world checkpoint survives store reopening and encrypted clean restore without source requests', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-world-combined-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const at = Date.now(), stamp = new Date(at).toISOString(); let calls = 0;
  const snapshot = await fetchWorldSnapshot({ includeHazards: true, clock: () => at, fetchImpl: async url => { calls++; return response(url === WORLD_FEED ? feed(1, at) : hazards(at)); } });
  const store = openStore(dir);
  store.state.jobs.push({ id: randomUUID(), title: 'Combined world checkpoint', type: 'world', input: 'Public world observations', normalized: 'Public world observations', inputSha256: digest('Public world observations'), status: 'paused', step: 2, totalSteps: 3, createdAt: stamp, updatedAt: stamp, error: null, version: 1, artifacts: [], worldSnapshot: snapshot, draft: worldDocument(snapshot, at) });
  store.save();
  assert.deepEqual(openStore(dir).state.jobs[0].worldSnapshot, snapshot);
  const key = randomBytes(32), targetDir = path.join(dir, 'restored');
  const archive = exportBackup({ state: openStore(dir).state, dataDir: dir, key });
  restoreBackup({ archive, key, targetDir });
  const restored = openStore(targetDir).state;
  assert.deepEqual(restored.jobs[0].worldSnapshot, snapshot);
  assert.equal(restored.emergencyStop, true); assert.equal(restored.jobs[0].status, 'paused'); assert.equal(calls, 2);
});
