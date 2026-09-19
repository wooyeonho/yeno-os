import crypto from 'node:crypto';

// BLACKHOLE JEV v0 (issue #25 §4.6 / §5.1) — pure typed decision contract only.
//
// JEV is not a chatbot. It is a narrow, typed judgment layer: given a
// redacted structured `state`, a fixed set of typed `questions`, the
// `evidenceRefs` that back them, and the caller's `policyContext`, it returns
// one typed `answer` per question with its own `confidence`,
// `decisionStatus` (`decided | uncertain | abstain | blocked`), the evidence
// it actually used, and the exact engine/calibration version that produced
// it. No provider call, no model call, no network access, no secrets. This
// v0 slice has no learned calibration set yet — `JEV_CALIBRATION_VERSION`
// names the deterministic ruleset itself, honestly, rather than inventing a
// fake dataset version.
//
// v0's only wiring target is Phase D Shadow Army, in shadow mode: JEV
// computes `dispatch / hold / escalate`, `dependencyReady`, `parallelSafe`
// and `verifierEscalate` answers for real shadow jobs *alongside* the real
// scheduler's existing deterministic path (shadow-army.mjs's
// `shadowDependenciesMet` / `shadowBlockReason` / `verifyShadowArtifacts`),
// purely for comparison. `authorizesDispatch` is fixed `false`: nothing here
// starts, holds, or reassigns a real job. The real scheduler decision in
// server.mjs is computed exactly as before this module exists; JEV's answer
// is recorded next to it, never substituted for it.
export const JEV_ENGINE_VERSION = 'jev-v0.1.0';
// No labeled outcome dataset exists yet to calibrate against, so v0's
// "calibration" *is* the named deterministic ruleset below. A future
// version-labeled decision set (§4.6 step 4) gets its own calibration id.
export const JEV_CALIBRATION_VERSION = 'jev-baseline-rules-v0';
export const DECISION_STATUSES = Object.freeze(['decided', 'uncertain', 'abstain', 'blocked']);

export const JEV_QUESTIONS = Object.freeze({
  shadowDispatch: Object.freeze({id: 'shadowDispatch', kind: 'choice', options: Object.freeze(['dispatch', 'hold', 'escalate'])}),
  dependencyReady: Object.freeze({id: 'dependencyReady', kind: 'boolean'}),
  parallelSafe: Object.freeze({id: 'parallelSafe', kind: 'boolean'}),
  verifierEscalate: Object.freeze({id: 'verifierEscalate', kind: 'boolean'}),
});
export const SHADOW_DISPATCH_QUESTIONS = Object.freeze(['dependencyReady', 'parallelSafe', 'shadowDispatch']);

const SECRET_KEY = /key|secret|token|password|credential|authorization/i;
const SECRET_VALUE = /^(?:sk-|xai-|nvapi-|AIza|ya29\.|Bearer\s)/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export class JevError extends Error {
  constructor(message, code = 'JEV_INVALID') { super(message); this.code = code; }
}
const fail = (message, code) => { throw new JevError(message, code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const uuid = value => typeof value === 'string' && UUID.test(value);
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
  : JSON.stringify(value);
const sha256 = value => crypto.createHash('sha256').update(canonical(value)).digest('hex');

// JEV is Owner-only (§4.6, §8). No credential-shaped field or value may ever
// enter a DecisionRequest/DecisionResponse, its evidence, or its log.
export function assertNoSecrets(value, path = '$') {
  if (typeof value === 'string') {
    if (SECRET_VALUE.test(value)) fail(`${path}: 자격 증명 형태의 값은 JEV에 들어올 수 없습니다.`, 'JEV_SECRET');
    return;
  }
  if (Array.isArray(value)) { value.forEach((item, index) => assertNoSecrets(item, `${path}[${index}]`)); return; }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) fail(`${path}.${key}: 자격 증명 이름의 필드는 JEV에 들어올 수 없습니다.`, 'JEV_SECRET');
      assertNoSecrets(item, `${path}.${key}`);
    }
  }
}

const REQUEST_FIELDS = ['state', 'questions', 'evidenceRefs', 'policyContext'];

export function validateDecisionRequest(request) {
  if (!exact(request, REQUEST_FIELDS)) fail(`DecisionRequest는 정확히 ${REQUEST_FIELDS.join(', ')} 필드를 가져야 합니다.`);
  assertNoSecrets(request, 'request');
  if (!object(request.state)) fail('state는 객체여야 합니다.');
  if (!Array.isArray(request.questions) || request.questions.length === 0 || request.questions.some(q => typeof q !== 'string' || !JEV_QUESTIONS[q])) {
    fail('questions는 알려진 질문 id의 비어있지 않은 배열이어야 합니다.');
  }
  if (!Array.isArray(request.evidenceRefs) || request.evidenceRefs.some(ref => !object(ref) || typeof ref.type !== 'string' || typeof ref.id !== 'string')) {
    fail('evidenceRefs는 {type,id} 객체 배열이어야 합니다.');
  }
  if (!object(request.policyContext)) fail('policyContext는 객체여야 합니다.');
  return request;
}

function answerOf(status, value, confidence, evidenceUsed) {
  return {value, confidence, decisionStatus: status, evidenceUsed};
}

// Each evaluator independently derives its typed answer from raw evidence in
// `state` — it does not simply echo a value the caller already computed.
// This is what makes the shadow-mode comparison in server.mjs meaningful:
// JEV's `dependencyReady` is checked against shadow-army.mjs's
// `shadowDependenciesMet` on the exact same real job records, not trusted by
// construction.
function evaluateDependencyReady(state) {
  const ids = state.dependsOnJobIds;
  if (!ids.length) return answerOf('decided', true, 1, []);
  const evidenceUsed = ids.map(id => ({type: 'job', id}));
  if (ids.some(id => state.jobStatuses[id] === undefined)) return answerOf('abstain', null, 0, evidenceUsed);
  return answerOf('decided', ids.every(id => state.jobStatuses[id] === 'completed'), 1, evidenceUsed);
}

function evaluateParallelSafe(state) {
  if (!Number.isFinite(state.concurrencyLimit) || !Number.isFinite(state.activeCount)) return answerOf('abstain', null, 0, []);
  return answerOf('decided', state.activeCount < state.concurrencyLimit, 1, [{type: 'scheduler', id: 'concurrency'}]);
}

function evaluateShadowDispatch(state, answers, policyContext) {
  if (policyContext.emergencyStop) return answerOf('blocked', null, 0, [{type: 'policy', id: 'emergencyStop'}]);
  if (state.blockReason === 'projectChanged') return answerOf('decided', 'escalate', 1, [{type: 'project', id: state.dependsOnJobIds.length ? 'dependency' : 'self'}]);
  if (['providerMissing', 'moduleDisabled', 'outcomeUnknown'].includes(state.blockReason)) return answerOf('decided', 'hold', 1, [{type: 'policy', id: state.blockReason}]);
  const dependencyReady = answers.dependencyReady;
  if (!dependencyReady || dependencyReady.decisionStatus !== 'decided') return answerOf('uncertain', 'hold', 0.5, dependencyReady?.evidenceUsed ?? []);
  if (dependencyReady.value === false) return answerOf('decided', 'hold', 1, dependencyReady.evidenceUsed);
  const parallelSafe = answers.parallelSafe;
  if (!parallelSafe || parallelSafe.decisionStatus !== 'decided') return answerOf('uncertain', 'hold', 0.5, parallelSafe?.evidenceUsed ?? []);
  if (parallelSafe.value === false) return answerOf('decided', 'hold', 1, parallelSafe.evidenceUsed);
  return answerOf('decided', 'dispatch', 1, [...dependencyReady.evidenceUsed, ...parallelSafe.evidenceUsed]);
}

function evaluateVerifierEscalate(state) {
  if (!object(state.verifyResult)) return answerOf('uncertain', null, 0, []);
  const evidenceUsed = [{type: 'job', id: state.verifyJobId ?? 'verify'}];
  if (typeof state.verifyResult.verified !== 'boolean') return answerOf('abstain', null, 0, evidenceUsed);
  return answerOf('decided', state.verifyResult.verified === false, 1, evidenceUsed);
}

// Evaluation order across ALL known questions, not just the shadow-dispatch
// ones - `shadowDispatch` must run after `dependencyReady`/`parallelSafe`
// (it reads their answers), everything else is order-independent.
const RESPONSE_ORDER = ['dependencyReady', 'parallelSafe', 'verifierEscalate', 'shadowDispatch'];

// Evaluates every requested question. Questions are logically independent
// (each one's evidence is read straight from `state`), so evaluating them
// together is exactly the "여러 typed 질문의 병렬 평가" this slice calls for;
// `shadowDispatch` is the one composite question that reads the other two
// answers already computed in the same pass rather than re-deriving them.
export function evaluateDecisions(request, at) {
  validateDecisionRequest(request);
  if (typeof at !== 'string' || !ISO.test(at)) fail('at은 ISO 8601 문자열이어야 합니다.');
  const started = Date.now();
  const answers = {};
  for (const id of RESPONSE_ORDER) if (request.questions.includes(id)) {
    if (id === 'dependencyReady') answers[id] = evaluateDependencyReady(request.state);
    else if (id === 'parallelSafe') answers[id] = evaluateParallelSafe(request.state);
    else if (id === 'shadowDispatch') answers[id] = evaluateShadowDispatch(request.state, answers, request.policyContext);
    else if (id === 'verifierEscalate') answers[id] = evaluateVerifierEscalate(request.state);
  }
  const latencyMs = Date.now() - started;
  const response = {
    answers: Object.fromEntries(Object.entries(answers).map(([id, a]) => [id, a.value])),
    confidence: Object.fromEntries(Object.entries(answers).map(([id, a]) => [id, a.confidence])),
    decisionStatus: Object.fromEntries(Object.entries(answers).map(([id, a]) => [id, a.decisionStatus])),
    evidenceUsed: Object.fromEntries(Object.entries(answers).map(([id, a]) => [id, a.evidenceUsed])),
    engineVersion: JEV_ENGINE_VERSION,
    calibrationVersion: JEV_CALIBRATION_VERSION,
    evaluatedAt: at,
    usage: {modelCalls: 0},
  };
  assertNoSecrets(response, 'response');
  const fingerprint = sha256(response);
  return {...response, latencyMs, authorizesDispatch: false, fingerprint};
}

// The one adapter this slice wires to a real caller (server.mjs's
// scheduler): packages exactly the real, already-available facts a queued
// shadow worker job's dispatch decision needs — the caller's own
// `shadowBlockReason` result (never recomputed here, so there is one source
// of truth for *why* something is blocked), real sibling job statuses for
// its declared dependencies, and the real concurrency snapshot. Nothing here
// reads a job the caller didn't already look at.
export function buildShadowDispatchRequest({job, jobs, blockReason, concurrencyLimit, activeCount, emergencyStop}) {
  const deps = job.shadowAssignment.dependsOnJobIds;
  const jobStatuses = Object.fromEntries(deps.map(id => [id, jobs.find(j => j.id === id)?.status]));
  return {
    state: {dependsOnJobIds: deps, jobStatuses, concurrencyLimit, activeCount, blockReason: blockReason ?? null},
    questions: SHADOW_DISPATCH_QUESTIONS,
    evidenceRefs: [{type: 'job', id: job.id}, ...deps.map(id => ({type: 'job', id}))],
    policyContext: {emergencyStop: Boolean(emergencyStop), missionId: job.shadowAssignment.missionId, role: job.shadowAssignment.role},
  };
}

export function buildVerifierEscalateRequest({verifyJob, verifyResult, emergencyStop}) {
  return {
    state: {dependsOnJobIds: [], jobStatuses: {}, concurrencyLimit: Infinity, activeCount: 0, blockReason: null, verifyJobId: verifyJob.id, verifyResult: verifyResult ?? null},
    questions: ['verifierEscalate'],
    evidenceRefs: [{type: 'job', id: verifyJob.id}],
    policyContext: {emergencyStop: Boolean(emergencyStop), missionId: verifyJob.shadowAssignment.missionId, role: 'verifier'},
  };
}

// Real vs JEV comparison, for the bounded shadow-mode log only — never used
// to gate anything. `escalate` never currently matches a real decision
// because the real scheduler has no escalation path yet (§5.1: JEV gets no
// dispatch authority in this slice); that mismatch is an honest, expected
// observation, not a bug to silently reconcile away.
export function shadowDispatchMatchesReal(jevAnswer, realDecision) {
  return jevAnswer === realDecision;
}

// Bounded shadow-mode observation log (state.jevShadowLog) — an additive,
// capped array, the same rolling-log idiom used elsewhere in this codebase.
// It exists purely so an Owner (or a later evaluation phase) can inspect how
// often JEV's baseline agrees with the real scheduler; nothing reads it back
// to make a decision.
export const JEV_SHADOW_LOG_CAP = 200;
const LOG_ENTRY_FIELDS = ['at', 'jobId', 'missionId', 'role', 'jevAnswer', 'jevConfidence', 'jevStatus', 'realDecision', 'matchedRealDecision', 'engineVersion', 'calibrationVersion', 'fingerprint'];

export function shadowDispatchLogEntry({at, job, response, realDecision}) {
  const entry = {
    at, jobId: job.id, missionId: job.shadowAssignment.missionId, role: job.shadowAssignment.role,
    jevAnswer: response.answers.shadowDispatch ?? null, jevConfidence: response.confidence.shadowDispatch ?? 0,
    jevStatus: response.decisionStatus.shadowDispatch, realDecision,
    matchedRealDecision: shadowDispatchMatchesReal(response.answers.shadowDispatch, realDecision),
    engineVersion: response.engineVersion, calibrationVersion: response.calibrationVersion, fingerprint: response.fingerprint,
  };
  validateJevShadowLog([entry]);
  return entry;
}

// JEV Shadow Mode evaluation/calibration (master directive v2 §4.2/§5.E) -
// pure aggregation over the real, already-validated shadow-mode log. This is
// the required "기존 scheduler와 JEV 판단의 일치율 / false positive / false
// negative / abstain rate / confidence" evaluation - it reads the log only,
// computes nothing new about any job, and grants JEV no authority. With the
// real decision (`realDecision`) as the reference (the real scheduler is
// still the only thing that ever actually dispatches), a "false positive" is
// JEV answering 'dispatch' when the real path held; a "false negative" is
// JEV answering 'hold'/'escalate' when the real path dispatched anyway. An
// empty log returns null counts, never a fabricated 0% or 100%.
export function calibrateShadowLog(log) {
  validateJevShadowLog(log);
  const sampleSize = log.length;
  if (sampleSize === 0) {
    return {sampleSize: 0, matchRate: null, abstainRate: null, falsePositiveRate: null, falseNegativeRate: null, avgConfidenceOverall: null, avgConfidenceWhenDecided: null, byAnswer: {dispatch: 0, hold: 0, escalate: 0, null: 0}, byStatus: {decided: 0, uncertain: 0, abstain: 0, blocked: 0}};
  }
  const decided = log.filter(e => e.jevStatus === 'decided');
  const falsePositives = log.filter(e => e.jevAnswer === 'dispatch' && e.realDecision === 'hold');
  const falseNegatives = log.filter(e => e.jevAnswer !== 'dispatch' && e.realDecision === 'dispatch');
  const byAnswer = {dispatch: 0, hold: 0, escalate: 0, null: 0};
  for (const entry of log) byAnswer[entry.jevAnswer === null ? 'null' : entry.jevAnswer]++;
  const byStatus = {decided: 0, uncertain: 0, abstain: 0, blocked: 0};
  for (const entry of log) byStatus[entry.jevStatus]++;
  const sum = values => values.reduce((total, value) => total + value, 0);
  return {
    sampleSize,
    matchRate: decided.length ? sum(decided.map(e => e.matchedRealDecision ? 1 : 0)) / decided.length : null,
    abstainRate: (sampleSize - decided.length) / sampleSize,
    falsePositiveRate: falsePositives.length / sampleSize,
    falseNegativeRate: falseNegatives.length / sampleSize,
    avgConfidenceOverall: sum(log.map(e => e.jevConfidence)) / sampleSize,
    avgConfidenceWhenDecided: decided.length ? sum(decided.map(e => e.jevConfidence)) / decided.length : null,
    byAnswer, byStatus,
    engineVersion: JEV_ENGINE_VERSION, calibrationVersion: JEV_CALIBRATION_VERSION,
  };
}

export function validateJevShadowLog(log) {
  if (!Array.isArray(log)) fail('jevShadowLog는 배열이어야 합니다.');
  if (log.length > JEV_SHADOW_LOG_CAP) fail('jevShadowLog가 보존 한도를 초과했습니다.');
  for (const entry of log) {
    if (!exact(entry, LOG_ENTRY_FIELDS)) fail(`jevShadowLog 항목은 정확히 ${LOG_ENTRY_FIELDS.join(', ')} 필드를 가져야 합니다.`);
    assertNoSecrets(entry, 'jevShadowLog[]');
    if (typeof entry.at !== 'string' || !ISO.test(entry.at)) fail('jevShadowLog 항목의 at은 ISO 8601이어야 합니다.');
    if (typeof entry.jobId !== 'string' || !entry.jobId) fail('jevShadowLog 항목의 jobId가 잘못되었습니다.');
    if (!uuid(entry.missionId)) fail('jevShadowLog 항목의 missionId가 잘못되었습니다.');
    if (!['scout', 'researcher', 'builder', 'verifier'].includes(entry.role)) fail('jevShadowLog 항목의 role이 잘못되었습니다.');
    if (![...JEV_QUESTIONS.shadowDispatch.options, null].includes(entry.jevAnswer)) fail('jevShadowLog 항목의 jevAnswer가 잘못되었습니다.');
    if (typeof entry.jevConfidence !== 'number' || entry.jevConfidence < 0 || entry.jevConfidence > 1) fail('jevShadowLog 항목의 jevConfidence는 0~1이어야 합니다.');
    if (!DECISION_STATUSES.includes(entry.jevStatus)) fail('jevShadowLog 항목의 jevStatus가 잘못되었습니다.');
    if (!['dispatch', 'hold'].includes(entry.realDecision)) fail('jevShadowLog 항목의 realDecision이 잘못되었습니다.');
    if (typeof entry.matchedRealDecision !== 'boolean') fail('jevShadowLog 항목의 matchedRealDecision은 boolean이어야 합니다.');
    if (entry.engineVersion !== JEV_ENGINE_VERSION) fail('알 수 없는 jevShadowLog engineVersion입니다.');
    if (entry.calibrationVersion !== JEV_CALIBRATION_VERSION) fail('알 수 없는 jevShadowLog calibrationVersion입니다.');
    if (typeof entry.fingerprint !== 'string' || entry.fingerprint.length !== 64) fail('jevShadowLog 항목의 fingerprint가 잘못되었습니다.');
  }
}
