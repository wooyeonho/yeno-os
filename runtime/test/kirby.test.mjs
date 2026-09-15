import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { detectLedgerDigestGap, autoAcquireCapability, tryAutoAcquireLedgerDigest } from '../lib/kirby.mjs';
import { initialCapabilities } from '../lib/capabilities.mjs';
import { start } from '../server.mjs';

const LEDGER_DIGEST = JSON.parse(fs.readFileSync(new URL('../capabilities/ledger-digest.json', import.meta.url)));

// --- pure unit tests: gap detection and the acquire pipeline, no server ---

test('no gap when the capability is already active', () => {
  const state = { capabilities: { entries: [{ id: 'ledger-digest', activeHash: 'x' }] }, outcomes: [{ value: 5 }] };
  assert.equal(detectLedgerDigestGap(state, LEDGER_DIGEST), null);
});

test('no gap when there is no real measured evidence yet', () => {
  const state = { capabilities: { entries: [] }, outcomes: [{ value: null }, {}] };
  assert.equal(detectLedgerDigestGap(state, LEDGER_DIGEST), null);
});

test('a real gap names how much measured ledger evidence justifies it', () => {
  const state = { capabilities: { entries: [] }, outcomes: [{ value: 5 }, { value: -1 }, { value: null }] };
  const gap = detectLedgerDigestGap(state, LEDGER_DIGEST);
  assert.ok(gap);
  assert.match(gap.reason, /1건/); // only the single non-negative numeric outcome counts
  assert.equal(gap.manifest.id, 'ledger-digest');
});

test('autoAcquireCapability imports, verifies via real fixtures, and activates a good candidate', () => {
  const { registry, result } = autoAcquireCapability(initialCapabilities(), LEDGER_DIGEST);
  assert.equal(result.acquired, true);
  assert.equal(result.stage, 'active');
  const entry = registry.entries.find(e => e.id === 'ledger-digest');
  assert.equal(entry.activeHash, result.hash);
});

test('a candidate that fails its own isolated fixture trial is imported but never activated - recovery is staying inert', () => {
  const broken = { ...LEDGER_DIGEST, fixtures: [
    { ...LEDGER_DIGEST.fixtures[0], expectedRows: [{ ledger: 'wrong', summary: 'x', value: 999, unit: 'x' }] },
    LEDGER_DIGEST.fixtures[1],
  ] };
  const { registry, result } = autoAcquireCapability(initialCapabilities(), broken);
  assert.equal(result.acquired, false);
  assert.equal(result.stage, 'verify');
  assert.ok(result.error);
  const entry = registry.entries.find(e => e.id === 'ledger-digest');
  assert.equal(entry.activeHash, null, 'imported as an honest record of the attempt, but never went live');
  assert.equal(entry.versions[0].verification, null);
});

test('tryAutoAcquireLedgerDigest is idempotent once acquired - the gap closes and it stops acting', () => {
  const state = { capabilities: initialCapabilities(), outcomes: [{ value: 10 }] };
  const first = tryAutoAcquireLedgerDigest(state, LEDGER_DIGEST);
  assert.equal(first.result.acquired, true);
  const second = tryAutoAcquireLedgerDigest({ ...state, capabilities: first.registry }, LEDGER_DIGEST);
  assert.equal(second, null, 'already active - nothing left for Kirby to acquire');
});

// --- real end-to-end: an outcome landing through the actual HTTP API is what triggers Kirby ---

const env = { YENO_AGENT_PROVIDER: 'auto', YENO_AGENT_DAILY_CALL_LIMIT: '10', YENO_OPENAI_API_KEY: 'synthetic-openai-key', YENO_OPENAI_MODEL: 'synthetic-openai' };
const reply = text => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: text, tool_calls: [] } }], usage: { prompt_tokens: 20, completion_tokens: 20 } }), { headers: { 'Content-Type': 'application/json' } });

async function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-kirby-'));
  const token = 'synthetic-kirby-owner-token';
  let runtime = await start({ host: '127.0.0.1', port: 0, dataDir: dir, token, env, agentFetch: async () => reply('실제 산출물 초안입니다. 확인된 근거: 없음. 남은 검증: 외부 채택 여부.') });
  const request = async (method, route, body) => {
    const r = await fetch(`http://127.0.0.1:${runtime.server.address().port}${route}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const text = await r.text();
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
  };
  const post = (route, body = {}) => request('POST', route, { requestId: randomUUID(), ...body });
  const get = route => request('GET', route);
  const wait = async (id, statuses = ['completed', 'failed', 'paused']) => {
    for (let i = 0; i < 300; i++) { const j = runtime.state().jobs.find(j => j.id === id); if (j && statuses.includes(j.status)) return j; await new Promise(r => setTimeout(r, 15)); }
    assert.fail('job did not reach a target state in time');
  };
  const restart = async () => { runtime.shutdown(); runtime = await start({ host: '127.0.0.1', port: 0, dataDir: dir, token, env }); };
  t.after(() => { runtime.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { post, get, wait, restart };
}

test('Kirby auto-acquires ledger-digest the moment a real numeric outcome lands, without an owner import/verify/activate call', async t => {
  const app = await setup(t);

  const before = await app.get('/api/abilities');
  assert.equal(before.body.capabilities.find(c => c.id === 'ledger-digest'), undefined, 'not bootstrapped like the two base capabilities - only auto-acquired on real evidence');

  const created = await app.post('/api/quests', { goal: '실측 성과를 기록한다', successCriterion: '완료된 산출물과 측정값을 남긴다.' });
  assert.equal(created.status, 201);
  const ran = await app.post(`/api/quests/${created.body.quest.id}/run`);
  assert.equal(ran.status, 201, JSON.stringify(ran.body));
  const finished = await app.wait(ran.body.job.id);
  assert.equal(finished.status, 'completed', finished.error);
  const quest = (await app.get('/api/quests')).body.quests.find(q => q.jobId === finished.id);
  const artifactId = quest.artifacts[0].id;

  // The owner reports a real, numeric, self-measured outcome - this is the
  // genuine evidence Kirby's gap detection reacts to, never the quest text.
  const outcome = await app.post('/api/outcomes', { questId: quest.id, ledger: 'wealth', summary: '합성 시험 확인된 성과', artifactId, value: 42, unit: '건' });
  assert.equal(outcome.status, 201);
  assert.ok(outcome.body.kirbyAcquisition, JSON.stringify(outcome.body));
  assert.equal(outcome.body.kirbyAcquisition.id, 'ledger-digest');
  assert.equal(outcome.body.kirbyAcquisition.acquired, true);

  const after = await app.get('/api/abilities');
  const acquired = after.body.capabilities.find(c => c.id === 'ledger-digest');
  assert.ok(acquired);
  assert.equal(acquired.status, 'active');

  // Now that it is active, Kirby can actually run it on the real ledger data -
  // the same run path any other capability uses, producing real growth evidence.
  const runResult = await app.post('/api/capabilities/run', { id: 'ledger-digest', input: { records: [{ ledger: 'wealth', summary: '합성 시험 확인된 성과', value: 42, unit: '건' }] } });
  assert.equal(runResult.status, 201, JSON.stringify(runResult.body));
  await app.wait(runResult.body.jobId);
  const graded = (await app.get('/api/state')).body.growth.capabilities.skills.find(s => s.id === 'ledger-digest');
  assert.equal(graded.grade, 'D');

  // Recording a second numeric outcome no longer needs to acquire anything - the gap is already closed.
  const created2 = await app.post('/api/quests', { goal: '두 번째 실측 성과를 기록한다', successCriterion: '완료된 산출물과 측정값을 남긴다.' });
  assert.equal(created2.status, 201, JSON.stringify(created2.body));
  const ran2 = await app.post(`/api/quests/${created2.body.quest.id}/run`);
  assert.equal(ran2.status, 201, JSON.stringify(ran2.body));
  const finished2 = await app.wait(ran2.body.job.id);
  assert.equal(finished2.status, 'completed', JSON.stringify(finished2));
  const questsAfter2 = (await app.get('/api/quests')).body.quests;
  const quest2 = questsAfter2.find(q => q.jobId === finished2.id);
  assert.ok(quest2, JSON.stringify(questsAfter2));
  const outcome2 = await app.post('/api/outcomes', { questId: quest2.id, ledger: 'fame', summary: '합성 시험 두 번째 성과', artifactId: quest2.artifacts[0].id, value: 7, unit: '건' });
  assert.equal(outcome2.status, 201);
  assert.equal(outcome2.body.kirbyAcquisition, undefined, 'already active - nothing left to acquire, so the field is simply absent');

  // Survives restart: the acquisition is a real persisted registry mutation, not in-memory only.
  await app.restart();
  const afterRestart = await app.get('/api/abilities');
  assert.equal(afterRestart.body.capabilities.find(c => c.id === 'ledger-digest')?.status, 'active');
  const stateAfterRestart = await app.get('/api/state');
  assert.equal(stateAfterRestart.body.growth.capabilities.skills.find(s => s.id === 'ledger-digest').grade, 'D');
});
