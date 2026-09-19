import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {start} from '../server.mjs';
import {openStore} from '../lib/store.mjs';
import {planShadowMission, ShadowArmyError, missionsForQuest} from '../lib/shadow-army.mjs';

const OWNER_ENV = {};
const timestamp = '2026-09-20T00:00:00.000Z';

async function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-jarvis-shadow-'));
  const token = 'synthetic-jarvis-shadow-owner-token';
  let runtime = await start({host: '127.0.0.1', port: 0, dataDir: dir, token, env: OWNER_ENV});
  const request = async (method, route, body) => {
    const response = await fetch(`http://127.0.0.1:${runtime.server.address().port}${route}`, {
      method,
      headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
      ...(body ? {body: JSON.stringify(body)} : {}),
    });
    return {status: response.status, body: await response.json()};
  };
  const post = (route, body = {}) => request('POST', route, {requestId: randomUUID(), ...body});
  const get = route => request('GET', route);
  const restart = async () => {
    runtime.shutdown();
    runtime = await start({host: '127.0.0.1', port: 0, dataDir: dir, token, env: OWNER_ENV});
  };
  t.after(() => { runtime.shutdown(); fs.rmSync(dir, {recursive: true, force: true}); });
  return {post, get, restart, disk: () => openStore(dir).state};
}

async function createProject(h) {
  const response = await h.post('/api/projects', {
    name: `Jarvis bridge project ${randomUUID().slice(0, 8)}`,
    status: 'active',
    summary: 'A real project selected by the owner.',
    nextAction: 'Connect the planned goal to a Shadow mission.',
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.project;
}

test('planShadowMission derives a real mission from one existing proposed Quest and keeps the planner link in every Shadow record', () => {
  const projectId = '11111111-1111-4111-8111-111111111111';
  const questId = '22222222-2222-4222-8222-222222222222';
  const state = {
    emergencyStop: false,
    projects: [{id: projectId, name: 'P', status: 'active', version: 1}],
    quests: [{id: questId, status: 'proposed', jobId: null, projectId, goal: '실제 목표', successCriterion: '산출물과 근거', driveId: 'wrath'}],
    jobs: [],
  };
  const plan = planShadowMission(state, {questId});
  assert.equal(plan.plannerQuestId, questId);
  assert.equal(plan.specs.every(spec => spec.plannerQuestId === questId), true);
  assert.equal(plan.specs.every(spec => spec.projectId === projectId), true);
  assert.equal(plan.specs[0].goal, '실제 목표');
  assert.equal(plan.specs[0].successCriterion, '산출물과 근거');
  assert.throws(() => planShadowMission(state, {questId, goal: '다른 목표'}), ShadowArmyError);
});

test('POST /api/shadow-army/missions links Jarvis Quest -> real Shadow Army, blocks duplicate planning, survives restart, and prevents generic duplicate decision', async t => {
  const h = await setup(t);
  const project = await createProject(h);
  const questResponse = await h.post('/api/quests', {
    goal: '가장 중요한 프로젝트 산출물을 만든다',
    driveId: 'pride',
    provider: 'auto',
    projectId: project.id,
    successCriterion: '실제 산출물과 검증 근거를 남긴다',
    baseline: '기준값 미측정',
  });
  assert.equal(questResponse.status, 201, JSON.stringify(questResponse.body));
  const quest = questResponse.body.quest;

  const missionResponse = await h.post('/api/shadow-army/missions', {questId: quest.id});
  assert.equal(missionResponse.status, 201, JSON.stringify(missionResponse.body));
  const mission = missionResponse.body.mission;
  assert.equal(missionResponse.body.plannerQuestId, quest.id);
  assert.equal(mission.plannerQuestId, quest.id);
  assert.equal(mission.projectId, project.id);
  assert.equal(mission.shadows.length, 3);
  assert.equal(mission.shadows.every(shadow => shadow.dependsOnJobIds.every(id => typeof id === 'string')), true);

  const linked = await h.get(`/api/quests/${quest.id}/shadow-missions`);
  assert.equal(linked.status, 200, JSON.stringify(linked.body));
  assert.equal(linked.body.questId, quest.id);
  assert.equal(linked.body.missions.length, 1);
  assert.equal(linked.body.missions[0].plannerQuestId, quest.id);

  const duplicate = await h.post('/api/shadow-army/missions', {questId: quest.id});
  assert.equal(duplicate.status, 409, JSON.stringify(duplicate.body));

  const genericDecision = await h.post('/api/quests/decide');
  assert.equal(genericDecision.status, 409, 'a Quest already connected to a live Shadow mission must not launch a second generic job');

  const before = h.disk().jobs.filter(job => job.shadowAssignment?.plannerQuestId === quest.id);
  assert.equal(before.length, 4);
  await h.restart();
  const after = h.disk().jobs.filter(job => job.shadowAssignment?.plannerQuestId === quest.id);
  assert.equal(after.length, 4, 'restart keeps the same four linked real jobs');
  assert.equal(new Set(after.map(job => job.shadowAssignment.plannerQuestId)).size, 1);
  const linkedAfterRestart = await h.get(`/api/quests/${quest.id}/shadow-missions`);
  assert.equal(linkedAfterRestart.status, 200);
  const beforeShape = mission => ({
    missionId: mission.missionId,
    projectId: mission.projectId,
    plannerQuestId: mission.plannerQuestId,
    shadows: mission.shadows.map(shadow => ({jobId: shadow.jobId, role: shadow.role, dependsOnJobIds: shadow.dependsOnJobIds})),
    verifyJobId: mission.verify?.jobId ?? null,
  });
  assert.deepEqual(beforeShape(linkedAfterRestart.body.missions[0]), beforeShape(linked.body.missions[0]));
  assert.deepEqual(beforeShape(missionsForQuest(quest.id, h.disk())[0]), beforeShape(linked.body.missions[0]));
});

test('a Quest without an existing project cannot be promoted into a Shadow mission', async t => {
  const h = await setup(t);
  const questResponse = await h.post('/api/quests', {
    goal: '프로젝트 없는 목표',
    driveId: 'sloth',
    provider: 'auto',
    successCriterion: '정직한 결과',
    baseline: '기준값 미측정',
  });
  assert.equal(questResponse.status, 201, JSON.stringify(questResponse.body));
  const response = await h.post('/api/shadow-army/missions', {questId: questResponse.body.quest.id});
  assert.equal(response.status, 409, JSON.stringify(response.body));
});
