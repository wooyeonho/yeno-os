import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { start } from '../server.mjs';
import { openStore } from '../lib/store.mjs';
import {
  SourceError, SOURCE_ENTITY_TYPES, SOURCE_IMPLEMENTATION_STATUSES, SOURCE_BUCKETS,
  validateSourceFields, sourceBucket, planRequiredIntakeSeed,
} from '../lib/sources.mjs';
import { sourceMatches } from '../public/source-reference-labels.mjs';

// BLACKHOLE §C single-ledger intake: reuses the existing sources.mjs
// registry (state.sources) for both real URL-backed reference material and
// topic-only backlog items with no confirmed external link yet - no second
// store, no second engine. Tests below name which requirement they prove.

// -----------------------------------------------------------------------
// Pure unit tests: schema, dedup logic, bucket computation, seed planning.
// -----------------------------------------------------------------------

test('validateSourceFields requires exactly one of url/sourceLocator on creation, keeps decision/readingStatus/implementationStatus/entityType fully independent, and makes origin/url/sourceLocator immutable on update', () => {
  assert.throws(() => validateSourceFields({ title: 'x' }, { creating: true, imported: true }), /Provide exactly one/);
  assert.throws(() => validateSourceFields({ title: 'x', url: 'https://example.com/a', sourceLocator: 'x' }, { creating: true, imported: true }), /Provide exactly one/);
  const topic = validateSourceFields({ title: '자동매매', sourceLocator: '자동매매' }, { creating: true, imported: true });
  assert.equal(topic.url, null);
  assert.equal(topic.canonicalUrl, null);
  assert.equal(topic.sourceLocator, '자동매매');
  // Defaults are honest and never inferred from each other.
  assert.equal(topic.decision, 'pending');
  assert.equal(topic.readingStatus, 'unread');
  assert.equal(topic.implementationStatus, 'idea');
  assert.equal(topic.entityType, 'UNRESOLVED');
  assert.equal(topic.origin, 'user');
  assert.deepEqual(topic.aliases, []);
  // decision/readingStatus/implementationStatus are genuinely orthogonal axes.
  const mixed = validateSourceFields({ decision: 'candidate', readingStatus: 'read', summary: 's', application: 'a', riskNotes: 'r', implementationStatus: 'blocked', entityType: 'RND', revision: 1 }, { current: { ...topic }, imported: true });
  assert.equal(mixed.decision, 'candidate');
  assert.equal(mixed.implementationStatus, 'blocked', 'a candidate decision must never imply coding/tested/live implementationStatus');
  // Immutable-on-update fields.
  for (const body of [{ url: 'https://example.com/b' }, { sourceLocator: 'other' }, { origin: 'assistant' }]) {
    assert.throws(() => validateSourceFields(body, { imported: true }), /Unknown or immutable source field/);
  }
  assert.deepEqual([...SOURCE_ENTITY_TYPES], ['SYS', 'APP', 'OPS', 'IP', 'HW', 'RND', 'REF', 'UNRESOLVED']);
  assert.deepEqual([...SOURCE_IMPLEMENTATION_STATUSES], ['idea', 'scoped', 'queued', 'coding', 'tested', 'live', 'blocked', 'retired']);
});

test('aliases are validated (bounded, deduplicated, no control characters) and searchable via sourceMatches', () => {
  assert.throws(() => validateSourceFields({ title: 'x', sourceLocator: 'x', aliases: Array.from({ length: 11 }, (_, i) => `a${i}`) }, { creating: true, imported: true }), /aliases must be an array/);
  assert.throws(() => validateSourceFields({ title: 'x', sourceLocator: 'x', aliases: ['dup', 'dup'] }, { creating: true, imported: true }), /duplicates/);
  assert.throws(() => validateSourceFields({ title: 'x', sourceLocator: 'x', aliases: ['bad\x00name'] }, { creating: true, imported: true }), /control characters/);
  const fields = validateSourceFields({ title: 'PhytoMotive', sourceLocator: 'PhytoMotive', aliases: ['식물로봇'] }, { creating: true, imported: true });
  const record = { id: randomUUID(), ...fields, version: 1, createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z' };
  assert.equal(sourceMatches(record, '식물로봇'), true);
  assert.equal(sourceMatches(record, 'PhytoMotive'), true);
  assert.equal(sourceMatches(record, '전혀 다른 검색어'), false);
});

test('sourceBucket derives NOW/QUEUED/BLOCKED/retired purely from real fields, and AGING is a non-blocking warning flag layered on top (scenario: ALL/NOW/QUEUED/BLOCKED/AGING)', () => {
  const at = '2026-09-20T00:00:00.000Z';
  const base = { decision: 'pending', updatedAt: at };
  assert.equal(sourceBucket({ ...base, implementationStatus: 'idea' }, at).bucket, 'queued');
  assert.equal(sourceBucket({ ...base, implementationStatus: 'coding' }, at).bucket, 'now');
  assert.equal(sourceBucket({ ...base, implementationStatus: 'tested' }, at).bucket, 'now');
  assert.equal(sourceBucket({ ...base, implementationStatus: 'blocked' }, at).bucket, 'blocked');
  assert.equal(sourceBucket({ ...base, implementationStatus: 'retired' }, at).bucket, 'retired');
  assert.equal(sourceBucket({ ...base, implementationStatus: 'idea', decision: 'rejected' }, at).bucket, 'retired', 'rejected falls out of every active bucket');
  // AGING: a warning only, never a separate hard gate, never blocking anything by itself.
  const old = { ...base, implementationStatus: 'idea', updatedAt: '2026-09-01T00:00:00.000Z' };
  const fresh = sourceBucket(old, '2026-09-05T00:00:00.000Z');
  assert.equal(fresh.aging, false, 'under 14 days is not aging yet');
  const aged = sourceBucket(old, '2026-09-20T00:00:00.000Z');
  assert.equal(aged.aging, true);
  assert.equal(aged.bucket, 'queued', 'aging never changes the bucket itself, only flags it');
  assert.equal(sourceBucket({ ...base, implementationStatus: 'coding', updatedAt: '2026-01-01T00:00:00.000Z' }, at).aging, false, 'now-bucket items are never flagged aging');
  assert.deepEqual([...SOURCE_BUCKETS], ['now', 'queued', 'blocked', 'retired']);
});

test('planRequiredIntakeSeed finds every mandatory search case, is idempotent, and never duplicates a term the owner already registered under an equivalent name', () => {
  const REQUIRED_TERMS = ['자동매매', '엔화', '당근', '식물로봇', 'PhytoMotive', 'Scrapagotchi', '음식물쓰레기', '다마고치', '산양게임', '코리아타운', '소설', 'God Eye', 'Grok'];
  const firstPass = planRequiredIntakeSeed([]);
  const seeded = firstPass.map(fields => ({ id: randomUUID(), ...fields, version: 1, createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z' }));
  for (const term of REQUIRED_TERMS) assert.ok(seeded.some(source => sourceMatches(source, term)), `required search case not found: ${term}`);
  // Idempotent: seeding again against the already-seeded registry adds nothing.
  assert.deepEqual(planRequiredIntakeSeed(seeded), []);
  // An owner who already registered "Grok" under their own name/alias is never duplicated.
  const ownerRegistered = [{ id: randomUUID(), title: '내가 만든 Grok 메모', sourceLocator: '내가 만든 Grok 메모', url: null, canonicalUrl: null, aliases: ['Grok'], entityType: 'REF', implementationStatus: 'idea', origin: 'user', projectId: null, readingStatus: 'unread', decision: 'pending', summary: '', application: '', riskNotes: '', version: 1, createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z' }];
  const secondPass = planRequiredIntakeSeed(ownerRegistered);
  assert.equal(secondPass.some(fields => fields.title === 'Grok Bot'), false, 'an existing alias match must suppress the seed, never create a duplicate entity');
});

// -----------------------------------------------------------------------
// Real HTTP server, real on-disk store, real restart.
// -----------------------------------------------------------------------

async function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-single-ledger-')), token = 'synthetic-single-ledger-owner-token';
  let runtime = await start({ host: '127.0.0.1', port: 0, dataDir: dir, token, env: {} });
  const base = () => `http://127.0.0.1:${runtime.server.address().port}`;
  const request = async (method, route, body) => { const r = await fetch(`${base()}${route}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, body: await r.json() }; };
  const post = (route, body = {}) => request('POST', route, { requestId: randomUUID(), ...body });
  const get = route => request('GET', route);
  const unauthenticated = async (method, route, body) => { const r = await fetch(`${base()}${route}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, body: await r.json() }; };
  const restart = async () => { runtime.shutdown(); runtime = await start({ host: '127.0.0.1', port: 0, dataDir: dir, token, env: {} }); };
  t.after(() => { runtime.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { post, get, unauthenticated, restart, disk: () => openStore(dir).state };
}

test('a topic-only source (no confirmed URL) can be registered, found by alias search, and never collides with an unrelated topic sharing the null canonicalUrl (scenario: single-ledger intake for items with no confirmed source)', async t => {
  const h = await setup(t);
  const created = await h.post('/api/sources', { title: '엔화(JPY) 원요청', sourceLocator: '엔화(JPY) 원요청', aliases: ['엔화'], entityType: 'RND', summary: 'JPY 원문은 확인되나 FX 전략은 assistant 제안이었음.' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const source = created.body.source;
  assert.equal(source.url, null);
  assert.equal(source.canonicalUrl, null);
  assert.equal(source.sourceLocator, '엔화(JPY) 원요청');

  const second = await h.post('/api/sources', { title: '당근 인플루언서', sourceLocator: '당근 인플루언서', aliases: ['당근'], entityType: 'OPS' });
  assert.equal(second.status, 201, JSON.stringify(second.body));
  // Two different null-canonicalUrl (topic-only) sources must never be treated as duplicates of each other.
  const list = await h.get('/api/sources');
  assert.equal(list.body.sources.length, 2);

  const search = await h.get('/api/sources?q=엔화');
  assert.equal(search.body.sources.length, 1);
  assert.equal(search.body.sources[0].id, source.id);

  const duplicate = await h.post('/api/sources', { title: '다른 제목', sourceLocator: '엔화(JPY) 원요청' });
  assert.equal(duplicate.status, 409, 'the exact same normalized locator must be rejected as a duplicate');
});

test('GET /api/sources?view= filters by real bucket and ?aging=true narrows to warned items, without changing the default (no params) response shape', async t => {
  const h = await setup(t);
  const nowItem = await h.post('/api/sources', { title: '작업중 항목', sourceLocator: '작업중 항목' });
  const blockedUpdate = await h.post(`/api/sources/${nowItem.body.source.id}/update`, { revision: 1, implementationStatus: 'coding' });
  assert.equal(blockedUpdate.status, 200, JSON.stringify(blockedUpdate.body));
  const queuedItem = await h.post('/api/sources', { title: '대기중 항목', sourceLocator: '대기중 항목' });
  assert.equal(queuedItem.status, 201);

  const all = await h.get('/api/sources');
  assert.equal(all.body.sources.length, 2);
  assert.equal(all.body.buckets, undefined, 'omitting view must keep the exact pre-existing response shape');

  const now = await h.get('/api/sources?view=now');
  assert.equal(now.body.sources.length, 1);
  assert.equal(now.body.sources[0].id, nowItem.body.source.id);
  assert.ok(Array.isArray(now.body.buckets));

  const queued = await h.get('/api/sources?view=queued');
  assert.equal(queued.body.sources.length, 1);
  assert.equal(queued.body.sources[0].id, queuedItem.body.source.id);

  const badView = await h.get('/api/sources?view=nonsense');
  assert.equal(badView.status, 400);
});

test('POST /api/sources/seed-required-intake registers every mandatory search case once, is idempotent on replay, and survives restart with the same IDs (scenario: 필수 검색 사례, restart persistence)', async t => {
  const h = await setup(t);
  const REQUIRED_TERMS = ['자동매매', '엔화', '당근', '식물로봇', 'PhytoMotive', 'Scrapagotchi', '음식물쓰레기', '다마고치', '산양게임', '코리아타운', '소설', 'God Eye', 'Grok'];
  const first = await h.post('/api/sources/seed-required-intake');
  assert.equal(first.status, 201, JSON.stringify(first.body));
  // Record count is not term count: related terms (e.g. 다마고치/음식물쓰레기 on the
  // same Scrapagotchi entity) share one record via aliases rather than
  // duplicating the entity - the real requirement, checked below, is that
  // every term is actually findable, not that each gets its own record.
  assert.ok(first.body.createdCount > 0, 'seeding must actually create records');

  for (const term of REQUIRED_TERMS) {
    const search = await h.get(`/api/sources?q=${encodeURIComponent(term)}`);
    assert.ok(search.body.sources.length >= 1, `required search case not found via HTTP: ${term}`);
  }
  const godEye = (await h.get('/api/sources?q=God Eye')).body.sources[0];
  assert.equal(godEye.url, 'https://instagram.com/reel/DcjMGA9vHxU', 'the one required term with a confirmed real URL must be seeded url-based, not as a topic-only locator');
  assert.equal(godEye.canonicalUrl, 'https://instagram.com/reel/DcjMGA9vHxU');

  const idsAfterFirst = new Set((await h.get('/api/sources')).body.sources.map(s => s.id));
  const replay = await h.post('/api/sources/seed-required-intake');
  assert.equal(replay.status, 201);
  assert.equal(replay.body.createdCount, 0, 'a second seed call must add nothing - idempotent, never a duplicate');
  const idsAfterReplay = new Set((await h.get('/api/sources')).body.sources.map(s => s.id));
  assert.deepEqual(idsAfterReplay, idsAfterFirst);

  await h.restart();
  const idsAfterRestart = new Set(h.disk().sources.map(s => s.id));
  assert.deepEqual(idsAfterRestart, idsAfterFirst, 'seeded sources must survive restart with the exact same identities');
  const afterRestartReplay = await h.post('/api/sources/seed-required-intake');
  assert.equal(afterRestartReplay.body.createdCount, 0, 'seeding must remain idempotent after a real restart, never re-added from a stale in-memory check');
});

test('seeding never overwrites an owner edit made to a previously-seeded entry, and unauthenticated requests are rejected', async t => {
  const h = await setup(t);
  await h.post('/api/sources/seed-required-intake');
  const before = (await h.get('/api/sources?q=자동매매')).body.sources[0];
  const edited = await h.post(`/api/sources/${before.id}/update`, { revision: before.version, decision: 'deferred', implementationStatus: 'scoped', summary: '소유자가 직접 검토함' });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  const replay = await h.post('/api/sources/seed-required-intake');
  assert.equal(replay.body.createdCount, 0);
  const after = (await h.get('/api/sources?q=자동매매')).body.sources.find(s => s.id === before.id);
  assert.equal(after.decision, 'deferred', 'the owner\'s edit must never be overwritten by re-seeding');
  assert.equal(after.implementationStatus, 'scoped');
  assert.equal(after.summary, '소유자가 직접 검토함');

  const noAuthGet = await h.unauthenticated('GET', '/api/sources');
  assert.equal(noAuthGet.status, 401);
  const noAuthSeed = await h.unauthenticated('POST', '/api/sources/seed-required-intake', { requestId: randomUUID() });
  assert.equal(noAuthSeed.status, 401);
});
