import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {start} from '../server.mjs';
import {openStore} from '../lib/store.mjs';
import {planShadowMission, shadowJobFromSpec, validateShadowAssignment, shadowBlockReason, missionStatus, SHADOW_ROLES} from '../lib/shadow-army.mjs';
import {evaluateDecisions, buildVerifierEscalateRequest} from '../lib/jev.mjs';
import {
  SemanticVerificationError, VERDICTS, CRITERION_STATUSES, INDEPENDENCE_LABELS, SEMANTIC_VERDICT_VERSION,
  parseSemanticVerdictDraft, buildSemanticVerdict, validateSemanticVerdict, validateIndependenceLabel,
  semanticVerificationPrompt, renderSemanticVerdictReport,
} from '../lib/semantic-verification.mjs';

// BLACKHOLE Independent Semantic Verification — the 17 scenarios required by
// the mission spec. Each test below names, in a leading comment, exactly
// which numbered scenario(s) it proves; several scenarios share one test
// where the underlying real evidence path is the same (the same convention
// jarvis-shadow-bridge.test.mjs and shadow-army.test.mjs already use).

const OPENAI_KEY = 'synthetic-openai-key-not-a-real-credential';
const MODEL_ENV = {YENO_AGENT_PROVIDER: 'openai', YENO_OPENAI_API_KEY: OPENAI_KEY, YENO_OPENAI_MODEL: 'synthetic-openai', YENO_AGENT_DAILY_CALL_LIMIT: '20'};
const GROK_ENV = {...MODEL_ENV, YENO_GROK_API_KEY: 'synthetic-grok-key-not-a-real-credential', YENO_GROK_MODEL: 'synthetic-grok-model', YENO_GROK_DAILY_CALL_LIMIT: '10'};
const ok = text => new Response(JSON.stringify({choices: [{finish_reason: 'stop', message: {content: text, tool_calls: []}}], usage: {prompt_tokens: 30, completion_tokens: 20}}), {headers: {'Content-Type': 'application/json'}});
const isSemanticRequest = body => body.messages.some(m => typeof m.content === 'string' && m.content.includes('independent semantic verifier'));

const PASS_VERDICT = {verdict: 'pass', confidence: 0.9, criteria: [{criterion: '목표 충족', status: 'met', reason: '산출물이 목표와 성공 기준을 실제로 다룸', evidenceRefs: ['builder-artifact']}], summary: '목표를 실제로 달성함'};
const FAIL_VERDICT = {verdict: 'fail', confidence: 0.8, criteria: [{criterion: '목표 충족', status: 'not_met', reason: '산출물이 성공 기준을 실제로 다루지 못함', evidenceRefs: ['builder-artifact']}], summary: '목표를 달성하지 못함'};
const UNCERTAIN_VERDICT = {verdict: 'uncertain', confidence: 0.4, criteria: [{criterion: '목표 충족', status: 'uncertain', reason: '증거가 판단하기에 불충분함', evidenceRefs: ['builder-artifact']}], summary: '증거 불충분으로 판단 불가'};

// A server-side harness (real HTTP server, real on-disk store, real restart)
// mirroring the exact convention shadow-army.test.mjs and
// jarvis-shadow-bridge.test.mjs already use for this same pipeline - no
// second test harness idiom invented for this file.
async function setup(t, {env = MODEL_ENV, semanticText = JSON.stringify(PASS_VERDICT), throwOnSemantic = false} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-semantic-verify-')), token = 'synthetic-semantic-owner-token';
  const modelCalls = [];
  const agentFetch = async (url, req) => {
    const body = JSON.parse(req.body);
    modelCalls.push({url, body});
    if (isSemanticRequest(body)) {
      if (throwOnSemantic) throw new Error('synthetic transport failure (ambiguous - did the provider receive it?)');
      return ok(semanticText);
    }
    return ok('실제 Shadow 산출물 본문');
  };
  let runtime = await start({host: '127.0.0.1', port: 0, dataDir: dir, token, env, agentFetch});
  const request = async (method, route, body) => { const r = await fetch(`http://127.0.0.1:${runtime.server.address().port}${route}`, {method, headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}, ...(body ? {body: JSON.stringify(body)} : {})}); return {status: r.status, body: await r.json()}; };
  const post = (route, body = {}) => request('POST', route, {requestId: randomUUID(), ...body});
  const get = route => request('GET', route);
  const wait = async (id, statuses = ['completed', 'failed', 'paused']) => { for (let i = 0; i < 400; i++) { const j = openStore(dir).state.jobs.find(j => j.id === id); if (j && statuses.includes(j.status)) return j; await new Promise(r => setTimeout(r, 20)); } assert.fail('job did not reach target state'); };
  const until = async (check, label) => { for (let i = 0; i < 400; i++) { const value = check(); if (value) return value; await new Promise(r => setTimeout(r, 20)); } assert.fail(label); };
  const restart = async () => { runtime.shutdown(); runtime = await start({host: '127.0.0.1', port: 0, dataDir: dir, token, env, agentFetch}); };
  t.after(() => { runtime.shutdown(); fs.rmSync(dir, {recursive: true, force: true}); });
  return {dir, post, get, wait, until, restart, modelCalls, disk: () => openStore(dir).state};
}

async function createProject(h, overrides = {}) {
  const r = await h.post('/api/projects', {name: `Semantic 프로젝트 ${randomUUID().slice(0, 8)}`, status: 'active', ...overrides});
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.project;
}

async function runFullMission(h, project, extra = {}) {
  const missionResponse = await h.post('/api/shadow-army/missions', {projectId: project.id, goal: '실제 산출물을 완성한다', successCriterion: '검증 가능한 결과물 1개', ...extra});
  assert.equal(missionResponse.status, 201, JSON.stringify(missionResponse.body));
  const mission = missionResponse.body.mission;
  const builder = mission.shadows.find(s => s.role === 'builder');
  const builderJob = await h.wait(builder.jobId, ['completed', 'failed']);
  assert.equal(builderJob.status, 'completed', builderJob.error);
  const verifyJob = await h.wait(mission.verify.jobId, ['completed', 'failed']);
  assert.equal(verifyJob.status, 'completed', JSON.stringify(verifyJob.verifyResult));
  return {missionResponse, mission, builder, builderJob, verifyJob};
}

// ---------------------------------------------------------------------------
// Pure unit tests: the verdict contract itself (semantic-verification.mjs)
// ---------------------------------------------------------------------------

test('parseSemanticVerdictDraft accepts a coherent draft and fails closed on malformed JSON, bad shape, bad enum values and self-contradicting criteria (scenario 5)', () => {
  const draft = parseSemanticVerdictDraft(JSON.stringify(PASS_VERDICT));
  assert.equal(draft.verdict, 'pass');
  assert.throws(() => parseSemanticVerdictDraft(''), SemanticVerificationError);
  assert.throws(() => parseSemanticVerdictDraft('this is not json at all'), error => error instanceof SemanticVerificationError && error.code === undefined ? false : error.message.includes('invalid_verdict_json'));
  assert.throws(() => parseSemanticVerdictDraft(JSON.stringify({...PASS_VERDICT, extraField: 1})), /invalid_verdict_shape/);
  assert.throws(() => parseSemanticVerdictDraft(JSON.stringify({...PASS_VERDICT, verdict: 'maybe'})), /invalid_verdict_value/);
  assert.throws(() => parseSemanticVerdictDraft(JSON.stringify({...PASS_VERDICT, confidence: 1.5})), /invalid_confidence/);
  assert.throws(() => parseSemanticVerdictDraft(JSON.stringify({...PASS_VERDICT, criteria: []})), /invalid_criteria_list/);
  // Internal consistency: a "pass" verdict whose own criteria say "not_met" is incoherent, not a valid judgment.
  assert.throws(() => parseSemanticVerdictDraft(JSON.stringify({...PASS_VERDICT, verdict: 'pass', criteria: FAIL_VERDICT.criteria})), /verdict_criteria_mismatch/);
  assert.throws(() => parseSemanticVerdictDraft(JSON.stringify({...FAIL_VERDICT, verdict: 'fail', criteria: PASS_VERDICT.criteria})), /verdict_criteria_mismatch/);
  assert.throws(() => parseSemanticVerdictDraft(JSON.stringify({...UNCERTAIN_VERDICT, verdict: 'uncertain', criteria: PASS_VERDICT.criteria})), /verdict_criteria_mismatch/);
  // Malformed output must preserve a real, bounded excerpt of what was actually returned - never silently discarded.
  const garbage = 'x'.repeat(5000);
  try { parseSemanticVerdictDraft(garbage); assert.fail('expected throw'); } catch (error) { assert.ok(error.message.length < 400, 'evidence excerpt must be bounded'); assert.ok(error.message.includes(garbage.slice(0, 50))); }
});

test('buildSemanticVerdict injects server-known provenance and re-validates the full contract; validateSemanticVerdict bounds artifactRefs and rejects tampering (scenario 7)', () => {
  const missionId = randomUUID(), builderJobId = randomUUID(), verifierJobId = randomUUID();
  const draft = parseSemanticVerdictDraft(JSON.stringify(PASS_VERDICT));
  const verdict = buildSemanticVerdict({draft, missionId, plannerQuestId: null, builderJobId, verifierJobId, artifactRefs: ['a1', 'a2'], provider: 'openai', model: 'gpt', at: '2026-09-20T00:00:00.000Z'});
  assert.equal(verdict.version, SEMANTIC_VERDICT_VERSION);
  assert.equal(verdict.missionId, missionId);
  assert.deepEqual(verdict.artifactRefs, ['a1', 'a2']);
  validateSemanticVerdict(verdict); // must not throw on its own honest output
  // The model can never forge its own provenance: passing a draft with extra provenance-shaped keys is rejected at parse time already (tested above), and validateSemanticVerdict independently rejects a tampered persisted record.
  assert.throws(() => validateSemanticVerdict({...verdict, missionId: 'not-a-uuid'}), /invalid_verdict_ids/);
  assert.throws(() => validateSemanticVerdict({...verdict, artifactRefs: Array.from({length: 9}, (_, i) => `a${i}`)}), /invalid_artifact_refs/);
  assert.throws(() => validateSemanticVerdict({...verdict, artifactRefs: ['']}), /invalid_artifact_refs/);
  assert.throws(() => validateSemanticVerdict({...verdict, version: 2}), /invalid_verdict_version/);
  assert.throws(() => validateSemanticVerdict({...verdict, provider: ''}), /invalid_provider/);
  assert.throws(() => validateSemanticVerdict({...verdict, createdAt: 'not-a-date'}), /invalid_created_at/);
});

test('semanticVerificationPrompt requires goal and successCriterion and includes them verbatim, and clips oversized artifact/supporting excerpts (scenario 6, 8)', () => {
  assert.throws(() => semanticVerificationPrompt({goal: '', successCriterion: 'x', builderArtifact: 'y'}), /missing_goal/);
  assert.throws(() => semanticVerificationPrompt({goal: 'g', successCriterion: '', builderArtifact: 'y'}), /missing_success_criterion/);
  assert.throws(() => semanticVerificationPrompt({goal: 'g', successCriterion: 's'}), /missing_builder_artifact/);
  const prompt = semanticVerificationPrompt({goal: '실제 목표 문자열', successCriterion: '실제 성공 기준 문자열', builderArtifact: '실제 산출물', deterministicResult: '검증 통과', supportingExcerpts: ['보조 자료 1', '보조 자료 2', '보조 자료 3 (버려짐)']});
  assert.ok(prompt.includes('실제 목표 문자열'));
  assert.ok(prompt.includes('실제 성공 기준 문자열'));
  assert.ok(prompt.includes('실제 산출물'));
  assert.ok(prompt.includes('보조 자료 1') && prompt.includes('보조 자료 2'));
  assert.equal(prompt.includes('보조 자료 3'), false, 'at most 2 supporting excerpts are ever included');
  const huge = semanticVerificationPrompt({goal: 'g', successCriterion: 's', builderArtifact: '가'.repeat(20000)});
  assert.ok(huge.length < 30000, 'oversized artifact content must be bounded, never passed through unbounded');
});

test('renderSemanticVerdictReport and validateIndependenceLabel honestly distinguish independent-model from independent-context and reject an invalid label', () => {
  const verdict = buildSemanticVerdict({draft: parseSemanticVerdictDraft(JSON.stringify(PASS_VERDICT)), missionId: randomUUID(), plannerQuestId: null, builderJobId: randomUUID(), verifierJobId: randomUUID(), artifactRefs: [], provider: 'xai', model: 'grok', at: '2026-09-20T00:00:00.000Z'});
  const modelReport = renderSemanticVerdictReport(verdict, 'independent-model');
  assert.ok(modelReport.includes('독립 모델'));
  const contextReport = renderSemanticVerdictReport(verdict, 'independent-context');
  assert.ok(contextReport.includes('독립 컨텍스트'));
  assert.throws(() => validateIndependenceLabel('independent-vibes'), /invalid_independence_label/);
  assert.throws(() => renderSemanticVerdictReport(verdict, 'independent-vibes'), /invalid_independence_label/);
  assert.deepEqual([...INDEPENDENCE_LABELS], ['independent-model', 'independent-context']);
  assert.deepEqual([...VERDICTS], ['pass', 'fail', 'uncertain']);
  assert.deepEqual([...CRITERION_STATUSES], ['met', 'not_met', 'uncertain']);
});

// ---------------------------------------------------------------------------
// Pure unit tests: shadow-army.mjs wiring for the new role
// ---------------------------------------------------------------------------

const stubProject = () => ({id: '11111111-1111-4111-8111-111111111111', name: 'P', status: 'active', version: 1, repositoryUrl: '', summary: '', nextAction: '', createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z', milestones: []});

test('planShadowMission always plans exactly one semanticVerifier gated on the deterministic verifier, and validateShadowAssignment fails closed on a tampered semantic link (scenario 7)', () => {
  const state = {emergencyStop: false, projects: [stubProject()], jobs: []};
  const plan = planShadowMission(state, {projectId: state.projects[0].id, goal: '실제 목표'});
  const semanticSpec = plan.specs.find(s => s.role === 'semanticVerifier'), verifierSpec = plan.specs.find(s => s.role === 'verifier');
  assert.deepEqual(semanticSpec.dependsOnJobIds, [verifierSpec.id], 'the semantic verifier is gated on the deterministic verifier, never the builder directly');
  const job = shadowJobFromSpec(semanticSpec, '2026-09-20T00:00:00.000Z');
  assert.equal(job.type, 'agent'); assert.equal(job.callLimit, 1);
  validateShadowAssignment(job); // the real, honest shape must validate
  const tampered = structuredClone(job); tampered.semanticVerifyRequest.verifierJobId = randomUUID();
  assert.throws(() => validateShadowAssignment(tampered), /Invalid semantic verify request/);
  const forgedVerdict = structuredClone(job); forgedVerdict.semanticVerdict = {version: 1, verdict: 'pass'};
  assert.throws(() => validateShadowAssignment(forgedVerdict), SemanticVerificationError);
});

test('shadowBlockReason pauses a semantic verifier job honestly with providerMissing when its resolved config is not ready, exactly like any other agent shadow (scenario 11)', () => {
  const project = stubProject();
  const state = {projects: [project], modules: {ai: true}};
  const plan = planShadowMission({emergencyStop: false, projects: [project], jobs: []}, {projectId: project.id, goal: '목표'});
  const job = shadowJobFromSpec(plan.specs.find(s => s.role === 'semanticVerifier'), '2026-09-20T00:00:00.000Z');
  job.status = 'queued'; delete job.pauseReason;
  assert.equal(shadowBlockReason(job, state, {ready: false}), 'providerMissing', 'no configured provider (primary or grok) for the semantic role must be reported explicitly, never silently skipped or defaulted to pass');
  assert.equal(shadowBlockReason(job, state, {ready: true}), null);
});

// ---------------------------------------------------------------------------
// Pure unit test: JEV stays observation-only for the semantic verifier too
// ---------------------------------------------------------------------------

test('JEV verifierEscalate observation is fixed authorizesDispatch:false and its own answer never mutates the caller\'s job or verdict (scenario 15, 16)', () => {
  const verifyJob = {id: randomUUID(), shadowAssignment: {missionId: randomUUID(), role: 'verifier'}};
  const at = '2026-09-20T00:00:00.000Z';
  // Even when JEV's own opinion is "yes, escalate" (it disagrees with a real PASS outcome elsewhere), the response carries no authority field beyond the fixed false, and calling it does not touch the job object passed in.
  const before = structuredClone(verifyJob);
  const request = buildVerifierEscalateRequest({verifyJob, verifyResult: {verified: false}, emergencyStop: false});
  const response = evaluateDecisions(request, at);
  assert.equal(response.authorizesDispatch, false);
  assert.equal(response.answers.verifierEscalate, true, 'JEV genuinely computed its own answer from the given evidence');
  assert.deepEqual(verifyJob, before, 'evaluateDecisions is a pure read - it never mutates the real job it was asked about');
  assert.equal(Object.hasOwn(response, 'authorizesAction'), false, 'JEV exposes exactly one authority field, and it is fixed false');
  // A malformed/absent verifyResult must abstain, never guess an escalation.
  const abstained = evaluateDecisions(buildVerifierEscalateRequest({verifyJob, verifyResult: null, emergencyStop: false}), at);
  assert.equal(abstained.decisionStatus.verifierEscalate, 'uncertain');
});

// ---------------------------------------------------------------------------
// Integration tests: real HTTP server, real on-disk store, real restart
// ---------------------------------------------------------------------------

test('deterministic PASS alone never completes the mission; semantic PASS opens the final gate with a real milestone + memory event; successCriterion reaches the real prompt; artifactRefs are real; no secret or builder-instruction text leaks into the semantic prompt (scenarios 1, 2, 6, 7, 8)', async t => {
  const h = await setup(t);
  const project = await createProject(h);
  const {missionResponse, mission, builder, verifyJob} = await runFullMission(h, project);
  const missionId = missionResponse.body.missionId;

  // Scenario 1: deterministic PASS alone must not complete the mission.
  assert.equal(verifyJob.verifyResult.verified, true);
  const afterDeterministic = missionStatus(missionId, h.disk());
  assert.notEqual(afterDeterministic.phase, 'completed');
  assert.equal(afterDeterministic.phase, 'semantic_verifying');

  const semanticJob = await h.wait(mission.semantic.jobId, ['completed', 'failed']);
  assert.equal(semanticJob.status, 'completed', semanticJob.error);
  assert.equal(semanticJob.semanticVerdict.verdict, 'pass');

  // Scenario 2: semantic PASS is the real final gate.
  const finalMission = missionStatus(missionId, h.disk());
  assert.equal(finalMission.phase, 'completed');
  const updatedProject = h.disk().projects.find(p => p.id === project.id);
  assert.ok(updatedProject.milestones.some(m => m.completed && m.text.includes(missionId.slice(0, 8))));
  const memoryEvent = h.disk().memoryEvents.find(e => e.sourceRefs.some(ref => ref.type === 'job' && ref.id === semanticJob.id));
  assert.ok(memoryEvent, 'the canonical memory event must reference the real semantic verifier job, not the deterministic one');

  // Scenario 7: artifactRefs are real, existing artifact ids - never fabricated.
  assert.ok(semanticJob.semanticVerdict.artifactRefs.length > 0);
  for (const ref of semanticJob.semanticVerdict.artifactRefs) assert.ok(h.disk().artifacts[ref], `artifactRef ${ref} must be a real stored artifact`);
  assert.equal(semanticJob.semanticVerdict.artifactRefs.includes(builder.jobId), false, 'artifactRefs are artifact ids, never raw job ids');

  // Scenarios 6 & 8: the real captured prompt must carry the real successCriterion/goal, and must never leak the configured secret or the builder's own hidden system instructions.
  const semanticCall = h.modelCalls.find(call => isSemanticRequest(call.body));
  assert.ok(semanticCall, 'the semantic verifier must have made its own real (synthetic-transport) model call');
  const promptText = JSON.stringify(semanticCall.body);
  assert.ok(promptText.includes('검증 가능한 결과물 1개'), 'successCriterion must be present in the real captured verifier input');
  assert.ok(promptText.includes('실제 산출물을 완성한다'), 'goal must be present in the real captured verifier input');
  assert.equal(promptText.includes(OPENAI_KEY), false, 'no raw credential may ever reach the semantic verifier prompt');
  assert.equal(promptText.includes('Shadow Army의 Builder'), false, 'the builder\'s own hidden system instructions/reasoning must never be forwarded, only its rendered artifact content');
});

test('a semantic FAIL verdict blocks the milestone and is reported honestly as semantic_fail (scenario 3, 16)', async t => {
  const h = await setup(t, {semanticText: JSON.stringify(FAIL_VERDICT)});
  const project = await createProject(h);
  const {missionResponse, mission} = await runFullMission(h, project);
  const semanticJob = await h.wait(mission.semantic.jobId, ['completed', 'failed']);
  assert.equal(semanticJob.status, 'failed');
  assert.equal(semanticJob.semanticVerdict.verdict, 'fail');
  assert.match(semanticJob.error, /^semantic_fail: /);
  const finalMission = missionStatus(missionResponse.body.missionId, h.disk());
  assert.equal(finalMission.phase, 'failed');
  assert.equal(finalMission.semantic.failureReason, 'semantic_fail');
  const updatedProject = h.disk().projects.find(p => p.id === project.id);
  assert.equal(updatedProject.milestones.some(m => m.text.includes(missionResponse.body.missionId.slice(0, 8))), false, 'a real milestone must never be recorded on a semantic FAIL');
  assert.equal(h.disk().memoryEvents.some(e => e.sourceRefs.some(ref => ref.id === semanticJob.id)), false);
});

test('a semantic UNCERTAIN verdict blocks the milestone and is reported honestly as semantic_uncertain, never treated as PASS (scenario 4)', async t => {
  const h = await setup(t, {semanticText: JSON.stringify(UNCERTAIN_VERDICT)});
  const project = await createProject(h);
  const {missionResponse, mission} = await runFullMission(h, project);
  const semanticJob = await h.wait(mission.semantic.jobId, ['completed', 'failed']);
  assert.equal(semanticJob.status, 'failed', 'uncertain must block exactly like fail - never silently pass');
  assert.equal(semanticJob.semanticVerdict.verdict, 'uncertain');
  assert.match(semanticJob.error, /^semantic_uncertain: /);
  const finalMission = missionStatus(missionResponse.body.missionId, h.disk());
  assert.equal(finalMission.phase, 'failed');
  assert.equal(finalMission.semantic.failureReason, 'semantic_uncertain');
  const updatedProject = h.disk().projects.find(p => p.id === project.id);
  assert.equal(updatedProject.milestones.some(m => m.text.includes(missionResponse.body.missionId.slice(0, 8))), false);
});

test('malformed (non-JSON) model output fails closed with bounded raw evidence preserved, and is never silently retried (scenario 5, 13-adjacent idempotency)', async t => {
  const garbageText = '이것은 JSON이 아닌 평범한 문장입니다. 모델이 형식을 지키지 않았습니다.';
  const h = await setup(t, {semanticText: garbageText});
  const project = await createProject(h);
  const {missionResponse, mission} = await runFullMission(h, project);
  const semanticJob = await h.wait(mission.semantic.jobId, ['completed', 'failed']);
  assert.equal(semanticJob.status, 'failed');
  assert.equal(Object.hasOwn(semanticJob, 'semanticVerdict'), false, 'a malformed draft must never produce a persisted verdict record');
  assert.match(semanticJob.error, /^invalid_verdict_json: /);
  assert.ok(semanticJob.error.includes(garbageText.slice(0, 30)), 'the real raw output must be preserved as bounded evidence, not discarded');
  assert.ok(semanticJob.error.length < 350, 'the preserved evidence must be bounded, never unbounded raw output');
  const callsForThisJob = h.modelCalls.filter(call => isSemanticRequest(call.body)).length;
  await new Promise(r => setTimeout(r, 300));
  assert.equal(h.modelCalls.filter(call => isSemanticRequest(call.body)).length, callsForThisJob, 'a terminal failed job must never be silently re-dispatched');
  assert.equal(missionStatus(missionResponse.body.missionId, h.disk()).phase, 'failed');
});

test('an ambiguous transport failure preserves the real "unknown" call outcome and fails closed rather than guessing a pass (scenario 12)', async t => {
  const h = await setup(t, {throwOnSemantic: true});
  const project = await createProject(h);
  const {missionResponse, mission} = await runFullMission(h, project);
  const semanticJob = await h.wait(mission.semantic.jobId, ['completed', 'failed']);
  assert.equal(semanticJob.status, 'failed');
  assert.equal(Object.hasOwn(semanticJob, 'semanticVerdict'), false);
  assert.equal(semanticJob.agentJournal.calls.length, 1);
  assert.equal(semanticJob.agentJournal.calls[0].status, 'unknown', 'an ambiguous provider failure must be preserved as unknown, never assumed settled');
  assert.equal(missionStatus(missionResponse.body.missionId, h.disk()).phase, 'failed');
  const updatedProject = h.disk().projects.find(p => p.id === project.id);
  assert.equal(updatedProject.milestones.some(m => m.text.includes(missionResponse.body.missionId.slice(0, 8))), false);
});

test('restart never duplicates the semantic verifier job, and a completed PASS is never re-dispatched after restart (scenario 13)', async t => {
  const h = await setup(t);
  const project = await createProject(h);
  const {missionResponse, mission} = await runFullMission(h, project);
  const semanticJob = await h.wait(mission.semantic.jobId, ['completed', 'failed']);
  assert.equal(semanticJob.status, 'completed', semanticJob.error);
  const callsBefore = h.modelCalls.filter(call => isSemanticRequest(call.body)).length;
  assert.equal(callsBefore, 1);

  await h.restart();
  const semanticJobsAfterRestart = h.disk().jobs.filter(j => j.semanticVerifyRequest?.missionId === missionResponse.body.missionId);
  assert.equal(semanticJobsAfterRestart.length, 1, 'restart must never duplicate the one real semantic verifier job');
  assert.equal(semanticJobsAfterRestart[0].status, 'completed');
  await new Promise(r => setTimeout(r, 300));
  assert.equal(h.modelCalls.filter(call => isSemanticRequest(call.body)).length, callsBefore, 'a completed PASS must never be re-run automatically after restart');
  assert.equal(missionStatus(missionResponse.body.missionId, h.disk()).phase, 'completed');
});

test('a semantically-failed mission never blocks replanning a fresh mission for the same project - the real, already-safe retry path (scenario 14)', async t => {
  const h = await setup(t, {semanticText: JSON.stringify(FAIL_VERDICT)});
  const project = await createProject(h);
  const first = await runFullMission(h, project);
  const semanticJob = await h.wait(first.mission.semantic.jobId, ['completed', 'failed']);
  assert.equal(semanticJob.status, 'failed');
  assert.equal(missionStatus(first.missionResponse.body.missionId, h.disk()).phase, 'failed');
  // A terminal (failed) job cannot itself be resumed/retried - explicit retry is a fresh mission, exactly like a dependency-failure retry.
  const resumeAttempt = await h.post(`/api/jobs/${semanticJob.id}/action`, {action: 'resume'});
  assert.equal(resumeAttempt.status, 409, 'a terminal semantic verifier job must never be silently resumed/retried in place');

  const second = await h.post('/api/shadow-army/missions', {projectId: project.id, goal: '재시도 목표'});
  assert.equal(second.status, 201, JSON.stringify(second.body));
  assert.notEqual(second.body.missionId, first.missionResponse.body.missionId);
  assert.ok(h.disk().jobs.some(j => j.id === semanticJob.id && j.status === 'failed'), 'the failed mission\'s own evidence must remain untouched');
});

test('provider diversity is reported honestly as independent-model when a real alternate provider (grok) is configured and ready (scenario 9)', async t => {
  const h = await setup(t, {env: GROK_ENV});
  const project = await createProject(h);
  const {mission, builderJob} = await runFullMission(h, project);
  const semanticJob = await h.wait(mission.semantic.jobId, ['completed', 'failed']);
  assert.equal(semanticJob.status, 'completed', semanticJob.error);
  assert.equal(semanticJob.agentJournal.provider, 'xai', 'a ready, distinct grok profile must actually be selected for the semantic role');
  assert.notEqual(builderJob.agentJournal.provider, semanticJob.agentJournal.provider);
  assert.equal(semanticJob.semanticVerdict.provider, 'xai');
  const semanticCall = h.modelCalls.filter(call => isSemanticRequest(call.body)).at(-1);
  assert.equal(semanticCall.url, 'https://api.x.ai/v1/chat/completions');
  const finalMission = missionStatus(mission.missionId, h.disk());
  assert.equal(finalMission.semantic.independence, 'independent-model');
});

test('same-provider fallback is labeled honestly as independent-context when no alternate provider is actually configured (scenario 10)', async t => {
  const h = await setup(t); // no YENO_GROK_* vars - grok.ready is false
  const project = await createProject(h);
  const {mission, builderJob} = await runFullMission(h, project);
  const semanticJob = await h.wait(mission.semantic.jobId, ['completed', 'failed']);
  assert.equal(semanticJob.status, 'completed', semanticJob.error);
  assert.equal(semanticJob.agentJournal.provider, builderJob.agentJournal.provider, 'without a ready alternate provider the semantic role must honestly fall back to the same primary config');
  const semanticCall = h.modelCalls.filter(call => isSemanticRequest(call.body)).at(-1);
  assert.equal(semanticCall.url, 'https://api.openai.com/v1/chat/completions');
  const finalMission = missionStatus(mission.missionId, h.disk());
  assert.equal(finalMission.semantic.independence, 'independent-context', 'never asserted as independent-model when it is not');
});

test('plannerQuestId survives both a restart mid-mission and the mission\'s eventual completion (scenario 17)', async t => {
  const h = await setup(t);
  const project = await createProject(h);
  const questResponse = await h.post('/api/quests', {goal: '가장 중요한 산출물을 만든다', driveId: 'pride', provider: 'auto', projectId: project.id, successCriterion: '실제 산출물과 검증 근거를 남긴다', baseline: '기준값 미측정'});
  assert.equal(questResponse.status, 201, JSON.stringify(questResponse.body));
  const quest = questResponse.body.quest;
  const missionResponse = await h.post('/api/shadow-army/missions', {questId: quest.id});
  assert.equal(missionResponse.status, 201, JSON.stringify(missionResponse.body));
  const mission = missionResponse.body.mission;
  assert.equal(mission.plannerQuestId, quest.id);
  assert.equal(mission.semantic.jobId ? h.disk().jobs.find(j => j.id === mission.semantic.jobId).semanticVerifyRequest.plannerQuestId : null, quest.id);

  const scoutId = mission.shadows.find(s => s.role === 'scout').jobId;
  await h.until(() => h.disk().jobs.find(j => j.id === scoutId)?.status !== 'queued', 'scout must leave queued before restart');
  await h.restart();
  const afterRestart = h.disk().jobs.filter(j => ['restart', 'shutdown'].includes(j.pauseReason));
  for (const job of afterRestart) { const resume = await h.post(`/api/jobs/${job.id}/action`, {action: 'resume', revision: job.version}); assert.equal(resume.status, 200, JSON.stringify(resume.body)); }

  const builderJob = await h.wait(mission.shadows.find(s => s.role === 'builder').jobId, ['completed', 'failed']);
  assert.equal(builderJob.status, 'completed', builderJob.error);
  const verifyJob = await h.wait(mission.verify.jobId, ['completed', 'failed']);
  assert.equal(verifyJob.status, 'completed');
  const semanticJob = await h.wait(mission.semantic.jobId, ['completed', 'failed']);
  assert.equal(semanticJob.status, 'completed', semanticJob.error);
  assert.equal(semanticJob.semanticVerdict.plannerQuestId, quest.id, 'plannerQuestId must survive restart and appear in the final persisted verdict');
  const finalMission = missionStatus(missionResponse.body.missionId, h.disk());
  assert.equal(finalMission.plannerQuestId, quest.id);
  assert.equal(finalMission.phase, 'completed');
});
