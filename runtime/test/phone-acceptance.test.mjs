// The literal single acceptance scenario, walked end to end through the real
// HTTP API a phone's browser hits (runtime/public/voice-view.mjs talks this
// exact surface). Real audio I/O, a physical device, and Kirby *automatically*
// discovering a missing capability are out of scope here and not claimed -
// this test uses a capability that already exists (one of the two capabilities
// the core bootstraps on first start), the same way an owner-imported or
// discovery-imported capability would already exist by the time a quest needs
// it. What this test does prove, against the real server and real persisted
// state (including a real restart), is every other step the owner specified:
//   1. a spoken "지금 가장 먼저 해야 할 일을 정해줘" reaches Homunculus's real
//      seven-drive ranking over real proposed quests (never a fabricated pick)
//   2. the ranking and its reason are returned for the phone to show/speak
//   3. Jarvis actually runs the chosen quest and produces a real, downloadable
//      result
//   4. Kirby's capability system (declarative engine - the QuickJS-backed code
//      capability path needs a sandbox this container doesn't have, so it is
//      exercised in code-workshop.test.mjs instead, not duplicated here) is
//      run on two genuinely different inputs, and its growth grade updates
//      from real evidence, not a claim
//   5. an owner-reported outcome attaches to the real result artifact
//   6. every one of the above survives a real process restart
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { start } from '../server.mjs';
import { openStore } from '../lib/store.mjs';

const env = { YENO_AGENT_PROVIDER: 'auto', YENO_AGENT_DAILY_CALL_LIMIT: '10', YENO_OPENAI_API_KEY: 'synthetic-openai-key', YENO_OPENAI_MODEL: 'synthetic-openai' };
const reply = text => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: text, tool_calls: [] } }], usage: { prompt_tokens: 20, completion_tokens: 20 } }), { headers: { 'Content-Type': 'application/json' } });

async function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-phone-acceptance-'));
  const token = 'synthetic-phone-acceptance-owner-token';
  const seed = openStore(dir); seed.state.modules.ai = true; seed.save();
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

test('phone single-acceptance scenario: voice decide -> Homunculus reason -> Jarvis quest -> Kirby capability reuse -> growth grade -> outcome -> survives restart', async t => {
  const app = await setup(t);

  // Two real proposed quests already on file (as if the owner, or the
  // autopilot loop, had written them down earlier) - Homunculus is never
  // asked to invent a goal from nothing.
  const lowGap = await app.post('/api/quests', { goal: '지난달 방문 기록을 다시 정리한다', baseline: '지난달 방문자 120명, 이미 집계 완료', successCriterion: '이미 확인된 수치를 표로 다시 정리한다.' });
  assert.equal(lowGap.status, 201);
  const highGap = await app.post('/api/quests', { goal: '가장 시급한 근거 공백을 확인한다', successCriterion: '근거가 부족한 항목과 다음 확인 계획을 저장한다.' }); // no baseline -> real, larger gap
  assert.equal(highGap.status, 201);

  // 1) "지금 가장 먼저 해야 할 일을 정해줘" via the exact voice endpoint the
  // phone's browser calls, with the exact phrase named in the acceptance scenario.
  const decided = await app.post('/api/voice', { text: '지금 가장 먼저 해야 할 일을 정해줘', history: [] });
  assert.equal(decided.status, 201, JSON.stringify(decided.body));
  assert.equal(decided.body.decision.goal, highGap.body.quest.goal, 'Homunculus picks the quest with the real, larger gap, not the first one created');
  assert.ok(decided.body.decision.dominantDrives.length >= 1);
  assert.match(decided.body.decision.announcement, new RegExp(highGap.body.quest.goal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const questJobId = decided.body.jobId;
  assert.ok(questJobId);

  // 2) Jarvis actually runs it and produces a real, verifiable result.
  const finished = await app.wait(questJobId);
  assert.equal(finished.status, 'completed', finished.error);
  const questsAfter = await app.get('/api/quests');
  const quest = questsAfter.body.quests.find(q => q.jobId === questJobId);
  assert.equal(quest.status, 'completed');
  assert.equal(quest.resultStatus, 'artifact_recorded');
  const artifactId = quest.artifacts[0].id;

  // 3) Kirby: run the already-registered "evidence-gap-brief" capability on
  // two genuinely different inputs (the C-grade requirement is specifically
  // that replaying the same input never counts as reuse - see growth.mjs).
  const inputA = { records: [{ title: '자료 A', evidenceCount: 0, priority: 3, nextStep: '원문 확인' }] };
  const inputB = { records: [{ title: '자료 B', evidenceCount: 1, priority: 2, nextStep: '재현 확인' }] };
  const runA = await app.post('/api/capabilities/run', { id: 'evidence-gap-brief', input: inputA });
  assert.equal(runA.status, 201, JSON.stringify(runA.body));
  await app.wait(runA.body.jobId);
  const runB = await app.post('/api/capabilities/run', { id: 'evidence-gap-brief', input: inputB });
  assert.equal(runB.status, 201);
  await app.wait(runB.body.jobId);

  // 4) growth grade reflects the real evidence just produced - not a claim.
  const stateAfterRuns = await app.get('/api/state');
  const graded = stateAfterRuns.body.growth.capabilities.skills.find(skill => skill.id === 'evidence-gap-brief');
  assert.equal(graded.grade, 'C', JSON.stringify(graded));
  assert.equal(graded.evidence.distinctInputCount, 2);
  const untouched = stateAfterRuns.body.growth.capabilities.skills.find(skill => skill.id === 'failure-triage');
  assert.equal(untouched.grade, 'E', 'a capability nobody actually ran stays at E, even sitting in the same registry');

  // 5) an owner-reported outcome attaches to the real artifact from the quest Jarvis ran.
  const outcome = await app.post('/api/outcomes', { questId: quest.id, ledger: 'honor', summary: '연호님이 결과를 확인했다고 보고', artifactId, value: 1, unit: '건' });
  assert.equal(outcome.status, 201);
  assert.equal(outcome.body.outcome.verification, 'self_reported');

  // 6) app closed and reopened - goal, skill, grade, and outcome all persist.
  await app.restart();
  const afterRestart = await app.get('/api/state');
  const questAfterRestart = afterRestart.body.jobs.find(j => j.id === questJobId);
  assert.equal(questAfterRestart.status, 'completed');
  const gradedAfterRestart = afterRestart.body.growth.capabilities.skills.find(skill => skill.id === 'evidence-gap-brief');
  assert.equal(gradedAfterRestart.grade, 'C');
  const questsAfterRestart = await app.get('/api/quests');
  assert.equal(questsAfterRestart.body.quests.find(q => q.id === quest.id).status, 'completed');
  assert.equal(questsAfterRestart.body.ledgers.honor.records.length, 1);
});

test('with no proposed quest on file, the voice decide phrase falls through honestly instead of fabricating a choice', async t => {
  const app = await setup(t);
  const result = await app.post('/api/voice', { text: '지금 가장 먼저 해야 할 일을 정해줘', history: [] });
  assert.equal(result.status, 201);
  assert.equal(result.body.decision, undefined, 'falls through to the normal conversational job, not a fabricated decision');
  assert.ok(result.body.jobId);
});
