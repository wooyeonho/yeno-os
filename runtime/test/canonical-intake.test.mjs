import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { start } from '../server.mjs';
import { CANONICAL_PROJECT_INTAKE, planCanonicalProjectIntake } from '../lib/canonical-intake.mjs';

const EXPECTED_CODES = CANONICAL_PROJECT_INTAKE.map(item => item.code);

test('canonical intake manifest contains the historical 50 IDs exactly once and plans URL-less, pending records', () => {
  assert.equal(CANONICAL_PROJECT_INTAKE.length, 50);
  assert.equal(new Set(EXPECTED_CODES).size, 50);
  const planned = planCanonicalProjectIntake([]);
  assert.equal(planned.length, 50);
  for (const source of planned) {
    assert.equal(source.url, null);
    assert.equal(source.canonicalUrl, null);
    assert.equal(source.readingStatus, 'unread');
    assert.equal(source.decision, 'pending');
    assert.equal(source.implementationStatus === 'tested' || source.implementationStatus === 'idea', true);
    assert.equal(source.aliases.length, 1);
  }
  const existing = planned.map((fields, index) => ({ id: randomUUID(), ...fields, version: 1, createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z' }));
  assert.deepEqual(planCanonicalProjectIntake(existing), [], 'replaying against the same registry must be idempotent');
});

async function harness(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-canonical-intake-'));
  const token = 'synthetic-canonical-owner-token';
  let runtime = await start({ host: '127.0.0.1', port: 0, dataDir: dir, token, env: {} });
  const base = () => `http://127.0.0.1:${runtime.server.address().port}`;
  const request = async (method, route, body, authenticated = true) => {
    const headers = { 'Content-Type': 'application/json' };
    if (authenticated) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${base()}${route}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  const post = (route, requestId, extra = {}, authenticated = true) => request('POST', route, { requestId, ...extra }, authenticated);
  const get = route => request('GET', route);
  const restart = async () => {
    runtime.shutdown();
    runtime = await start({ host: '127.0.0.1', port: 0, dataDir: dir, token, env: {} });
  };
  t.after(() => { runtime.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { post, get, restart };
}

test('owner-triggered canonical intake imports all 50 searchable IDs, preserves edits, survives restart, and remains idempotent', async t => {
  const h = await harness(t);
  const first = await h.post('/api/sources/import-canonical-intake', randomUUID());
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.totalCount, 50);
  assert.equal(first.body.createdCount, 50);
  assert.equal(first.body.reusedCount, 0);

  for (const code of EXPECTED_CODES) {
    const result = await h.get(`/api/sources?q=${encodeURIComponent(code)}`);
    assert.equal(result.status, 200, `search failed for ${code}`);
    assert.equal(result.body.sources.length, 1, `canonical ID must resolve exactly once: ${code}`);
    assert.equal(result.body.sources[0].aliases.includes(code), true);
  }

  const edited = (await h.get('/api/sources?q=C00')).body.sources[0];
  const update = await h.post(`/api/sources/${edited.id}/update`, randomUUID(), { revision: edited.version, decision: 'deferred', implementationStatus: 'scoped', summary: 'owner edit preserved' });
  assert.equal(update.status, 200, JSON.stringify(update.body));

  const replay = await h.post('/api/sources/import-canonical-intake', randomUUID());
  assert.equal(replay.status, 201, JSON.stringify(replay.body));
  assert.equal(replay.body.totalCount, 50);
  assert.equal(replay.body.createdCount, 0);
  assert.equal(replay.body.reusedCount, 50);

  const afterEdit = (await h.get('/api/sources?q=C00')).body.sources[0];
  assert.equal(afterEdit.decision, 'deferred');
  assert.equal(afterEdit.implementationStatus, 'scoped');
  assert.equal(afterEdit.summary, 'owner edit preserved');

  await h.restart();
  const afterRestart = (await h.get('/api/sources?q=B04-13')).body.sources;
  assert.equal(afterRestart.length, 1);
  assert.equal(afterRestart[0].aliases.includes('B04-13'), true);

  const postRestart = await h.post('/api/sources/import-canonical-intake', randomUUID());
  assert.equal(postRestart.status, 201);
  assert.equal(postRestart.body.createdCount, 0);
  assert.equal(postRestart.body.reusedCount, 50);
});

test('canonical intake is owner-authenticated and rejects body fields outside requestId', async t => {
  const h = await harness(t);
  const unauthenticated = await h.post('/api/sources/import-canonical-intake', randomUUID(), {}, false);
  assert.equal(unauthenticated.status, 401);
  const extra = await h.post('/api/sources/import-canonical-intake', randomUUID(), { unexpected: true });
  assert.equal(extra.status, 400);
});
