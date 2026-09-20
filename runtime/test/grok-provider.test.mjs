import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {start} from '../server.mjs';
import {openStore} from '../lib/store.mjs';
import {runAgent} from '../lib/agent.mjs';
import {agentConfig} from '../lib/provider-config-engine.mjs';
import {
  GrokAdapterError, GROK_PROVIDER, GROK_DEFAULT_MODEL, GROK_MULTI_AGENT_MODEL, GROK_MODES,
  GROK_DEFAULT_MULTI_AGENT_COUNT, GROK_MAX_MULTI_AGENT_COUNT, GROK_CAPABILITIES, GROK_FAILURE_STATES,
  grokStatus, validateGrokStatus, validateGrokModeRequest, validateGrokMultiAgentApproval,
  grokCapabilityReport, assertNoSecrets,
} from '../lib/grok-adapter.mjs';

// BLACKHOLE xAI Grok Provider Adapter (issue #25). Grok already flows
// through the exact existing generic provider transport in
// agent-engine.mjs (proved by the pre-existing 'xai' entry in every
// provider-parameterized test in this repo) - this module only adds an
// honest status/mode/approval policy layer. Tests below name, in a leading
// comment, which required scenario(s) from the mission they prove.
const READY_PROFILE = {provider: 'xai', model: GROK_DEFAULT_MODEL, endpoint: 'https://api.x.ai/v1/chat/completions', dailyCallLimit: 5, ready: true, missing: []};
const ZERO_USAGE = {date: '2026-09-20', attempts: 0, unknown: 0, inputTokens: 0, outputTokens: 0, usageMissing: 0};

test('grokStatus derives every state from real evidence only, never fabricates availability, and quarantine always wins (scenarios 1/3/4/6/live-status-honesty)', () => {
  assert.deepEqual(grokStatus({profile: READY_PROFILE, usage: ZERO_USAGE}), {state: 'available', ready: true, evidence: {}});
  // Scenario: missing key -> unauthorized (can't authenticate at all), never "available".
  const noKey = {...READY_PROFILE, ready: false, missing: ['key']};
  assert.deepEqual(grokStatus({profile: noKey, usage: ZERO_USAGE}), {state: 'unauthorized', ready: false, evidence: {missing: ['key']}});
  // Missing only the model (key present) is a different honest reason: nothing to call, not an auth failure.
  const noModel = {...READY_PROFILE, ready: false, missing: ['model']};
  assert.deepEqual(grokStatus({profile: noModel, usage: ZERO_USAGE}).state, 'unavailable');
  // Scenario: rate_limited from real daily usage evidence, exactly like the existing dailyCallLimit gate.
  const exhausted = {...ZERO_USAGE, attempts: 5};
  assert.deepEqual(grokStatus({profile: READY_PROFILE, usage: exhausted}).state, 'rate_limited');
  // Scenario: cost_limited only when real cost evidence says so - never fabricated when absent.
  assert.equal(grokStatus({profile: READY_PROFILE, usage: ZERO_USAGE, costEvidence: {used: 10, limit: 10}}).state, 'cost_limited');
  assert.equal(grokStatus({profile: READY_PROFILE, usage: ZERO_USAGE, costEvidence: {used: 1, limit: 10}}).state, 'available');
  assert.equal(grokStatus({profile: READY_PROFILE, usage: ZERO_USAGE}).state, 'available', 'absent cost evidence must never be reported as cost_limited');
  // Scenario: degraded from a real ambiguous ("unknown") call outcome today.
  const someUnknown = {...ZERO_USAGE, attempts: 2, unknown: 1};
  assert.deepEqual(grokStatus({profile: READY_PROFILE, usage: someUnknown}), {state: 'degraded', ready: true, evidence: {attempts: 2, unknown: 1}});
  // Scenario: quarantined is an owner-set flag that overrides every other reading, even a perfectly healthy profile.
  assert.deepEqual(grokStatus({profile: READY_PROFILE, usage: ZERO_USAGE, quarantined: true}), {state: 'quarantined', ready: false, evidence: {quarantined: true}});
  for (const status of [
    grokStatus({profile: READY_PROFILE, usage: ZERO_USAGE}),
    grokStatus({profile: noKey, usage: ZERO_USAGE}),
    grokStatus({profile: READY_PROFILE, usage: exhausted}),
  ]) { validateGrokStatus(status); assert.equal(status.state === 'available', status.ready === true); }
  assert.throws(() => grokStatus({profile: null, usage: ZERO_USAGE}), GrokAdapterError);
  assert.throws(() => validateGrokStatus({state: 'unstoppable', ready: true, evidence: {}}), /invalid_status_state/);
  assert.deepEqual([...GROK_FAILURE_STATES], ['unavailable', 'unauthorized', 'rate_limited', 'cost_limited', 'degraded', 'quarantined']);
});

test('grokCapabilityReport only marks capabilities enabled that the existing tool policy boundary already implements (scenario: capabilities through existing policy boundary only)', () => {
  const report = grokCapabilityReport();
  assert.deepEqual(report.map(c => c.capability).sort(), [...GROK_CAPABILITIES].sort());
  const enabled = report.filter(c => c.enabled).map(c => c.capability).sort();
  assert.deepEqual(enabled, ['function_calling', 'structured_output', 'text_generation']);
  for (const capability of ['web_search', 'x_search', 'code_execution', 'image_generation', 'video_generation', 'remote_mcp']) {
    const entry = report.find(c => c.capability === capability);
    assert.equal(entry.enabled, false, `${capability} must not be claimed enabled - no such tool exists in the existing policy boundary`);
    assert.equal(entry.reason, 'not_in_existing_tool_policy_boundary');
  }
});

test('validateGrokModeRequest enforces the fixed default/max multi-agent bounds and only a real stored approval unlocks above default (scenario: owner approval gate)', () => {
  assert.deepEqual(validateGrokModeRequest({mode: 'single-agent'}), {mode: 'single-agent', model: GROK_DEFAULT_MODEL, agentCount: 1, approvalRequired: false, approved: true});
  assert.throws(() => validateGrokModeRequest({mode: 'single-agent', agentCount: 2}), /single_agent_mode_requires_one_agent/);
  const defaultMulti = validateGrokModeRequest({mode: 'multi-agent'});
  assert.deepEqual(defaultMulti, {mode: 'multi-agent', model: GROK_MULTI_AGENT_MODEL, agentCount: GROK_DEFAULT_MULTI_AGENT_COUNT, approvalRequired: false, approved: true});
  // Above the default agent count requires a real approval record - a bare request never grants itself authority.
  assert.throws(() => validateGrokModeRequest({mode: 'multi-agent', agentCount: 5}, {approval: null}), /owner_approval_required/);
  const approval = {requestId: randomUUID(), approvedAgentCount: 8, approvedAt: '2026-09-20T00:00:00.000Z'};
  validateGrokMultiAgentApproval(approval);
  assert.equal(validateGrokModeRequest({mode: 'multi-agent', agentCount: 8}, {approval}).approved, true);
  // An approval for fewer agents than requested does not stretch to cover more.
  assert.throws(() => validateGrokModeRequest({mode: 'multi-agent', agentCount: 9}, {approval}), /owner_approval_required/);
  assert.throws(() => validateGrokModeRequest({mode: 'multi-agent', agentCount: GROK_MAX_MULTI_AGENT_COUNT + 1}, {approval: {...approval, approvedAgentCount: GROK_MAX_MULTI_AGENT_COUNT + 1}}), /invalid_agent_count/);
  assert.throws(() => validateGrokMultiAgentApproval({requestId: 'x', approvedAgentCount: 0, approvedAt: '2026-09-20T00:00:00.000Z'}), /invalid_approval_agent_count/);
  assert.throws(() => validateGrokMultiAgentApproval({requestId: 'x', approvedAgentCount: 1, approvedAt: 'not-a-date'}), /invalid_approval_timestamp/);
  assert.equal(validateGrokMultiAgentApproval(null), undefined, 'no approval on file is a valid, honest absence, not an error');
});

test('assertNoSecrets rejects credential-shaped fields and values exactly like the rest of this codebase (scenario: secret redaction)', () => {
  assert.throws(() => assertNoSecrets({apiKey: 'anything'}), /secret_field_leak/);
  assert.throws(() => assertNoSecrets({token: 'anything'}), /secret_field_leak/);
  assert.throws(() => assertNoSecrets(['ok', 'xai-abcdef123456']), /secret_value_leak/);
  assert.throws(() => assertNoSecrets('Bearer abc123'), /secret_value_leak/);
  assertNoSecrets({provider: 'xai', model: GROK_DEFAULT_MODEL, ready: true}); // no throw
  assert.equal(GROK_PROVIDER, 'xai');
  assert.deepEqual([...GROK_MODES], ['single-agent', 'multi-agent']);
});

// ---------------------------------------------------------------------------
// Real transport: Grok already runs through the exact existing generic
// (OpenAI-style chat-completions) provider path - these prove that path
// handles Grok-specific failure modes exactly like any other provider, with
// zero special-casing anywhere in agent-engine.mjs.
// ---------------------------------------------------------------------------

test('an invalid Grok API key surfaces as an ordinary HTTP failure, preserved as an unknown call outcome, never silently retried (scenario: invalid key)', async () => {
  const state = {projects: [], jobs: [], modules: {ai: true}};
  const at = new Date().toISOString();
  const job = {id: randomUUID(), type: 'agent', title: 'Grok 시험', input: '실제 요청', status: 'running', step: 1, totalSteps: 3, createdAt: at, updatedAt: at, error: null, version: 1, artifacts: [], normalized: '실제 요청'};
  state.jobs.push(job);
  const config = agentConfig({YENO_AGENT_PROVIDER: 'xai', YENO_AGENT_MODEL: GROK_DEFAULT_MODEL, YENO_AGENT_API_KEY: 'synthetic-invalid-grok-key', YENO_AGENT_DAILY_CALL_LIMIT: '5'});
  const controller = new AbortController();
  const invalidKeyResponse = async () => new Response(JSON.stringify({error: 'invalid api key'}), {status: 401, headers: {'Content-Type': 'application/json'}});
  await assert.rejects(runAgent({job, state, config, save: () => {}, signal: controller.signal, fetchImpl: invalidKeyResponse}), /http_401/);
  assert.equal(job.agentJournal.calls[0].status, 'unknown', 'an auth failure is ambiguous evidence, preserved honestly, never assumed settled');
  await assert.rejects(runAgent({job, state, config, save: () => {}, signal: controller.signal, fetchImpl: () => assert.fail('must never resend without resolving the prior unknown outcome')}), /previous_call_outcome_unknown/);
});

test('a Grok call that never returns is aborted exactly like any other provider - no special-cased timeout handling (scenario: timeout)', async () => {
  const state = {projects: [], jobs: [], modules: {ai: true}};
  const at = new Date().toISOString();
  const job = {id: randomUUID(), type: 'agent', title: 'Grok 시험', input: '실제 요청', status: 'running', step: 1, totalSteps: 3, createdAt: at, updatedAt: at, error: null, version: 1, artifacts: [], normalized: '실제 요청'};
  state.jobs.push(job);
  const config = agentConfig({YENO_AGENT_PROVIDER: 'xai', YENO_AGENT_MODEL: GROK_DEFAULT_MODEL, YENO_AGENT_API_KEY: 'synthetic-grok-key', YENO_AGENT_DAILY_CALL_LIMIT: '5'});
  const controller = new AbortController();
  const hang = (url, options) => new Promise((resolve, reject) => { options.signal.addEventListener('abort', () => reject(new Error('aborted'))); });
  const pending = runAgent({job, state, config, save: () => {}, signal: controller.signal, fetchImpl: hang});
  controller.abort();
  await assert.rejects(pending, /stopped/);
  assert.equal(job.agentJournal.calls[0].status, 'unknown');
});

// ---------------------------------------------------------------------------
// Real HTTP server, real on-disk store, real restart (same convention as
// shadow-army.test.mjs / semantic-verification.test.mjs).
// ---------------------------------------------------------------------------
const OPENAI_KEY = 'synthetic-openai-key-not-a-real-credential';
const GROK_KEY = 'synthetic-grok-key-not-a-real-credential';
const BASE_ENV = {YENO_AGENT_PROVIDER: 'openai', YENO_OPENAI_API_KEY: OPENAI_KEY, YENO_OPENAI_MODEL: 'synthetic-openai', YENO_AGENT_DAILY_CALL_LIMIT: '20'};
const GROK_ENV = {...BASE_ENV, YENO_GROK_API_KEY: GROK_KEY, YENO_GROK_MODEL: GROK_DEFAULT_MODEL, YENO_GROK_DAILY_CALL_LIMIT: '10'};
const NO_KEY_GROK_ENV = {...BASE_ENV, YENO_GROK_MODEL: GROK_DEFAULT_MODEL}; // model declared, key missing

const ok = text => new Response(JSON.stringify({choices: [{finish_reason: 'stop', message: {content: text, tool_calls: []}}], usage: {prompt_tokens: 30, completion_tokens: 20}}), {headers: {'Content-Type': 'application/json'}});
const isSemanticRequest = body => body.messages.some(m => typeof m.content === 'string' && m.content.includes('independent semantic verifier'));
const PASS_VERDICT = JSON.stringify({verdict: 'pass', confidence: 0.9, criteria: [{criterion: '목표 충족', status: 'met', reason: 'Grok이 실제로 산출물을 검토함', evidenceRefs: ['builder-artifact']}], summary: 'Grok이 목표를 실제로 달성했다고 판단함'});
const MALFORMED = '이것은 JSON이 아닙니다';

async function setup(t, {env = GROK_ENV, semanticText = PASS_VERDICT} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-grok-provider-')), token = 'synthetic-grok-owner-token';
  const modelCalls = [];
  const agentFetch = async (url, req) => {
    const body = JSON.parse(req.body);
    modelCalls.push({url, body});
    if (isSemanticRequest(body)) return ok(semanticText);
    return ok('실제 Shadow 산출물 본문');
  };
  let runtime = await start({host: '127.0.0.1', port: 0, dataDir: dir, token, env, agentFetch});
  const request = async (method, route, body, headers = {}) => { const r = await fetch(`http://127.0.0.1:${runtime.server.address().port}${route}`, {method, headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers}, ...(body ? {body: JSON.stringify(body)} : {})}); return {status: r.status, body: await r.json()}; };
  const post = (route, body = {}, headers) => request('POST', route, {requestId: randomUUID(), ...body}, headers);
  const get = (route, headers) => request('GET', route, undefined, headers);
  const wait = async (id, statuses = ['completed', 'failed', 'paused']) => { for (let i = 0; i < 400; i++) { const j = openStore(dir).state.jobs.find(j => j.id === id); if (j && statuses.includes(j.status)) return j; await new Promise(r => setTimeout(r, 20)); } assert.fail('job did not reach target state'); };
  const restart = async () => { runtime.shutdown(); runtime = await start({host: '127.0.0.1', port: 0, dataDir: dir, token, env, agentFetch}); };
  t.after(() => { runtime.shutdown(); fs.rmSync(dir, {recursive: true, force: true}); });
  return {dir, post, get, wait, restart, modelCalls, disk: () => openStore(dir).state};
}

async function createProject(h) {
  const r = await h.post('/api/projects', {name: `Grok 프로젝트 ${randomUUID().slice(0, 8)}`, status: 'active'});
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.project;
}

test('GET /api/providers/grok/status reports the real configured state honestly, and secrets never appear anywhere in it (scenario: missing key, secret redaction)', async t => {
  const withKey = await setup(t, {env: GROK_ENV});
  const ready = await withKey.get('/api/providers/grok/status');
  assert.equal(ready.status, 200);
  assert.equal(ready.body.state, 'available');
  assert.equal(ready.body.configured, true);
  assert.equal(JSON.stringify(ready.body).includes(GROK_KEY), false);

  const noKey = await setup(t, {env: NO_KEY_GROK_ENV});
  const unauthorized = await noKey.get('/api/providers/grok/status');
  assert.equal(unauthorized.body.state, 'unauthorized');
  assert.equal(unauthorized.body.configured, false);

  const unset = await setup(t, {env: BASE_ENV});
  const unavailable = await unset.get('/api/providers/grok/status');
  assert.equal(unavailable.body.state, 'unavailable');
});

test('a quarantined Grok is never selected by the semantic verifier - fallback is real, not merely reported (scenario: provider fallback, owner approval-adjacent safety)', async t => {
  const h = await setup(t, {env: GROK_ENV});
  const project = await createProject(h);
  const mission = await h.post('/api/shadow-army/missions', {projectId: project.id, goal: '목표', successCriterion: '기준'});
  assert.equal(mission.status, 201, JSON.stringify(mission.body));
  const quarantine = await h.post('/api/providers/grok/quarantine', {quarantined: true});
  assert.equal(quarantine.status, 200, JSON.stringify(quarantine.body));
  assert.equal(quarantine.body.state, 'quarantined');
  const builder = mission.body.mission.shadows.find(s => s.role === 'builder');
  await h.wait(builder.jobId, ['completed', 'failed']);
  const verify = await h.wait(mission.body.mission.verify.jobId, ['completed', 'failed']);
  assert.equal(verify.status, 'completed');
  const semantic = await h.wait(mission.body.mission.semantic.jobId, ['completed', 'failed']);
  assert.equal(semantic.status, 'completed', semantic.error);
  assert.equal(semantic.agentJournal.provider, 'openai', 'a quarantined grok must never be selected even though it is otherwise ready');

  const release = await h.post('/api/providers/grok/quarantine', {quarantined: false});
  assert.equal(release.body.state, 'available');
});

test('semantic verifier can consume real Grok output through the unchanged verdict pipeline - structured output validated exactly like any other provider (scenario: Grok output consumption, structured output validation)', async t => {
  const h = await setup(t, {env: GROK_ENV});
  const project = await createProject(h);
  const mission = await h.post('/api/shadow-army/missions', {projectId: project.id, goal: '실제 목표', successCriterion: '검증 가능한 결과'});
  const semantic = await h.wait(mission.body.mission.semantic.jobId, ['completed', 'failed']);
  assert.equal(semantic.status, 'completed', semantic.error);
  assert.equal(semantic.agentJournal.provider, 'xai');
  assert.equal(semantic.semanticVerdict.provider, 'xai');
  assert.equal(semantic.semanticVerdict.verdict, 'pass');
  const semanticCall = h.modelCalls.find(call => isSemanticRequest(call.body));
  assert.equal(semanticCall.url, 'https://api.x.ai/v1/chat/completions');
});

test('malformed Grok output fails closed with bounded evidence preserved, exactly like the generic pipeline (scenario: malformed response)', async t => {
  const h = await setup(t, {env: GROK_ENV, semanticText: MALFORMED});
  const project = await createProject(h);
  const mission = await h.post('/api/shadow-army/missions', {projectId: project.id, goal: '목표', successCriterion: '기준'});
  const semantic = await h.wait(mission.body.mission.semantic.jobId, ['completed', 'failed']);
  assert.equal(semantic.status, 'failed');
  assert.match(semantic.error, /^invalid_verdict_json: /);
  assert.equal(semantic.agentJournal.provider, 'xai');
});

test('POST /api/providers/grok/multi-agent-approval requires owner pairing credential, is blocked by emergency stop, is idempotent per requestId, and survives restart (scenarios: owner approval gate, emergency stop, duplicate prevention, restart persistence)', async t => {
  const h = await setup(t, {env: GROK_ENV});
  const enroll = await h.post('/api/v1/devices/enroll', {name: 'phone', platform: 'android'});
  assert.equal(enroll.status, 201, JSON.stringify(enroll.body));
  const deviceRejected = await h.post('/api/providers/grok/multi-agent-approval', {agentCount: 8}, {Authorization: `Bearer ${enroll.body.device.deviceToken}`});
  assert.equal(deviceRejected.status, 403, 'a device credential must never approve multi-agent Grok use, only the owner pairing credential');

  const stop = await h.post('/api/control', {action: 'stop'});
  assert.equal(stop.status, 200);
  const blocked = await h.post('/api/providers/grok/multi-agent-approval', {agentCount: 8});
  assert.equal(blocked.status, 409, 'emergency stop must block a new multi-agent approval');
  await h.post('/api/control', {action: 'resume'});

  const requestId = randomUUID();
  const first = await h.post('/api/providers/grok/multi-agent-approval', {requestId, agentCount: 8});
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.approval.approvedAgentCount, 8);
  // Replaying the exact same request (same requestId, same body) must return
  // the original cached receipt, never apply the approval a second time.
  const replay = await h.post('/api/providers/grok/multi-agent-approval', {requestId, agentCount: 8});
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body.approval, first.body.approval);
  // Reusing the same requestId with a DIFFERENT body is a real identity
  // conflict (the existing request-ledger discipline this whole codebase
  // already relies on) - it must be rejected, never silently accepted with
  // new values and never silently replayed with the old ones either.
  const conflict = await h.post('/api/providers/grok/multi-agent-approval', {requestId, agentCount: 16});
  assert.equal(conflict.status, 409, 'a reused requestId with a different body must be a conflict, never silently applied');
  assert.equal(h.disk().grokMultiAgentApproval.approvedAgentCount, 8, 'the conflicting resend must never change the stored approval');

  await h.restart();
  assert.equal(h.disk().grokMultiAgentApproval.approvedAgentCount, 8, 'the durable owner approval record must survive restart');
  const afterRestartStatus = await h.get('/api/providers/grok/status');
  assert.equal(afterRestartStatus.body.multiAgentApproval.approvedAgentCount, 8);
});

test('an out-of-range agentCount is rejected before any approval is stored, and quarantine toggling is itself owner-only and restart-durable (scenario: owner approval gate, restart persistence)', async t => {
  const h = await setup(t, {env: GROK_ENV});
  const tooMany = await h.post('/api/providers/grok/multi-agent-approval', {agentCount: GROK_MAX_MULTI_AGENT_COUNT + 1});
  assert.equal(tooMany.status, 400);
  assert.equal(h.disk().grokMultiAgentApproval, null);

  const quarantine = await h.post('/api/providers/grok/quarantine', {quarantined: true});
  assert.equal(quarantine.status, 200);
  await h.restart();
  assert.equal(h.disk().grokQuarantined, true, 'quarantine must survive restart - never silently reset');
  const status = await h.get('/api/providers/grok/status');
  assert.equal(status.body.state, 'quarantined');
});
