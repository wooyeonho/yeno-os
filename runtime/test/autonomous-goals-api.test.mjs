// Real end-to-end wiring for Homunculus's autonomous goal synthesis - not
// just the pure autonomous-goals.mjs unit tests. Walks the owner's own six
// required scenarios against a real running server and real persisted state:
//   1. no proposed quest + real evidence gap -> one autonomous quest created
//   2. same state repeatedly observed -> no duplicate
//   3. a genuine state change -> a different goal
//   4. an approval-required (unsafe) archetype -> never auto-executed
//   5. a real restart -> the same generated quest, same identity
//   6. zero model credentials -> synthesis still works (it spends no model call)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { start } from '../server.mjs';
import { openStore } from '../lib/store.mjs';

async function setup(t, { seed } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-autonomous-goals-'));
  const token = 'synthetic-autonomous-goals-owner-token';
  if (seed) { const store = openStore(dir); seed(store.state); store.save(); }
  let runtime = await start({ host: '127.0.0.1', port: 0, dataDir: dir, token, env: {} });
  const request = async (method, route, body) => {
    const r = await fetch(`http://127.0.0.1:${runtime.server.address().port}${route}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const text = await r.text();
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
  };
  const post = (route, body = {}) => request('POST', route, { requestId: randomUUID(), ...body });
  const get = route => request('GET', route);
  const restart = async () => { runtime.shutdown(); runtime = await start({ host: '127.0.0.1', port: 0, dataDir: dir, token, env: {} }); };
  // Stops the runtime (releasing its data-directory lock), lets the caller
  // mutate durable state directly - standing in for "some other real part of
  // the core observed a new, distinct failure" - then restarts on the
  // mutated store. This is the same low-level seeding technique `seed` uses,
  // just applied mid-test instead of only at startup.
  const mutateAndRestart = async mutate => {
    runtime.shutdown();
    const store = openStore(dir); mutate(store.state); store.save();
    runtime = await start({ host: '127.0.0.1', port: 0, dataDir: dir, token, env: {} });
  };
  t.after(() => { runtime.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { post, get, restart, mutateAndRestart, dir };
}

// A plain, minimal 'failed' agent job - no quest reference, no capability
// request, no code task - satisfies every job-shape validator by simply not
// having any of their discriminator fields (the same "absent field means not
// applicable" convention autopilot.mjs's own validateAutopilotJob uses).
function seedFailedJob(state, overrides = {}) {
  const at = new Date().toISOString();
  const job = { id: randomUUID(), title: '시드된 실패 작업', type: 'agent', input: '테스트 입력', status: 'failed', step: 3, totalSteps: 3, createdAt: at, updatedAt: at, error: '합성 테스트 실패', version: 1, artifacts: [], ...overrides };
  state.jobs.push(job);
  return job;
}

// A fully self-consistent completed quest + job + artifact + numeric outcome,
// seeded directly (not executed) so detectLedgerDigestGap() sees a real gap
// with zero AI ever configured or called - recordQuestOutcome's own live path
// needs a completed agent job, which needs AI, so this seeds its end state.
function seedMeasuredOutcome(state) {
  const at = new Date().toISOString();
  const jobId = randomUUID(), questId = randomUUID(), artifactId = randomUUID();
  state.jobs.push({
    id: jobId, type: 'agent', title: '시드된 완료 작업', input: '테스트', status: 'completed', step: 3, totalSteps: 3,
    createdAt: at, updatedAt: at, error: null, version: 1, artifacts: [{ id: artifactId, name: 'seed-result.md' }],
    agentJournal: { provider: 'openai', model: 'seed-model', calls: [{ id: randomUUID(), at, status: 'settled', inputTokens: 1, outputTokens: 1 }], history: [] },
    questId, callLimit: 1,
  });
  state.artifacts[artifactId] = { id: artifactId, jobId, name: 'seed-result.md', mimeType: 'text/markdown', sha256: 'a'.repeat(64), bytes: 20, filename: `${artifactId}.md`, createdAt: at };
  state.quests.push({
    id: questId, version: 1, goal: '시드된 완료 목표', driveId: 'sloth', drive: 'sloth', provider: 'auto', projectId: null,
    successCriterion: '시드된 성공 기준', baseline: '기준값 미측정', maxCalls: 2, durationMinutes: 30, costUsd: null,
    status: 'assigned', jobId, createdAt: at, updatedAt: at,
  });
  state.outcomes.push({
    id: randomUUID(), version: 1, questId, jobId, ledger: 'wealth', summary: '시드된 성과', value: 100, unit: '원',
    verification: 'self_reported', source: 'owner_report', artifactId, artifactSha256: 'a'.repeat(64), createdAt: at,
  });
}

test('a real failed job with no other proposed quest produces exactly one autonomous quest', async t => {
  const app = await setup(t, { seed: state => seedFailedJob(state) });
  const before = await app.get('/api/quests'); assert.equal(before.body.quests.length, 0);
  const first = await app.post('/api/quests/synthesize');
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.created, true);
  assert.equal(first.body.quest.status, 'proposed');
  assert.equal(first.body.quest.autonomy.archetype, 'repair');
  const after = await app.get('/api/quests'); assert.equal(after.body.quests.length, 1);
});

test('repeated synthesis over the exact same unresolved state creates no duplicate', async t => {
  const app = await setup(t, { seed: state => seedFailedJob(state) });
  await app.post('/api/quests/synthesize');
  const again = await app.post('/api/quests/synthesize');
  assert.equal(again.status, 200);
  assert.equal(again.body.created, false, 'the same unresolved failure must not create a second quest');
  const state = await app.get('/api/quests');
  assert.equal(state.body.quests.length, 1);
});

test('a genuine state change (a second, distinct failure) produces a different autonomous goal', async t => {
  const app = await setup(t, { seed: state => seedFailedJob(state) });
  const first = await app.post('/api/quests/synthesize');
  assert.equal(first.body.created, true);
  assert.equal((await app.post('/api/quests/synthesize')).body.created, false, 'still no second quest while nothing real has changed');

  // A genuinely new, distinct failure now really exists in durable state.
  await app.mutateAndRestart(state => seedFailedJob(state));
  const second = await app.post('/api/quests/synthesize');
  assert.equal(second.status, 201, JSON.stringify(second.body));
  assert.equal(second.body.created, true, 'a real new failure gets its own goal, even though the first is still unresolved');
  assert.notEqual(second.body.quest.autonomy.key, first.body.quest.autonomy.key);
  const all = await app.get('/api/quests');
  assert.equal(all.body.quests.length, 2);
});

test('a real capability gap (acquire-capability) is approval-required and never auto-executed, even when it wins the ranking', async t => {
  const app = await setup(t, { seed: state => seedMeasuredOutcome(state) });
  const synth = await app.post('/api/quests/synthesize');
  assert.equal(synth.status, 201, JSON.stringify(synth.body));
  assert.equal(synth.body.quest.autonomy.archetype, 'acquire-capability');
  assert.equal(synth.body.quest.autonomy.approvalRequired, true);
  const questId = synth.body.quest.id;

  // The ranked, automatic decide path must refuse to run it by itself.
  const decided = await app.post('/api/quests/decide');
  assert.equal(decided.status, 201, JSON.stringify(decided.body));
  assert.equal(decided.body.approvalRequired, true);
  assert.equal(decided.body.jobId, undefined, 'no job may be created for an approval-required quest through the ranked path');
  const stillProposed = await app.get('/api/quests');
  assert.equal(stillProposed.body.quests.find(q => q.id === questId).status, 'proposed');

  // The owner explicitly running that exact quest by id IS the approval, and
  // stays available - this slice only ever gates the automatic ranked path.
  const run = await app.post(`/api/quests/${questId}/run`);
  assert.equal(run.status, 409, JSON.stringify(run.body));
  assert.match(run.body.error ?? JSON.stringify(run.body), /API 키|provider|모델/, 'blocked only by the real absence of an AI provider, not by approval logic');
});

test('the generated quest and its autonomy identity survive a real restart', async t => {
  const app = await setup(t, { seed: state => seedFailedJob(state) });
  const created = await app.post('/api/quests/synthesize');
  const questId = created.body.quest.id, key = created.body.quest.autonomy.key;
  await app.restart();
  const after = await app.get('/api/quests');
  const quest = after.body.quests.find(q => q.id === questId);
  assert.ok(quest, 'the exact same quest id must still exist after restart');
  assert.equal(quest.autonomy.key, key);
  const again = await app.post('/api/quests/synthesize');
  assert.equal(again.body.created, false, 'a restart must not let the same real failure be proposed twice');
});

test('autonomous goal synthesis works with zero model credentials configured - it never spends a model call', async t => {
  const app = await setup(t, { seed: state => seedFailedJob(state) });
  const state = await app.get('/api/state');
  assert.equal(state.body.ai.configured, false, 'this scenario genuinely has no AI provider configured');
  const result = await app.post('/api/quests/synthesize');
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal(result.body.created, true);
  assert.equal(result.body.quest.autonomy.archetype, 'repair');
});

test('with no real evidence gap anywhere, synthesis honestly proposes nothing', async t => {
  const app = await setup(t);
  const result = await app.post('/api/quests/synthesize');
  assert.equal(result.status, 200);
  assert.equal(result.body.created, false);
});
