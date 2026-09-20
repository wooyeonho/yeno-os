// BLACKHOLE R2 §C (BLACKHOLE_CLAUDE_CODE_EXECUTION.md) — proves the full
// required search-case list resolves through the real HTTP search API after
// both owner-triggered seeds (R1's required-intake topics, R1-follow-up's
// canonical project codes) run - the exact same GET /api/sources?q= route
// the web/Android sources tab calls, and the exact same sourceMatches()
// used everywhere. A search hit here is not feature-implementation success
// (most of these stay decision:pending); this only proves the search
// contract itself, per the mission's own "검색 성공은 기능 구현 성공이 아니다".
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { start } from '../server.mjs';

const REQUIRED_KEYWORDS = ['자동매매', '엔화', '당근', '식물로봇', 'PhytoMotive', 'Scrapagotchi', '음식물쓰레기', '다마고치', '산양게임', '코리아타운', '소설', 'God Eye', 'Grok'];
const SAMPLE_CANONICAL_CODES = ['C00', 'C01', 'E01', 'B04-13', 'V11'];

async function harness(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-r2-search-'));
  const token = 'synthetic-r2-search-owner-token';
  let runtime = await start({ host: '127.0.0.1', port: 0, dataDir: dir, token, env: {} });
  const base = () => `http://127.0.0.1:${runtime.server.address().port}`;
  const request = async (method, route, body) => {
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    const response = await fetch(`${base()}${route}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  const post = (route, extra = {}) => request('POST', route, { requestId: randomUUID(), ...extra });
  const get = route => request('GET', route);
  const restart = async () => { runtime.shutdown(); runtime = await start({ host: '127.0.0.1', port: 0, dataDir: dir, token, env: {} }); };
  t.after(() => { runtime.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { post, get, restart };
}

test('every required keyword and a sample of canonical project codes resolve uniquely through the real search API, and survive restart', async t => {
  const h = await harness(t);

  const seedRequired = await h.post('/api/sources/seed-required-intake');
  assert.equal(seedRequired.status, 201, JSON.stringify(seedRequired.body));
  const seedCanonical = await h.post('/api/sources/import-canonical-intake');
  assert.equal(seedCanonical.status, 201, JSON.stringify(seedCanonical.body));
  assert.equal(seedCanonical.body.createdCount, 50);

  for (const term of REQUIRED_KEYWORDS) {
    const result = await h.get(`/api/sources?q=${encodeURIComponent(term)}`);
    assert.equal(result.status, 200, `search failed for ${term}`);
    assert.ok(result.body.sources.length >= 1, `required keyword not found: ${term}`);
    // Search success is not feature-implementation success (mission text).
    for (const source of result.body.sources) assert.equal(source.decision, 'pending', `${term} must still be pending, not silently adopted`);
  }
  for (const code of SAMPLE_CANONICAL_CODES) {
    const result = await h.get(`/api/sources?q=${encodeURIComponent(code)}`);
    assert.equal(result.status, 200, `search failed for ${code}`);
    assert.equal(result.body.sources.length, 1, `canonical code must resolve exactly once: ${code}`);
    assert.equal(result.body.sources[0].aliases.includes(code), true);
  }

  // ALL/NOW/QUEUED/BLOCKED/AGING view is real, derived only from each
  // record's own implementationStatus - the canonical manifest honestly
  // marks A03/B02-4 'tested' (so those two land in NOW), everything else is
  // 'idea' (QUEUED). Nothing here is fabricated activity.
  const queuedView = await h.get('/api/sources?view=queued');
  assert.equal(queuedView.status, 200);
  assert.equal(queuedView.body.sources.some(source => source.aliases?.includes('C00')), true, 'an idea-status canonical record must be QUEUED');
  const nowView = await h.get('/api/sources?view=now');
  assert.equal(nowView.status, 200);
  assert.equal(nowView.body.sources.some(source => source.aliases?.includes('A03')), true, 'A03 is genuinely marked tested in the manifest, so it is NOW - never invented');
  assert.equal(nowView.body.sources.some(source => source.aliases?.includes('C00')), false, 'a freshly-seeded idea-status record is never shown as NOW/active work');

  await h.restart();
  for (const term of [...REQUIRED_KEYWORDS.slice(0, 3), ...SAMPLE_CANONICAL_CODES.slice(0, 2)]) {
    const result = await h.get(`/api/sources?q=${encodeURIComponent(term)}`);
    assert.ok(result.body.sources.length >= 1, `search must still resolve after restart: ${term}`);
  }
});
