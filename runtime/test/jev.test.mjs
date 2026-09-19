import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {start} from '../server.mjs';
import {openStore} from '../lib/store.mjs';
import {
  JEV_ENGINE_VERSION, JEV_CALIBRATION_VERSION,
  JevError, evaluateDecisions, validateDecisionRequest,
  buildShadowDispatchRequest, buildVerifierEscalateRequest,
  shadowDispatchLogEntry, shadowDispatchMatchesReal, validateJevShadowLog,
} from '../lib/jev.mjs';

// BLACKHOLE JEV v0 (issue #25 §4.6/§5.1) — first slice: a pure typed decision
// contract wired to Phase D Shadow Army in shadow mode only. Unit tests cover
// the contract itself (typed answers, abstain/uncertain/blocked, evidence,
// determinism, secret rejection); the integration test uses the exact same
// real-HTTP-server/real-store/real-restart convention as
// shadow-army.test.mjs to prove the shadow-mode log is populated from a real
// mission without ever influencing the real scheduler's own decision.
const AT = '2026-09-19T00:00:00.000Z';

test('validateDecisionRequest enforces the typed contract and rejects secrets', () => {
  const base = {state: {}, questions: ['dependencyReady'], evidenceRefs: [], policyContext: {}};
  assert.doesNotThrow(() => validateDecisionRequest(base));
  assert.throws(() => validateDecisionRequest({...base, extra: true}), JevError);
  assert.throws(() => validateDecisionRequest({...base, questions: []}), JevError);
  assert.throws(() => validateDecisionRequest({...base, questions: ['notAQuestion']}), JevError);
  assert.throws(() => validateDecisionRequest({...base, evidenceRefs: [{type: 'job'}]}), JevError);
  assert.throws(() => validateDecisionRequest({...base, state: {apiKey: 'sk-real-secret-value'}}), JevError);
  assert.throws(() => validateDecisionRequest({...base, policyContext: {token: 'value'}}), JevError);
});

test('evaluateDecisions evaluates multiple typed questions in one pass, deterministically', () => {
  const request = {
    state: {dependsOnJobIds: [], jobStatuses: {}, concurrencyLimit: 2, activeCount: 0, blockReason: null},
    questions: ['dependencyReady', 'parallelSafe', 'shadowDispatch'],
    evidenceRefs: [{type: 'job', id: 'j1'}],
    policyContext: {emergencyStop: false, missionId: randomUUID(), role: 'scout'},
  };
  const r1 = evaluateDecisions(request, AT);
  assert.equal(r1.answers.dependencyReady, true);
  assert.equal(r1.answers.parallelSafe, true);
  assert.equal(r1.answers.shadowDispatch, 'dispatch');
  assert.equal(r1.decisionStatus.shadowDispatch, 'decided');
  assert.equal(r1.engineVersion, JEV_ENGINE_VERSION);
  assert.equal(r1.calibrationVersion, JEV_CALIBRATION_VERSION);
  assert.equal(r1.authorizesDispatch, false);
  assert.equal(r1.usage.modelCalls, 0);
  const r2 = evaluateDecisions(request, AT);
  assert.equal(r1.fingerprint, r2.fingerprint, 'same evidence must produce the same fingerprint');
  const r3 = evaluateDecisions({...request, state: {...request.state, activeCount: 5}}, AT);
  assert.notEqual(r1.fingerprint, r3.fingerprint, 'different evidence must produce a different fingerprint');
});

test('dependencyReady/parallelSafe/shadowDispatch: dispatch, hold, escalate and abstain each require their own real evidence', () => {
  const missionId = randomUUID();
  const decide = state => evaluateDecisions({state, questions: ['dependencyReady', 'parallelSafe', 'shadowDispatch'], evidenceRefs: [], policyContext: {emergencyStop: false, missionId, role: 'builder'}}, AT);

  // Dependency still running -> hold, not dispatch, and never silently "ready".
  const holding = decide({dependsOnJobIds: ['dep1'], jobStatuses: {dep1: 'running'}, concurrencyLimit: 2, activeCount: 0, blockReason: null});
  assert.equal(holding.answers.dependencyReady, false);
  assert.equal(holding.answers.shadowDispatch, 'hold');

  // At concurrency capacity -> hold even though dependencies are satisfied.
  const capped = decide({dependsOnJobIds: [], jobStatuses: {}, concurrencyLimit: 1, activeCount: 1, blockReason: null});
  assert.equal(capped.answers.parallelSafe, false);
  assert.equal(capped.answers.shadowDispatch, 'hold');

  // A dependency id with no known status at all is missing evidence -> abstain, never guessed.
  const abstained = decide({dependsOnJobIds: ['ghost'], jobStatuses: {}, concurrencyLimit: 2, activeCount: 0, blockReason: null});
  assert.equal(abstained.decisionStatus.dependencyReady, 'abstain');
  assert.equal(abstained.answers.dependencyReady, null);

  // A structurally changed project underneath the mission is escalate, not a quiet hold.
  const escalated = decide({dependsOnJobIds: [], jobStatuses: {}, concurrencyLimit: 2, activeCount: 0, blockReason: 'projectChanged'});
  assert.equal(escalated.answers.shadowDispatch, 'escalate');

  // Clear evidence on every front -> dispatch.
  const clear = decide({dependsOnJobIds: ['dep1'], jobStatuses: {dep1: 'completed'}, concurrencyLimit: 2, activeCount: 0, blockReason: null});
  assert.equal(clear.answers.shadowDispatch, 'dispatch');
});

test('emergencyStop blocks the dispatch question regardless of otherwise-clear evidence', () => {
  const request = {
    state: {dependsOnJobIds: [], jobStatuses: {}, concurrencyLimit: 2, activeCount: 0, blockReason: null},
    questions: ['shadowDispatch'],
    evidenceRefs: [],
    policyContext: {emergencyStop: true, missionId: randomUUID(), role: 'scout'},
  };
  const response = evaluateDecisions(request, AT);
  assert.equal(response.decisionStatus.shadowDispatch, 'blocked');
  assert.equal(response.answers.shadowDispatch, null);
});

test('verifierEscalate: uncertain before a result exists, decided once one does, abstain on a malformed result', () => {
  const missionId = randomUUID();
  const decide = verifyResult => evaluateDecisions(buildVerifierEscalateRequest({verifyJob: {id: 'verify1', shadowAssignment: {missionId}}, verifyResult, emergencyStop: false}), AT);
  const pending = decide(null);
  assert.equal(pending.decisionStatus.verifierEscalate, 'uncertain');
  const passed = decide({verified: true, reasons: [], subjects: []});
  assert.equal(passed.answers.verifierEscalate, false, 'a passed verification must not be flagged for escalation');
  const failed = decide({verified: false, reasons: ['subject_not_completed'], subjects: []});
  assert.equal(failed.answers.verifierEscalate, true, 'a failed verification is exactly the honest escalation signal');
  const malformed = decide({verified: 'yes'});
  assert.equal(malformed.decisionStatus.verifierEscalate, 'abstain');
});

test('shadowDispatchLogEntry/validateJevShadowLog: the bounded observation log is well-typed and records real agreement/disagreement', () => {
  const job = {id: randomUUID(), shadowAssignment: {missionId: randomUUID(), role: 'scout', dependsOnJobIds: []}};
  const request = buildShadowDispatchRequest({job, jobs: [], blockReason: null, concurrencyLimit: 2, activeCount: 0, emergencyStop: false});
  const response = evaluateDecisions(request, AT);
  const agree = shadowDispatchLogEntry({at: AT, job, response, realDecision: 'dispatch'});
  assert.equal(agree.matchedRealDecision, true);
  validateJevShadowLog([agree]);

  const disagree = shadowDispatchLogEntry({at: AT, job, response, realDecision: 'hold'});
  assert.equal(disagree.matchedRealDecision, false, 'a real decision more conservative than JEV\'s baseline is an honest, recorded mismatch, not silently reconciled');
  validateJevShadowLog([disagree]);

  assert.equal(shadowDispatchMatchesReal('dispatch', 'dispatch'), true);
  assert.equal(shadowDispatchMatchesReal('escalate', 'hold'), false);
  assert.throws(() => validateJevShadowLog([{...agree, jevAnswer: 'not-a-real-answer'}]));
  assert.throws(() => validateJevShadowLog([{...agree, engineVersion: 'jev-fake'}]));
});

// --- Real HTTP server / real store / real Shadow Army mission integration ---
const MODEL_ENV = {YENO_AGENT_PROVIDER: 'openai', YENO_OPENAI_API_KEY: 'synthetic-openai-key', YENO_OPENAI_MODEL: 'synthetic-openai', YENO_AGENT_DAILY_CALL_LIMIT: '20'};
const ok = text => new Response(JSON.stringify({choices: [{finish_reason: 'stop', message: {content: text, tool_calls: []}}], usage: {prompt_tokens: 30, completion_tokens: 20}}), {headers: {'Content-Type': 'application/json'}});

async function setup(t, {env = MODEL_ENV} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-jev-')), token = 'synthetic-jev-owner-token';
  const modelCalls = [];
  const agentFetch = async (url, req) => { modelCalls.push({url, body: JSON.parse(req.body)}); return ok('실제 Shadow 산출물 본문'); };
  let runtime = await start({host: '127.0.0.1', port: 0, dataDir: dir, token, env, agentFetch});
  const request = async (method, route, body) => { const r = await fetch(`http://127.0.0.1:${runtime.server.address().port}${route}`, {method, headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}, ...(body ? {body: JSON.stringify(body)} : {})}); return {status: r.status, body: await r.json()}; };
  const post = (route, body = {}) => request('POST', route, {requestId: randomUUID(), ...body});
  const get = route => request('GET', route);
  const wait = async (id, statuses = ['completed', 'failed', 'paused']) => { for (let i = 0; i < 400; i++) { const j = openStore(dir).state.jobs.find(j => j.id === id); if (j && statuses.includes(j.status)) return j; await new Promise(r => setTimeout(r, 20)); } assert.fail('job did not reach target state'); };
  const until = async (check, label) => { for (let i = 0; i < 400; i++) { const value = check(); if (value) return value; await new Promise(r => setTimeout(r, 20)); } assert.fail(label); };
  t.after(() => { runtime.shutdown(); fs.rmSync(dir, {recursive: true, force: true}); });
  return {dir, post, get, wait, until, modelCalls, disk: () => openStore(dir).state};
}

async function createProject(h, overrides = {}) {
  const r = await h.post('/api/projects', {name: `JEV 프로젝트 ${randomUUID().slice(0, 8)}`, status: 'active', ...overrides});
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.project;
}

test('a real mission populates the shadow-mode log with real, matching decisions and never changes real dispatch outcomes', async (t) => {
  const h = await setup(t);
  const project = await createProject(h);
  const missionResponse = await h.post('/api/shadow-army/missions', {projectId: project.id, goal: '실제 산출물을 완성한다'});
  assert.equal(missionResponse.status, 201, JSON.stringify(missionResponse.body));
  const mission = missionResponse.body.mission;
  const scout = mission.shadows.find(s => s.role === 'scout'), researcher = mission.shadows.find(s => s.role === 'researcher'), builder = mission.shadows.find(s => s.role === 'builder');

  const scoutJob = await h.wait(scout.jobId), researcherJob = await h.wait(researcher.jobId);
  assert.equal(scoutJob.status, 'completed'); assert.equal(researcherJob.status, 'completed');
  const builderJob = await h.wait(builder.jobId, ['completed', 'failed']);
  assert.equal(builderJob.status, 'completed', builderJob.error);
  const verifyJob = await h.wait(mission.verify.jobId, ['completed', 'failed']);
  assert.equal(verifyJob.status, 'completed');

  const stateResponse = await h.get('/api/state');
  assert.equal(stateResponse.body.jev.engineVersion, JEV_ENGINE_VERSION);
  assert.equal(stateResponse.body.jev.calibrationVersion, JEV_CALIBRATION_VERSION);
  assert.equal(stateResponse.body.jev.authorizesDispatch, false);
  const log = h.disk().jevShadowLog;
  assert.ok(log.length >= 3, 'scout, researcher and builder dispatch decisions must all be logged');
  validateJevShadowLog(log);
  for (const entry of log) assert.equal(entry.missionId, missionResponse.body.missionId);
  // Every straightforward dispatch in this mission is evidence JEV's
  // baseline sees the exact same real facts the real scheduler already
  // acted on - so, with no divergence injected, they must agree here.
  for (const entry of log) if (entry.realDecision === 'dispatch') assert.equal(entry.matchedRealDecision, true);
  // The real jobs ran and completed exactly as shadow-army.test.mjs already
  // proves independently of this file; JEV's log is purely additive
  // observation, never a gate, so the mission's own real outcome is untouched.
  assert.equal(verifyJob.verifyResult.verified, true);
});

test('no configured provider: JEV baseline still decides honestly (hold on providerMissing) with zero provider calls', async (t) => {
  const h = await setup(t, {env: {}});
  const project = await createProject(h);
  const missionResponse = await h.post('/api/shadow-army/missions', {projectId: project.id, goal: '목표'});
  const scoutId = missionResponse.body.mission.shadows.find(s => s.role === 'scout').jobId;
  await h.wait(scoutId, ['paused']);
  const log = h.disk().jevShadowLog;
  const scoutEntry = log.find(e => e.jobId === scoutId);
  assert.ok(scoutEntry, 'JEV must still produce a real decision with zero configured providers');
  assert.equal(scoutEntry.jevAnswer, 'hold');
  assert.equal(scoutEntry.realDecision, 'hold');
  assert.equal(scoutEntry.matchedRealDecision, true);
  assert.equal(h.modelCalls.length, 0, 'no real or fake provider call was ever made');
});
