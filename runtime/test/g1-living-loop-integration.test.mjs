import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {start} from '../server.mjs';
import {openStore} from '../lib/store.mjs';
import {missionStatus} from '../lib/shadow-army.mjs';

// G1 gate — ONE mission, ONE set of ids, end to end:
//   natural-language command -> Homunculus decision (Seven Drives) ->
//   Jarvis promotes the project quest into a real Shadow Army mission ->
//   scout/researcher/builder -> deterministic verify -> independent semantic
//   verify -> project milestone + canonical memory event + sync outbox +
//   Shadow XP -> Living Core (Home) verifiedResult/active shadows ->
//   server restart re-reads the same evidence with the same ids.
// Synthetic transport only (no provider key, no real device): this proves
// the wiring is one loop, not that a live model or a phone was used.
const MODEL_ENV = {YENO_AGENT_PROVIDER: 'openai', YENO_OPENAI_API_KEY: 'synthetic-openai-key', YENO_OPENAI_MODEL: 'synthetic-openai', YENO_AGENT_DAILY_CALL_LIMIT: '20'};
const ok = text => new Response(JSON.stringify({choices: [{finish_reason: 'stop', message: {content: text, tool_calls: []}}], usage: {prompt_tokens: 30, completion_tokens: 20}}), {headers: {'Content-Type': 'application/json'}});
const SEMANTIC_FAIL = JSON.stringify({verdict: 'fail', confidence: 0.8, criteria: [{criterion: '목표 충족', status: 'not_met', reason: '산출물이 성공 기준을 실제로 다루지 못함', evidenceRefs: ['builder-artifact']}], summary: '목표를 달성하지 못함'});
const SEMANTIC_PASS = JSON.stringify({verdict: 'pass', confidence: 0.9, criteria: [{criterion: '목표 충족', status: 'met', reason: '산출물이 목표와 성공 기준을 실제로 다룸', evidenceRefs: ['실제 Shadow 산출물 본문']}], summary: '목표를 실제로 달성함'});

async function setup(t, {semantic = SEMANTIC_PASS} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-g1-loop-')), token = 'synthetic-g1-owner-token';
  const vault = path.join(dir, 'vault'); fs.mkdirSync(vault);
  const env = {...MODEL_ENV, YENO_OBSIDIAN_EXPORT_ENABLED: 'true', YENO_OBSIDIAN_VAULT_PATH: vault};
  const agentFetch = async (url, req) => {
    const isSemantic = JSON.parse(req.body).messages.some(m => typeof m.content === 'string' && m.content.includes('independent semantic verifier'));
    return ok(isSemantic ? semantic : '실제 Shadow 산출물 본문');
  };
  const seed = openStore(dir); seed.state.modules.ai = true; seed.save();
  let runtime = await start({host: '127.0.0.1', port: 0, dataDir: dir, token, env, agentFetch});
  const request = async (method, route, body) => { const r = await fetch(`http://127.0.0.1:${runtime.server.address().port}${route}`, {method, headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}, ...(body ? {body: JSON.stringify(body)} : {})}); return {status: r.status, body: await r.json()}; };
  const post = (route, body = {}) => request('POST', route, {requestId: randomUUID(), ...body});
  const get = route => request('GET', route);
  const wait = async (id, statuses = ['completed', 'failed']) => { for (let i = 0; i < 400; i++) { const j = openStore(dir).state.jobs.find(j => j.id === id); if (j && statuses.includes(j.status)) return j; await new Promise(r => setTimeout(r, 20)); } assert.fail(`job ${id} did not reach ${statuses}`); };
  const restart = async () => { runtime.shutdown(); runtime = await start({host: '127.0.0.1', port: 0, dataDir: dir, token, env, agentFetch}); };
  t.after(() => { runtime.shutdown(); fs.rmSync(dir, {recursive: true, force: true}); });
  return {post, get, wait, restart, disk: () => openStore(dir).state};
}

test('G1: one natural-language command runs the whole Living Loop with one set of ids and the evidence survives restart', async t => {
  const h = await setup(t);
  const project = (await h.post('/api/projects', {name: `G1 프로젝트 ${randomUUID().slice(0, 8)}`, status: 'active'})).body.project;
  const quest = (await h.post('/api/quests', {goal: '가장 시급한 프로젝트 산출물을 완성한다', projectId: project.id, successCriterion: '실제 산출물과 검증 근거를 남긴다', baseline: '산출물 0개'})).body.quest;
  assert.ok(quest?.id, 'quest saved');

  // 1) command -> Homunculus decision -> Jarvis -> real Shadow mission
  const decided = await h.post('/api/voice', {text: '지금 가장 먼저 해야 할 일을 알아서 진행해', history: []});
  assert.equal(decided.status, 201, JSON.stringify(decided.body));
  const missionId = decided.body.missionId;
  assert.ok(missionId, 'the decision produced a real Shadow Army mission id');
  assert.equal(decided.body.decision.goal, quest.goal);
  const mission = decided.body.mission;
  const builderJobId = mission.shadows.find(s => s.role === 'builder').jobId;

  // 2) while the mission runs, Home counts real Shadow jobs (F03)
  let sawActiveShadow = false;
  for (let i = 0; i < 100 && !sawActiveShadow; i++) { const core = (await h.get('/api/core')).body; if (core.activeShadowCount > 0) sawActiveShadow = true; else await new Promise(r => setTimeout(r, 20)); }
  assert.ok(sawActiveShadow, 'Living Core saw at least one running Shadow job during the mission');

  // 3) roles -> deterministic verify -> semantic verify
  assert.equal((await h.wait(builderJobId)).status, 'completed');
  assert.equal((await h.wait(mission.verify.jobId)).status, 'completed');
  const semanticJob = await h.wait(mission.semantic.jobId);
  assert.equal(semanticJob.status, 'completed', semanticJob.error);
  assert.equal(semanticJob.semanticVerdict.verdict, 'pass');
  assert.equal(semanticJob.semanticVerdict.missionId, missionId);
  assert.equal(missionStatus(missionId, h.disk()).phase, 'completed');

  // 4) same ids: milestone, canonical memory event, outbox, growth
  const state = h.disk();
  const milestones = state.projects.find(p => p.id === project.id).milestones.filter(m => m.text.includes(missionId.slice(0, 8)));
  assert.equal(milestones.length, 1); assert.equal(milestones[0].completed, true);
  const events = state.memoryEvents.filter(e => e.type === 'result' && e.sourceRefs.some(r => r.type === 'job' && r.id === semanticJob.id));
  assert.equal(events.length, 1, 'exactly one canonical memory event for this verdict');
  assert.match(events[0].text, new RegExp(missionId));
  assert.deepEqual(state.memorySyncOutbox.filter(i => i.eventId === events[0].id).map(i => i.destination), ['obsidian']);
  const growth = (await h.get('/api/state')).body.growth.shadow;
  const builderEvents = growth.events.filter(e => e.missionId === missionId && e.role === 'builder');
  assert.equal(builderEvents.length, 1); assert.equal(builderEvents[0].jobId, builderJobId); assert.equal(builderEvents[0].status, 'valid');
  assert.equal(growth.roles.find(r => r.role === 'builder').xp, 20);

  // 5) Home shows the verified result for THIS mission (F04) and the quest is no longer live
  const core = (await h.get('/api/core')).body;
  assert.equal(core.verifiedResult?.missionId, missionId);
  assert.equal(core.verifiedResult?.semanticJobId, semanticJob.id);
  assert.equal(core.verifiedResult?.builderJobId, builderJobId);
  assert.equal(core.verifiedResult?.artifactSha256, state.artifacts[core.verifiedResult.artifactId].sha256);
  assert.equal(core.activeShadowCount, 0, 'nothing is running once the mission completed');

  // 6) restart: identical evidence, no duplicate side effects, no re-run
  await h.restart();
  await new Promise(r => setTimeout(r, 600));
  const after = h.disk();
  assert.equal(after.projects.find(p => p.id === project.id).milestones.filter(m => m.text.includes(missionId.slice(0, 8))).length, 1);
  assert.equal(after.memoryEvents.filter(e => e.sourceRefs.some(r => r.id === semanticJob.id)).length, 1);
  assert.equal(after.memorySyncOutbox.filter(i => i.eventId === events[0].id).length, 1);
  assert.equal(after.jobs.find(j => j.id === semanticJob.id).status, 'completed');
  const coreAfter = (await h.get('/api/core')).body;
  assert.deepEqual(coreAfter.verifiedResult, core.verifiedResult);
  assert.deepEqual((await h.get('/api/state')).body.growth.shadow.roles, growth.roles);
});

test('G1 negative: a semantic FAIL leaves no milestone, no result memory, no outbox item, no XP and no verifiedResult', async t => {
  const h = await setup(t, {semantic: SEMANTIC_FAIL});
  const project = (await h.post('/api/projects', {name: `G1 실패 ${randomUUID().slice(0, 8)}`, status: 'active'})).body.project;
  const quest = (await h.post('/api/quests', {goal: '실패해야 하는 산출물', projectId: project.id, successCriterion: '검증 가능한 결과물 1개', baseline: '없음'})).body.quest;
  assert.ok(quest?.id);
  const decided = await h.post('/api/voice', {text: '지금 가장 먼저 해야 할 일을 알아서 진행해', history: []});
  assert.equal(decided.status, 201, JSON.stringify(decided.body));
  const mission = decided.body.mission, missionId = decided.body.missionId;
  await h.wait(mission.shadows.find(s => s.role === 'builder').jobId);
  assert.equal((await h.wait(mission.verify.jobId)).status, 'completed', 'deterministic integrity check passes on the synthetic artifact');
  const semantic = await h.wait(mission.semantic.jobId);
  assert.equal(semantic.status, 'failed', 'semantic FAIL is a failed verifier job, never completed');
  assert.equal(semantic.semanticVerdict.verdict, 'fail');
  assert.notEqual(missionStatus(missionId, h.disk()).phase, 'completed');
  const state = h.disk();
  assert.equal(state.projects.find(p => p.id === project.id).milestones.filter(m => m.text.includes(missionId.slice(0, 8))).length, 0);
  assert.equal(state.memoryEvents.filter(e => e.type === 'result').length, 0);
  assert.equal(state.memorySyncOutbox.length, 0);
  const growth = (await h.get('/api/state')).body.growth.shadow;
  assert.ok(growth.roles.every(r => r.xp === 0), 'no XP from a failed mission');
  assert.equal(growth.roles.find(r => r.role === 'builder').failedMissions, 1, 'the failure is recorded, not hidden');
  assert.equal((await h.get('/api/core')).body.verifiedResult, null);
});
