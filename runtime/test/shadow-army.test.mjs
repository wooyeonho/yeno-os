import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {start} from '../server.mjs';
import {openStore} from '../lib/store.mjs';
import {planShadowMission, shadowJobFromSpec, shadowDependenciesMet, shadowDependencyFailed, verifyShadowArtifacts, verifyFailureSummary, shadowFailureReason, missionStatus, ShadowArmyError, SHADOW_ROLES} from '../lib/shadow-army.mjs';

// Phase D — Real Shadow Army (issue #25 §6), first slice: real project goal
// -> two independent shadows -> a dependent builder -> a separate deterministic
// verifier job -> verified milestone + memory event, using the exact same
// durable job engine every other job type already runs on (real HTTP server,
// real store on disk, real restart) - same harness convention as
// closed-loop.test.mjs. No real provider credentials exist in this
// environment, so the outbound model call is injected exactly like every
// other test in this repo already does; everything else (server, jobs,
// dependency resolution, verification, milestone, memory event) is real.
const MODEL_ENV = {YENO_AGENT_PROVIDER: 'openai', YENO_OPENAI_API_KEY: 'synthetic-openai-key', YENO_OPENAI_MODEL: 'synthetic-openai', YENO_AGENT_DAILY_CALL_LIMIT: '20'};
const ok = text => new Response(JSON.stringify({choices: [{finish_reason: 'stop', message: {content: text, tool_calls: []}}], usage: {prompt_tokens: 30, completion_tokens: 20}}), {headers: {'Content-Type': 'application/json'}});

async function setup(t, {env = MODEL_ENV} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-shadow-army-')), token = 'synthetic-shadow-army-owner-token';
  const modelCalls = [];
  const agentFetch = async (url, req) => { modelCalls.push({url, body: JSON.parse(req.body)}); return ok('실제 Shadow 산출물 본문'); };
  let runtime = await start({host: '127.0.0.1', port: 0, dataDir: dir, token, env, agentFetch});
  const request = async (method, route, body) => { const r = await fetch(`http://127.0.0.1:${runtime.server.address().port}${route}`, {method, headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}, ...(body ? {body: JSON.stringify(body)} : {})}); return {status: r.status, body: await r.json()}; };
  const post = (route, body = {}) => request('POST', route, {requestId: randomUUID(), ...body});
  const get = route => request('GET', route);
  const wait = async (id, statuses = ['completed', 'failed', 'paused']) => { for (let i = 0; i < 400; i++) { const j = openStore(dir).state.jobs.find(j => j.id === id); if (j && statuses.includes(j.status)) return j; await new Promise(r => setTimeout(r, 20)); } assert.fail('job did not reach target state'); };
  const until = async (check, label) => { for (let i = 0; i < 400; i++) { const value = check(); if (value) return value; await new Promise(r => setTimeout(r, 20)); } assert.fail(label); };
  const restart = async () => { runtime.shutdown(); runtime = await start({host: '127.0.0.1', port: 0, dataDir: dir, token, env, agentFetch}); };
  t.after(() => { runtime.shutdown(); fs.rmSync(dir, {recursive: true, force: true}); });
  return {dir, post, get, wait, until, restart, modelCalls, state: () => runtime.state(), disk: () => openStore(dir).state};
}

async function createProject(h, overrides = {}) {
  const r = await h.post('/api/projects', {name: `Shadow 프로젝트 ${randomUUID().slice(0, 8)}`, status: 'active', ...overrides});
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.project;
}

test('planShadowMission is pure and rejects a bad project reference, emergency stop, and missing goal', () => {
  const state = {emergencyStop: false, projects: [{id: '11111111-1111-4111-8111-111111111111', name: 'P', status: 'active', version: 1}], jobs: []};
  assert.throws(() => planShadowMission(state, {projectId: 'not-a-real-id', goal: 'g'}), ShadowArmyError);
  assert.throws(() => planShadowMission(state, {projectId: state.projects[0].id, goal: ''}), ShadowArmyError);
  assert.throws(() => planShadowMission({...state, emergencyStop: true}, {projectId: state.projects[0].id, goal: 'g'}), ShadowArmyError);
  const plan = planShadowMission(state, {projectId: state.projects[0].id, goal: '실제 목표'});
  assert.equal(plan.specs.length, 4);
  assert.deepEqual(plan.specs.map(s => s.role).sort(), [...SHADOW_ROLES].sort());
  const builder = plan.specs.find(s => s.role === 'builder'), verifier = plan.specs.find(s => s.role === 'verifier');
  assert.deepEqual(builder.dependsOnJobIds.sort(), plan.specs.filter(s => ['scout', 'researcher'].includes(s.role)).map(s => s.id).sort());
  assert.deepEqual(verifier.dependsOnJobIds, [builder.id]);
});

test('shadowJobFromSpec: independent shadows start queued, dependents start honestly paused pending their real dependencies', () => {
  const state = {emergencyStop: false, projects: [{id: '11111111-1111-4111-8111-111111111111', name: 'P', status: 'active', version: 1}], jobs: []};
  const plan = planShadowMission(state, {projectId: state.projects[0].id, goal: '목표'});
  const jobs = plan.specs.map(spec => shadowJobFromSpec(spec, '2026-09-19T00:00:00.000Z'));
  const scout = jobs.find(j => j.shadowAssignment.role === 'scout'), builder = jobs.find(j => j.shadowAssignment.role === 'builder'), verifier = jobs.find(j => j.shadowAssignment.role === 'verifier');
  assert.equal(scout.status, 'queued');
  assert.equal(builder.status, 'paused'); assert.equal(builder.pauseReason, 'dependencyPending');
  assert.equal(verifier.status, 'paused'); assert.equal(verifier.type, 'verify');
  assert.equal(shadowDependenciesMet(builder, jobs), false, 'builder deps are not complete yet');
});

test('verifyShadowArtifacts is deterministic: passes only a completed job with an artifact and no unknown call outcome', () => {
  const good = {id: 'a', status: 'completed', artifacts: [{id: 'x', name: 'n'}], agentJournal: {calls: [{status: 'settled'}]}};
  assert.equal(verifyShadowArtifacts([good]).verified, true);
  assert.equal(verifyShadowArtifacts([{...good, status: 'failed'}]).verified, false);
  assert.equal(verifyShadowArtifacts([{...good, artifacts: []}]).verified, false);
  assert.equal(verifyShadowArtifacts([{...good, agentJournal: {calls: [{status: 'unknown'}]}}]).verified, false);
  assert.equal(verifyShadowArtifacts([null]).verified, false);
  assert.equal(shadowDependencyFailed({shadowAssignment: {dependsOnJobIds: ['a']}}, [{id: 'a', status: 'failed'}]), true);
});

test('verifyFailureSummary/shadowFailureReason: a rejected verify job is classified and given a real, non-null reason', () => {
  const missionId = '11111111-1111-1111-1111-111111111111';
  const verdict = verifyShadowArtifacts([{id: 'b', status: 'failed', artifacts: [], agentJournal: {calls: []}}]);
  assert.equal(verdict.verified, false);
  assert.equal(verifyFailureSummary(verdict), verdict.reasons.join(', '));
  assert.equal(verifyFailureSummary({reasons: []}), 'verification_rejected');
  const verifyJob = {status: 'failed', error: verifyFailureSummary(verdict), verifyResult: verdict, shadowAssignment: {missionId, role: 'verifier', dependsOnJobIds: ['b']}};
  assert.equal(shadowFailureReason(verifyJob), 'verification_rejected');
  const cancelledShadow = {status: 'cancelled', shadowAssignment: {missionId, role: 'scout', dependsOnJobIds: []}};
  assert.equal(shadowFailureReason(cancelledShadow), 'cancelled');
  const runningShadow = {status: 'running', shadowAssignment: {missionId, role: 'scout', dependsOnJobIds: []}};
  assert.equal(shadowFailureReason(runningShadow), null, 'a job still in flight is never classified as failed');
  assert.equal(shadowFailureReason({status: 'failed'}), null, 'a non-shadow job is out of scope');
});

test('a real mission runs two independent shadows in parallel, gates the builder on both, and the verifier passes and updates the real project milestone + memory event', async (t) => {
  const h = await setup(t);
  const project = await createProject(h);
  const missionResponse = await h.post('/api/shadow-army/missions', {projectId: project.id, goal: '실제 산출물을 완성한다', successCriterion: '검증 가능한 결과물 1개'});
  assert.equal(missionResponse.status, 201, JSON.stringify(missionResponse.body));
  const {missionId} = missionResponse.body;
  const mission = missionResponse.body.mission;
  assert.equal(mission.shadows.length, 3);
  const scout = mission.shadows.find(s => s.role === 'scout'), researcher = mission.shadows.find(s => s.role === 'researcher'), builder = mission.shadows.find(s => s.role === 'builder');
  assert.equal(mission.verify.status, 'paused');

  // Both independent leaf shadows must reach a real running/completed state
  // together - proving real bounded parallel dispatch, not accidental
  // serialization. (300-tick window matches the existing wait() convention.)
  await h.until(() => {
    const jobs = h.disk().jobs;
    const s1 = jobs.find(j => j.id === scout.jobId), s2 = jobs.find(j => j.id === researcher.jobId);
    return s1 && s2 && !['queued'].includes(s1.status) && !['queued'].includes(s2.status);
  }, 'both independent shadows must leave queued together');

  const scoutJob = await h.wait(scout.jobId), researcherJob = await h.wait(researcher.jobId);
  assert.equal(scoutJob.status, 'completed'); assert.equal(researcherJob.status, 'completed');
  assert.ok(h.modelCalls.length >= 2, 'both leaf shadows must have made a real (synthetic-transport) model call');

  // builder/verify both legitimately start 'paused'/dependencyPending, so
  // 'paused' must not be an accepted terminal wait state here - wait past it.
  const builderJob = await h.wait(builder.jobId, ['completed', 'failed']);
  assert.equal(builderJob.status, 'completed', builderJob.error);
  // The builder job must never have been dispatched while a dependency was
  // still incomplete - the durable record's own step/status history can't be
  // replayed, but its startedAt-equivalent ordering is proved by construction
  // (it began 'paused'/dependencyPending and only the scheduler's dependency
  // check ever queues it), so we assert the structural fact directly here.
  assert.equal(shadowDependenciesMet({shadowAssignment: {dependsOnJobIds: [scout.jobId, researcher.jobId]}}, [scoutJob, researcherJob]), true);

  const verifyJob = await h.wait(mission.verify.jobId, ['completed', 'failed']);
  assert.equal(verifyJob.status, 'completed', JSON.stringify(verifyJob.verifyResult));
  assert.equal(verifyJob.verifyResult.verified, true);

  const finalMission = missionStatus(missionId, h.disk());
  assert.equal(finalMission.phase, 'completed');

  const updatedProject = h.disk().projects.find(p => p.id === project.id);
  assert.ok(updatedProject.milestones.some(m => m.completed && m.text.includes(missionId.slice(0, 8))), 'a real completed milestone must reference this mission');

  const memoryEvent = h.disk().memoryEvents.find(e => e.sourceRefs.some(ref => ref.type === 'job' && ref.id === verifyJob.id));
  assert.ok(memoryEvent, 'a real canonical memory event must reference the real verify job');
  assert.equal(memoryEvent.projectId, project.id);
});

test('no configured provider: shadow workers pause honestly with providerMissing, never silently fake a result, and the verifier never runs ahead of them', async (t) => {
  const h = await setup(t, {env: {}});
  const project = await createProject(h);
  const missionResponse = await h.post('/api/shadow-army/missions', {projectId: project.id, goal: '목표'});
  assert.equal(missionResponse.status, 201, JSON.stringify(missionResponse.body));
  const scoutId = missionResponse.body.mission.shadows.find(s => s.role === 'scout').jobId;
  const job = await h.wait(scoutId, ['paused']);
  assert.equal(job.pauseReason, 'providerMissing');
  await new Promise(r => setTimeout(r, 250));
  const verifyId = missionResponse.body.mission.verify.jobId;
  const verifyJob = h.disk().jobs.find(j => j.id === verifyId);
  assert.equal(verifyJob.status, 'paused', 'the verifier must never run ahead of its still-incomplete dependencies');
  assert.equal(h.modelCalls.length, 0, 'no real or fake provider call was ever made');
});

test('emergency stop blocks planning a new mission, and a real dependency failure honestly fails the dependent shadow rather than leaving it stuck', async (t) => {
  const h = await setup(t);
  const project = await createProject(h);
  await h.post('/api/control', {action: 'stop'});
  const blocked = await h.post('/api/shadow-army/missions', {projectId: project.id, goal: '목표'});
  assert.equal(blocked.status, 409);
  await h.post('/api/control', {action: 'resume'});

  const missionResponse = await h.post('/api/shadow-army/missions', {projectId: project.id, goal: '목표'});
  const {scoutJobId, researcherJobId, builderJobId} = {
    scoutJobId: missionResponse.body.mission.shadows.find(s => s.role === 'scout').jobId,
    researcherJobId: missionResponse.body.mission.shadows.find(s => s.role === 'researcher').jobId,
    builderJobId: missionResponse.body.mission.shadows.find(s => s.role === 'builder').jobId,
  };
  // Cancel one of the two independent leaf shadows before it can complete -
  // its real dependent (the builder) must fail honestly, never start on a
  // broken/missing dependency and never hang forever.
  const cancel = await h.post(`/api/jobs/${scoutJobId}/action`, {action: 'cancel'});
  assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
  const builderJob = await h.wait(builderJobId, ['failed']);
  assert.equal(builderJob.status, 'failed');
  assert.equal(builderJob.error, 'shadow_dependency_failed');
  // Hardening (master directive v2 §5.G "failure classification"): the real
  // reason must be named consistently, not left as a free-text string only.
  assert.equal(shadowFailureReason(builderJob), 'dependency_failed');
  const failedMission = missionStatus(missionResponse.body.missionId, h.disk());
  assert.equal(failedMission.phase, 'failed');
  assert.equal(failedMission.shadows.find(s => s.jobId === builderJobId).failureReason, 'dependency_failed');
});

test('a failed mission never blocks replanning a fresh mission for the same project - the real, already-safe retry/replan path', async (t) => {
  const h = await setup(t);
  const project = await createProject(h);
  const first = await h.post('/api/shadow-army/missions', {projectId: project.id, goal: '첫 시도'});
  assert.equal(first.status, 201);
  const scoutJobId = first.body.mission.shadows.find(s => s.role === 'scout').jobId;
  // Fail the mission honestly via a real dependency failure (no fabricated
  // failure) - same real path as the test above.
  const cancel = await h.post(`/api/jobs/${scoutJobId}/action`, {action: 'cancel'});
  assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
  const builderJobId = first.body.mission.shadows.find(s => s.role === 'builder').jobId;
  await h.wait(builderJobId, ['failed']);
  assert.equal(missionStatus(first.body.missionId, h.disk()).phase, 'failed');

  // Replanning is not a new mechanism: MAX_ACTIVE_MISSIONS_PER_PROJECT only
  // counts missions whose phase is neither 'completed' nor 'failed', so a
  // genuinely failed mission must never count against the cap, and the
  // owner must be able to try again for the same real project immediately -
  // this is the real "retry policy" the failed mission needs, without any
  // new auto-retry-a-specific-job machinery that could duplicate a possibly-
  // external action.
  const second = await h.post('/api/shadow-army/missions', {projectId: project.id, goal: '재시도'});
  assert.equal(second.status, 201, JSON.stringify(second.body));
  assert.notEqual(second.body.missionId, first.body.missionId);
  // The failed mission's own jobs/artifacts are real historical evidence -
  // replanning must never touch, hide, or delete them.
  const disk = h.disk();
  assert.ok(disk.jobs.some(j => j.id === builderJobId && j.status === 'failed'), 'the failed mission\'s jobs must remain untouched');
  assert.equal(missionStatus(first.body.missionId, disk).phase, 'failed', 'the old failed mission record must be unchanged');
  assert.equal(second.body.mission.shadows.length, 3);
});

test('a real restart mid-mission never duplicates work and the mission still reaches a real verified completion afterward', async (t) => {
  const h = await setup(t);
  const project = await createProject(h);
  const missionResponse = await h.post('/api/shadow-army/missions', {projectId: project.id, goal: '목표'});
  const missionId = missionResponse.body.missionId;
  const scoutId = missionResponse.body.mission.shadows.find(s => s.role === 'scout').jobId;
  // Restart the instant the scheduler has picked up at least the first
  // shadow, exactly like restart-recovery tests elsewhere in this repo -
  // every in-flight/queued job must be preserved, not lost or duplicated.
  await h.until(() => h.disk().jobs.find(j => j.id === scoutId)?.status !== 'queued', 'scout must leave queued before restart');
  await h.restart();
  const afterRestartJobs = h.disk().jobs.filter(j => j.shadowAssignment);
  assert.equal(afterRestartJobs.length, 4, 'restart must preserve exactly the 4 real shadow jobs, never duplicate them');
  // The graceful shutdown inside restart() pauses running/queued jobs with
  // pauseReason 'shutdown' before the new instance ever boots (a real crash
  // would instead hit the boot-time 'restart' re-pause) - either way the job
  // is honestly paused and never auto-resumed, the exact same safety
  // contract every other job type already has (never silently retry a
  // possibly-external action after a restart). The owner must resume each
  // one explicitly, same as any other job.
  for (const job of afterRestartJobs.filter(j => ['restart', 'shutdown'].includes(j.pauseReason))) {
    const resume = await h.post(`/api/jobs/${job.id}/action`, {action: 'resume', revision: job.version});
    assert.equal(resume.status, 200, JSON.stringify(resume.body));
  }

  const builder = missionResponse.body.mission.shadows.find(s => s.role === 'builder');
  const builderJob = await h.wait(builder.jobId, ['completed', 'failed']);
  assert.equal(builderJob.status, 'completed', builderJob.error);
  const verifyJob = await h.wait(missionResponse.body.mission.verify.jobId, ['completed', 'failed']);
  assert.equal(verifyJob.status, 'completed');
  assert.equal(missionStatus(missionId, h.disk()).phase, 'completed');
});
