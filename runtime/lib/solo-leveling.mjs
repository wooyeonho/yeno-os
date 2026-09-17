import {validateOutcomeVerdict, assertNoSecrets, sha256} from './outcome-verification.mjs';

// BLACKHOLE Solo Leveling — evidence-backed per-skill history (pure, no wiring).
//
//   E  registered           entry exists in the capability registry
//   D  real success         registry `run` record + execution record verified (executionVerified:true)
//   C  repeated success     ≥2 verified successes on distinct inputSha256
//   B  composition          a verified success whose inputSha256 IS another skill's earlier verified outputSha256
//   A  autonomy             ≥3 autopilot-authorized verified successes with zero recorded owner interventions
//   S  external outcome     a PHASE 5 verdict with outcomeVerified && highGradeCandidate linked to one of this skill's successes
//
// Every count below is derived from evidence records the caller already holds
// (registry history, execution records, intervention records, outcome verdicts).
// Nothing is inferred from a claim, a number or a model; a grade that its
// evidence no longer supports is demoted, never kept. All timestamps come from
// the evidence itself, so the same evidence yields the same history and
// fingerprint after restart. This module grants no execution authority.
export const SOLO_LEVELING_VERSION = 1;
export const GRADES = Object.freeze(['E', 'D', 'C', 'B', 'A', 'S']);
export const AUTONOMY_MIN_SUCCESSES = 3;
export const AUTHORIZERS = Object.freeze(['owner', 'autopilot']);
export const INTERVENTION_KINDS = Object.freeze(['pause', 'stop', 'manual_run', 'rollback', 'correction', 'retry']);
export const EXECUTION_FIELDS = Object.freeze(['jobId', 'skillId', 'status', 'executionVerified', 'authorizedBy', 'at']);
export const INTERVENTION_FIELDS = Object.freeze(['jobId', 'skillId', 'kind', 'by', 'at']);
export const HISTORY_FIELDS = Object.freeze(['version', 'skillId', 'registered', 'successes', 'failures', 'compositions', 'interventions', 'verifiedOutcomes', 'grade', 'checks', 'promotions', 'fingerprint']);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export class SoloLevelingError extends Error {
  constructor(message, code = 'LEVELING_INVALID') {super(message); this.code = code;}
}
const fail = (message, code) => {throw new SoloLevelingError(message, code);};
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const byAtThenId = (a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : a.jobId < b.jobId ? -1 : a.jobId > b.jobId ? 1 : 0;

function validateRegistry(registry) {
  if (!registry || !Array.isArray(registry.entries) || !Array.isArray(registry.history)) fail('registry는 {entries[], history[]}여야 합니다.');
  for (const h of registry.history) {
    if (!exact(h, ['at', 'action', 'id', 'hash', 'runId', 'inputSha256', 'outputSha256']) || !ISO.test(h.at)) fail('registry history 기록이 올바르지 않습니다.');
    if (h.action === 'run' && (!UUID.test(h.runId ?? '') || !HASH.test(h.inputSha256 ?? '') || !HASH.test(h.outputSha256 ?? ''))) fail('run 기록에는 runId·inputSha256·outputSha256이 필요합니다.');
  }
}
function validateExecution(record) {
  if (!exact(record, EXECUTION_FIELDS)) fail(`execution 기록은 정확히 ${EXECUTION_FIELDS.join(', ')} 필드를 가져야 합니다.`);
  if (!UUID.test(record.jobId) || !ID.test(record.skillId) || !['completed', 'failed'].includes(record.status) || typeof record.executionVerified !== 'boolean' || !AUTHORIZERS.includes(record.authorizedBy) || !ISO.test(record.at)) fail('execution 기록 값이 올바르지 않습니다.');
}
function validateIntervention(record) {
  if (!exact(record, INTERVENTION_FIELDS)) fail(`intervention 기록은 정확히 ${INTERVENTION_FIELDS.join(', ')} 필드를 가져야 합니다.`);
  if (!UUID.test(record.jobId) || !ID.test(record.skillId) || !INTERVENTION_KINDS.includes(record.kind) || record.by !== 'owner' || !ISO.test(record.at)) fail('intervention 기록 값이 올바르지 않습니다.');
}

// Successes are the intersection of "the registry says this skill ran"
// (real runId/input/output hashes) and "the execution was verified" (PHASE 5
// verifyExecution on that very job). Either half alone counts for nothing.
function successesFor(registry, executions, skillId) {
  const runs = registry.history.filter(h => h.action === 'run' && h.id === skillId);
  const out = [];
  for (const execution of executions) {
    if (execution.skillId !== skillId || execution.status !== 'completed' || execution.executionVerified !== true) continue;
    const run = runs.find(r => r.runId === execution.jobId);
    if (!run) continue;
    out.push({jobId: execution.jobId, at: run.at, inputSha256: run.inputSha256, outputSha256: run.outputSha256, authorizedBy: execution.authorizedBy});
  }
  return dedupe(out).sort(byAtThenId);
}
const dedupe = records => records.filter((r, i) => records.findIndex(x => x.jobId === r.jobId) === i);

function failuresFor(registry, executions, skillId) {
  const runIds = new Set(registry.history.filter(h => h.action === 'run' && h.id === skillId).map(h => h.runId));
  return dedupe(executions.filter(e => e.skillId === skillId && (e.status === 'failed' || (e.status === 'completed' && (e.executionVerified !== true || !runIds.has(e.jobId)))))
    .map(e => ({jobId: e.jobId, at: e.at, status: e.status, executionVerified: e.executionVerified, authorizedBy: e.authorizedBy}))).sort(byAtThenId);
}

// Composition evidence is structural: this skill consumed, byte for byte, what
// another skill produced earlier (input hash == the other skill's verified
// output hash). Both ends must be verified successes.
function compositionsFor(registry, executions, skillId, successes) {
  const others = registry.entries.map(e => e.id).filter(id => id !== skillId);
  const upstream = others.flatMap(id => successesFor(registry, executions, id).map(s => ({...s, skillId: id})));
  return successes.flatMap(s => upstream.filter(u => u.outputSha256 === s.inputSha256 && u.at <= s.at)
    .map(u => ({jobId: s.jobId, at: s.at, upstreamSkillId: u.skillId, upstreamJobId: u.jobId, sha256: s.inputSha256})))
    .sort((a, b) => byAtThenId(a, b) || (a.upstreamJobId < b.upstreamJobId ? -1 : 1));
}

function verifiedOutcomesFor(verdicts, successes) {
  const jobs = new Set(successes.map(s => s.jobId));
  return verdicts.filter(v => v.outcomeVerified === true && jobs.has(v.jobId))
    .map(v => ({verdictFingerprint: v.fingerprint, evidenceFingerprint: v.evidenceFingerprint, jobId: v.jobId, metric: v.metric, ledger: v.ledger, verificationType: v.verificationType, highGradeCandidate: v.highGradeCandidate === true, at: v.checkedAt}))
    .filter((r, i, all) => all.findIndex(x => x.verdictFingerprint === r.verdictFingerprint) === i)
    .sort((a, b) => a.verdictFingerprint < b.verdictFingerprint ? -1 : 1);
}

function grade(registered, successes, compositions, interventions, verifiedOutcomes) {
  const checks = {};
  checks.D = registered && successes.length >= 1 ? {met: true, at: successes[0].at} : {met: false, reason: registered ? '검증된 실제 성공 실행이 없습니다.' : '등록된 기능이 아닙니다.'};
  const distinct = new Set(successes.map(s => s.inputSha256));
  checks.C = checks.D.met && distinct.size >= 2 ? {met: true, at: secondDistinct(successes)} : {met: false, reason: '서로 다른 입력에서 검증된 성공 2건 이상이 없습니다.'};
  checks.B = checks.C.met && compositions.length ? {met: true, at: compositions[0].at} : {met: false, reason: '다른 기능의 검증된 출력을 입력으로 소비한 조합 증거가 없습니다.'};
  const intervened = new Set(interventions.map(i => i.jobId));
  const autonomous = successes.filter(s => s.authorizedBy === 'autopilot' && !intervened.has(s.jobId));
  checks.A = checks.B.met && autonomous.length >= AUTONOMY_MIN_SUCCESSES ? {met: true, at: autonomous[AUTONOMY_MIN_SUCCESSES - 1].at}
    : {met: false, reason: `소유자 개입 없는 자율 성공 ${AUTONOMY_MIN_SUCCESSES}건 이상이 없습니다 (현재 ${autonomous.length}건, 개입 ${interventions.length}건).`};
  const high = verifiedOutcomes.filter(v => v.highGradeCandidate);
  checks.S = checks.A.met && high.length ? {met: true, at: high.map(v => v.at).sort()[0]} : {met: false, reason: '외부 검증(external_verified)된 성과 verdict가 이 기능의 성공 실행에 연결돼 있지 않습니다.'};
  let current = 'E';
  for (const step of ['D', 'C', 'B', 'A', 'S']) {if (checks[step].met) current = step; else break;}
  return {grade: current, checks};
}
function secondDistinct(successes) {
  const seen = new Set();
  for (const s of successes) {seen.add(s.inputSha256); if (seen.size === 2) return s.at;}
  return null;
}

export function historyFingerprint(history) {
  const {fingerprint, ...body} = history;
  return sha256(body);
}

export function validateSkillHistory(history) {
  if (!exact(history, HISTORY_FIELDS)) fail(`skill history는 정확히 ${HISTORY_FIELDS.join(', ')} 필드를 가져야 합니다.`);
  assertNoSecrets(history, 'history');
  if (history.version !== SOLO_LEVELING_VERSION || !ID.test(history.skillId) || typeof history.registered !== 'boolean' || !GRADES.includes(history.grade)) fail('skill history 값이 올바르지 않습니다.');
  for (const key of ['successes', 'failures', 'compositions', 'interventions', 'verifiedOutcomes', 'promotions']) if (!Array.isArray(history[key])) fail(`${key}는 배열이어야 합니다.`);
  for (const p of history.promotions) if (!exact(p, ['from', 'to', 'kind', 'at', 'evidenceFingerprint']) || !GRADES.includes(p.from) || !GRADES.includes(p.to) || !['promotion', 'demotion'].includes(p.kind) || !ISO.test(p.at) || !HASH.test(p.evidenceFingerprint)) fail('promotion 기록이 올바르지 않습니다.');
  const {grade: recomputed} = grade(history.registered, history.successes, history.compositions, history.interventions, history.verifiedOutcomes);
  if (recomputed !== history.grade) fail('grade가 저장된 증거와 일치하지 않습니다.', 'LEVELING_TAMPERED');
  if (history.promotions.length && history.promotions.at(-1).to !== history.grade) fail('마지막 등급 변경 기록이 현재 grade와 다릅니다.', 'LEVELING_TAMPERED');
  if (!history.promotions.length && history.grade !== 'E') fail('E 이상의 grade에는 승급 기록이 필요합니다.', 'LEVELING_TAMPERED');
  if (history.fingerprint !== historyFingerprint(history)) fail('skill history 지문이 다릅니다.', 'LEVELING_TAMPERED');
  return true;
}

// previous: the stored history for this skill (or null). Counts are always
// recomputed from evidence; only the promotion/demotion trail is carried over
// and extended, and its timestamps are the evidence's own.
export function buildSkillHistory(previous, {registry, skillId, executions = [], interventions = [], verdicts = []}) {
  validateRegistry(registry);
  if (!ID.test(skillId)) fail('skillId가 올바르지 않습니다.');
  executions.forEach(validateExecution);
  interventions.forEach(validateIntervention);
  verdicts.forEach(validateOutcomeVerdict);
  assertNoSecrets({registry, executions, interventions}, 'evidence');
  if (previous !== null) {validateSkillHistory(previous); if (previous.skillId !== skillId) fail('다른 기능의 history입니다.');}
  const registered = registry.entries.some(e => e.id === skillId);
  const successes = successesFor(registry, executions, skillId);
  const failures = failuresFor(registry, executions, skillId);
  const compositions = compositionsFor(registry, executions, skillId, successes);
  const mine = dedupe(interventions.filter(i => i.skillId === skillId)).map(i => ({jobId: i.jobId, kind: i.kind, at: i.at})).sort(byAtThenId);
  const verifiedOutcomes = verifiedOutcomesFor(verdicts, successes);
  const {grade: current, checks} = grade(registered, successes, compositions, mine, verifiedOutcomes);
  const evidenceFingerprint = sha256({successes, compositions, interventions: mine, verifiedOutcomes});
  const promotions = previous ? [...previous.promotions] : [];
  const before = previous ? previous.grade : 'E';
  if (current !== before) {
    const up = GRADES.indexOf(current) > GRADES.indexOf(before);
    const at = up ? checks[current].at : latestAt(successes, compositions, mine, verifiedOutcomes) ?? (previous.promotions.at(-1)?.at ?? successes[0]?.at ?? null);
    promotions.push({from: before, to: current, kind: up ? 'promotion' : 'demotion', at: at ?? '1970-01-01T00:00:00.000Z', evidenceFingerprint});
  }
  const history = {version: SOLO_LEVELING_VERSION, skillId, registered, successes, failures, compositions, interventions: mine, verifiedOutcomes, grade: current, checks, promotions, fingerprint: null};
  history.fingerprint = historyFingerprint(history);
  validateSkillHistory(history);
  return history;
}
const latestAt = (...lists) => lists.flat().map(r => r.at).filter(Boolean).sort().at(-1) ?? null;

export function parseSkillHistory(text) {
  let parsed;
  try {parsed = JSON.parse(text);} catch {fail('skill history JSON을 읽을 수 없습니다.');}
  validateSkillHistory(parsed);
  return parsed;
}

export function levelingOverview(histories) {
  histories.forEach(validateSkillHistory);
  const counts = Object.fromEntries(GRADES.map(g => [g, histories.filter(h => h.grade === g).length]));
  return {version: SOLO_LEVELING_VERSION, total: histories.length, counts, skills: histories.map(h => ({skillId: h.skillId, grade: h.grade, successes: h.successes.length, failures: h.failures.length, compositions: h.compositions.length, interventions: h.interventions.length, verifiedOutcomes: h.verifiedOutcomes.length, promotions: h.promotions.length, blocked: nextBlock(h)}))};
}
const nextBlock = h => {const next = GRADES[GRADES.indexOf(h.grade) + 1]; return next ? {grade: next, reason: h.checks[next].reason} : null;};
