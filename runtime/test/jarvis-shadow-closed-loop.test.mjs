import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {start} from '../server.mjs';
import {openStore} from '../lib/store.mjs';
import {missionStatus} from '../lib/shadow-army.mjs';

// BLACKHOLE CONTINUOUS EXECUTION DIRECTIVE v1, STAGE 3 (Jarvis-Shadow closed
// loop): "블랙홀, 지금 내가 해야 할 가장 중요한 일을 알아서 진행해" must reach
// goal->quest->Shadow mission->Scout/Researcher/Builder->deterministic
// verify->semantic verify->artifact save->Memory Event save->replan for a
// real project-linked quest - not just a single generic job. This reuses the
// exact same server.mjs::dispatchShadowMission() mechanics
// POST /api/shadow-army/missions already used (shadow-army.test.mjs proves
// the pipeline itself); this file proves decide.mjs's own winning-candidate
// path now reaches that pipeline instead of stopping at a single job, and
// that the loop correctly replans onto the next real goal afterward instead
// of re-selecting a quest whose mission has already completed. No second
// execution engine is introduced. Same synthetic-transport convention as
// shadow-army.test.mjs / phone-acceptance.test.mjs - no real provider keys.
const MODEL_ENV = {YENO_AGENT_PROVIDER: 'openai', YENO_OPENAI_API_KEY: 'synthetic-openai-key', YENO_OPENAI_MODEL: 'synthetic-openai', YENO_AGENT_DAILY_CALL_LIMIT: '20'};
const ok = text => new Response(JSON.stringify({choices: [{finish_reason: 'stop', message: {content: text, tool_calls: []}}], usage: {prompt_tokens: 30, completion_tokens: 20}}), {headers: {'Content-Type': 'application/json'}});
const SEMANTIC_PASS_VERDICT = JSON.stringify({verdict: 'pass', confidence: 0.9, criteria: [{criterion: '목표 충족', status: 'met', reason: '산출물이 목표와 성공 기준을 실제로 다룸', evidenceRefs: ['builder-artifact']}], summary: '목표를 실제로 달성함'});

async function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-jarvis-shadow-loop-')), token = 'synthetic-jarvis-shadow-loop-owner-token';
  const agentFetch = async (url, req) => {
    const isSemantic = JSON.parse(req.body).messages.some(m => typeof m.content === 'string' && m.content.includes('independent semantic verifier'));
    return ok(isSemantic ? SEMANTIC_PASS_VERDICT : '실제 Shadow 산출물 본문');
  };
  const seed = openStore(dir); seed.state.modules.ai = true; seed.save();
  let runtime = await start({host: '127.0.0.1', port: 0, dataDir: dir, token, env: MODEL_ENV, agentFetch});
  const request = async (method, route, body) => { const r = await fetch(`http://127.0.0.1:${runtime.server.address().port}${route}`, {method, headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}, ...(body ? {body: JSON.stringify(body)} : {})}); return {status: r.status, body: await r.json()}; };
  const post = (route, body = {}) => request('POST', route, {requestId: randomUUID(), ...body});
  const get = route => request('GET', route);
  const wait = async (id, statuses = ['completed', 'failed']) => { for (let i = 0; i < 400; i++) { const j = openStore(dir).state.jobs.find(j => j.id === id); if (j && statuses.includes(j.status)) return j; await new Promise(r => setTimeout(r, 20)); } assert.fail('job did not reach target state'); };
  const restart = async () => { runtime.shutdown(); runtime = await start({host: '127.0.0.1', port: 0, dataDir: dir, token, env: MODEL_ENV, agentFetch}); };
  t.after(() => { runtime.shutdown(); fs.rmSync(dir, {recursive: true, force: true}); });
  return {post, get, wait, restart, disk: () => openStore(dir).state};
}

async function createProject(h) {
  const r = await h.post('/api/projects', {name: `Jarvis 닫힌고리 ${randomUUID().slice(0, 8)}`, status: 'active'});
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.project;
}

test('"정해줘" promotes a project-linked winning quest into a real Shadow Army mission, runs it to a verified completion, and replans onto the next real goal', async t => {
  const h = await setup(t);
  const project = await createProject(h);

  const projectQuest = await h.post('/api/quests', {goal: '가장 시급한 프로젝트 산출물을 완성한다', projectId: project.id, successCriterion: '실제 산출물과 검증 근거를 남긴다', baseline: '기준값 미측정'});
  assert.equal(projectQuest.status, 201, JSON.stringify(projectQuest.body));
  const plainQuest = await h.post('/api/quests', {goal: '지난달 기록을 다시 정리한다', successCriterion: '이미 확인된 수치를 표로 다시 정리한다.', baseline: '지난달 방문자 120명, 이미 집계 완료'});
  assert.equal(plainQuest.status, 201);

  // Homunculus must pick the real larger-gap (no-baseline) project quest
  // first, and dispatch it as a Shadow Army mission - not a single job.
  const decided = await h.post('/api/voice', {text: '지금 가장 먼저 해야 할 일을 알아서 진행해', history: []});
  assert.equal(decided.status, 201, JSON.stringify(decided.body));
  assert.equal(decided.body.decision.goal, projectQuest.body.quest.goal);
  assert.ok(decided.body.missionId, 'a project-linked winning quest must dispatch a real Shadow Army mission, not a plain job');
  assert.equal(decided.body.job, undefined, 'no single generic job is created for a Shadow-Army-eligible quest');
  assert.equal(decided.body.mission.plannerQuestId, projectQuest.body.quest.id);
  const {missionId} = decided.body;

  // Homunculus Heartbeat's Core (Stage 2, reused here unchanged) now shows
  // the *other* real proposed quest as "current": decide.mjs's own
  // hasReusableShadowMission filtering already excludes the quest whose
  // mission is live from candidacy, so the dispatched quest correctly stops
  // being "next to decide" the instant its mission starts.
  const coreWhileRunning = await h.get('/api/core');
  assert.equal(coreWhileRunning.body.currentQuest.id, plainQuest.body.quest.id);

  const mission = missionStatus(missionId, h.disk());
  const scout = mission.shadows.find(s => s.role === 'scout'), researcher = mission.shadows.find(s => s.role === 'researcher'), builder = mission.shadows.find(s => s.role === 'builder');
  await h.wait(scout.jobId); await h.wait(researcher.jobId);
  const builderJob = await h.wait(builder.jobId);
  assert.equal(builderJob.status, 'completed', builderJob.error);
  const verifyJob = await h.wait(mission.verify.jobId);
  assert.equal(verifyJob.status, 'completed');
  assert.equal(verifyJob.verifyResult.verified, true);
  const semanticJob = await h.wait(mission.semantic.jobId);
  assert.equal(semanticJob.status, 'completed', semanticJob.error);
  assert.equal(semanticJob.semanticVerdict.verdict, 'pass');

  const finalMission = missionStatus(missionId, h.disk());
  assert.equal(finalMission.phase, 'completed');
  const updatedProject = h.disk().projects.find(p => p.id === project.id);
  assert.ok(updatedProject.milestones.some(m => m.completed && m.text.includes(missionId.slice(0, 8))), 'a real completed milestone must reference this mission');
  const memoryEvent = h.disk().memoryEvents.find(e => e.sourceRefs.some(ref => ref.type === 'job' && ref.id === semanticJob.id));
  assert.ok(memoryEvent, 'a real canonical memory event must reference the real semantic verifier job');

  // Replan: with the project quest's mission fully verified-complete, the
  // next real "정해줘" must move on to the other real proposed goal - never
  // re-dispatch a second mission/job for the one just finished.
  const replanned = await h.post('/api/quests/decide');
  assert.equal(replanned.status, 201, JSON.stringify(replanned.body));
  assert.equal(replanned.body.decision.top.questId, plainQuest.body.quest.id, 'replan must pick the remaining real goal, not repeat the completed one');
  assert.equal(replanned.body.kind, 'job', 'the remaining quest has no project - it keeps the existing single-job path');

  // Restart: the completed mission, milestone and memory event all survive
  // exactly. Both real quests are now dispatched (one mission, one plain
  // job) and neither is 'proposed' any more, so Homunculus honestly has
  // nothing left to decide - currentQuest is null, never re-derived or
  // fabricated as still-pending work.
  await h.restart();
  const afterRestart = missionStatus(missionId, h.disk());
  assert.equal(afterRestart.phase, 'completed');
  const coreAfterRestart = await h.get('/api/core');
  assert.equal(coreAfterRestart.body.currentQuest, null);
});

test('a project-linked quest already connected to a live Shadow mission is never double-dispatched by "정해줘"', async t => {
  const h = await setup(t);
  const project = await createProject(h);
  const quest = await h.post('/api/quests', {goal: '유일한 프로젝트 목표', projectId: project.id, successCriterion: '실제 산출물', baseline: '기준값 미측정'});
  assert.equal(quest.status, 201);

  const first = await h.post('/api/quests/decide');
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.ok(first.body.missionId);

  // Nothing else is proposed, and the quest's live mission already covers
  // it - decide.mjs must honestly report nothing left to decide, never spin
  // up a second mission for the same goal.
  const second = await h.post('/api/quests/decide');
  assert.equal(second.status, 409, JSON.stringify(second.body));
  const missionsForQuest = await h.get(`/api/quests/${quest.body.quest.id}/shadow-missions`);
  assert.equal(missionsForQuest.body.missions.length, 1, 'exactly one mission must exist for this quest, never a duplicate');
});
