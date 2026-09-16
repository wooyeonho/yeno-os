import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSkillHistory, validateSkillHistory, parseSkillHistory, levelingOverview, SoloLevelingError, HISTORY_FIELDS} from '../lib/solo-leveling.mjs';
import {createOutcomeEvidence, verifyOutcome, verifyExecution, sha256} from '../lib/outcome-verification.mjs';

const uuid = n => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const QUEST = uuid(900);
const at = i => `2026-09-${String(10 + i).padStart(2, '0')}T00:00:00.000Z`;
const hash = s => sha256(s);
const run = (id, i, input, output) => ({at: at(i), action: 'run', id, hash: hash('v'), runId: uuid(i), inputSha256: hash(input), outputSha256: hash(output)});
const exec = (id, i, overrides = {}) => ({jobId: uuid(i), skillId: id, status: 'completed', executionVerified: true, authorizedBy: 'owner', at: at(i), ...overrides});
const registry = (...history) => ({entries: [{id: 'triage'}, {id: 'digest'}], history});
const CHECKED = '2026-09-30T00:00:00.000Z';

// A full evidence set that legitimately reaches S: digest consumes triage's
// output (composition), three autopilot runs without intervention (autonomy),
// and one PHASE 5 external_verified verdict linked to a digest run.
function fullEvidence() {
  const reg = registry(
    run('triage', 1, 'jobs-a', 'triage-out-a'),
    run('digest', 2, 'triage-out-a', 'digest-out-a'),
    run('digest', 3, 'ledger-b', 'digest-out-b'),
    run('digest', 4, 'ledger-c', 'digest-out-c'),
    run('digest', 5, 'ledger-d', 'digest-out-d')
  );
  const executions = [exec('triage', 1), exec('digest', 2), exec('digest', 3, {authorizedBy: 'autopilot'}), exec('digest', 4, {authorizedBy: 'autopilot'}), exec('digest', 5, {authorizedBy: 'autopilot'})];
  const evidence = createOutcomeEvidence({questId: QUEST, jobId: uuid(5), artifactSha256: hash('digest-out-d'), metric: 'wealth.revenue', value: 50000, unit: 'KRW', sourceType: 'payment_processor', sourceId: 'stripe:acct:po_1', sourceTimestamp: at(6), verificationType: 'external_verified', authority: 'external_attested', confidence: 0.9}, {collectedAt: at(7)});
  const source = {sourceType: 'payment_processor', sourceId: 'stripe:acct:po_1', records: [{metric: 'wealth.revenue', value: 50000, unit: 'KRW', timestamp: at(6)}]};
  const execution = verifyExecution({artifactSha256: hash('digest-out-d'), run: reg.history[4], job: {id: uuid(5), status: 'completed', capabilityRequest: {inputSha256: hash('ledger-d')}}});
  const verdict = verifyOutcome(evidence, {links: {questId: QUEST, jobId: uuid(5), artifactSha256: hash('digest-out-d')}, source, execution, at: CHECKED});
  return {reg, executions, verdict, source, evidence};
}

test('E→D→C: registration alone is E; D needs a registry run AND a verified execution of that job; C needs distinct inputs', () => {
  const e = buildSkillHistory(null, {registry: registry(), skillId: 'triage'});
  assert.deepEqual([e.grade, e.successes, e.promotions], ['E', [], []]);
  const runOnly = buildSkillHistory(null, {registry: registry(run('triage', 1, 'a', 'x')), skillId: 'triage'});
  assert.equal(runOnly.grade, 'E', 'a run record without an execution record is not a success');
  const claimOnly = buildSkillHistory(null, {registry: registry(), skillId: 'triage', executions: [exec('triage', 1)]});
  assert.deepEqual([claimOnly.grade, claimOnly.failures.length], ['E', 1], 'an execution claim without a registry run is recorded as a failure, not a success');
  const unverified = buildSkillHistory(null, {registry: registry(run('triage', 1, 'a', 'x')), skillId: 'triage', executions: [exec('triage', 1, {executionVerified: false})]});
  assert.deepEqual([unverified.grade, unverified.failures.length], ['E', 1]);
  const d = buildSkillHistory(null, {registry: registry(run('triage', 1, 'a', 'x')), skillId: 'triage', executions: [exec('triage', 1)]});
  assert.deepEqual([d.grade, d.promotions.map(p => [p.from, p.to, p.kind, p.at])], ['D', [['E', 'D', 'promotion', at(1)]]]);
  const replay = buildSkillHistory(d, {registry: registry(run('triage', 1, 'a', 'x'), run('triage', 2, 'a', 'x')), skillId: 'triage', executions: [exec('triage', 1), exec('triage', 2)]});
  assert.equal(replay.grade, 'D', 'same input replayed is not reuse');
  const c = buildSkillHistory(d, {registry: registry(run('triage', 1, 'a', 'x'), run('triage', 2, 'b', 'y')), skillId: 'triage', executions: [exec('triage', 1), exec('triage', 2)]});
  assert.deepEqual([c.grade, c.promotions.length, c.promotions.at(-1).at], ['C', 2, at(2)]);
});

test('B/A/S open only on real evidence: composition = input hash == another skill\'s verified output; autonomy = 3 uninterrupted autopilot successes; S = external_verified verdict on this skill\'s job', () => {
  const {reg, executions, verdict} = fullEvidence();
  const s = buildSkillHistory(null, {registry: reg, skillId: 'digest', executions, verdicts: [verdict]});
  assert.equal(s.grade, 'S');
  assert.deepEqual(s.compositions.map(c => [c.upstreamSkillId, c.upstreamJobId]), [['triage', uuid(1)]]);
  assert.deepEqual(s.verifiedOutcomes.map(v => [v.jobId, v.metric, v.highGradeCandidate]), [[uuid(5), 'wealth.revenue', true]]);
  assert.deepEqual(s.promotions.map(p => p.to), ['S'], 'a fresh history records one transition to the evidenced grade');
  assert.equal(s.promotions[0].at, CHECKED, 'S timestamp is the verdict check time, not wall clock');
  // Without the composition run, B is blocked even with everything else.
  const noComp = buildSkillHistory(null, {registry: registry(...reg.history.filter(h => h.runId !== uuid(2))), skillId: 'digest', executions: executions.filter(e => e.jobId !== uuid(2)), verdicts: [verdict]});
  assert.deepEqual([noComp.grade, noComp.compositions], ['C', []]);
  // Composition only counts when the upstream run is itself verified.
  const upstreamUnverified = buildSkillHistory(null, {registry: reg, skillId: 'digest', executions: executions.map(e => e.jobId === uuid(1) ? {...e, executionVerified: false} : e), verdicts: [verdict]});
  assert.equal(upstreamUnverified.grade, 'C');
  // One owner intervention on an autopilot job drops autonomy below 3.
  const intervened = buildSkillHistory(null, {registry: reg, skillId: 'digest', executions, verdicts: [verdict], interventions: [{jobId: uuid(4), skillId: 'digest', kind: 'pause', by: 'owner', at: at(4)}]});
  assert.deepEqual([intervened.grade, intervened.interventions.length], ['B', 1]);
  assert.match(intervened.checks.A.reason, /2건, 개입 1건/);
  // Owner-authorized successes are not autonomy.
  const ownerRuns = buildSkillHistory(null, {registry: reg, skillId: 'digest', executions: executions.map(e => ({...e, authorizedBy: 'owner'})), verdicts: [verdict]});
  assert.equal(ownerRuns.grade, 'B');
  // No verdict → A. external_structured verdict → A (not high grade). Verdict on another skill's job → A.
  assert.equal(buildSkillHistory(null, {registry: reg, skillId: 'digest', executions}).grade, 'A');
  const {verdict: structured} = (() => {const f = fullEvidence(); const ev = createOutcomeEvidence({...Object.fromEntries(Object.entries(f.evidence).filter(([k]) => !['version', 'collectedAt', 'fingerprint'].includes(k))), verificationType: 'external_structured', authority: 'external'}, {collectedAt: at(7)}); return {verdict: verifyOutcome(ev, {links: {questId: QUEST, jobId: uuid(5), artifactSha256: hash('digest-out-d')}, source: f.source, at: CHECKED})};})();
  assert.equal(structured.outcomeVerified, true);
  assert.deepEqual([buildSkillHistory(null, {registry: reg, skillId: 'digest', executions, verdicts: [structured]}).grade], ['A']);
  assert.equal(buildSkillHistory(null, {registry: reg, skillId: 'triage', executions, verdicts: [verdict]}).grade, 'D', 'triage does not inherit digest\'s outcome');
});

test('fake evidence cannot promote: forged verdicts, unverified outcomes, claimed counts and hand-written histories all fail closed', () => {
  const {reg, executions, verdict} = fullEvidence();
  assert.throws(() => buildSkillHistory(null, {registry: reg, skillId: 'digest', executions, verdicts: [{...verdict, highGradeCandidate: true, verificationType: 'external_structured'}]}), err => err.code === 'OUTCOME_TAMPERED');
  assert.throws(() => buildSkillHistory(null, {registry: reg, skillId: 'digest', executions, verdicts: [{...verdict, jobId: uuid(3)}]}), err => err.code === 'OUTCOME_TAMPERED');
  const unverifiedVerdict = {...verdict, outcomeVerified: false, highGradeCandidate: false, reasons: ['source_unavailable']};
  unverifiedVerdict.fingerprint = sha256(Object.fromEntries(Object.entries(unverifiedVerdict).filter(([k]) => !['fingerprint', 'checkedAt'].includes(k))));
  assert.equal(buildSkillHistory(null, {registry: reg, skillId: 'digest', executions, verdicts: [unverifiedVerdict]}).grade, 'A');
  // Registry run without hashes is not a run.
  assert.throws(() => buildSkillHistory(null, {registry: registry({...run('digest', 1, 'a', 'b'), outputSha256: null}), skillId: 'digest'}), /run 기록/);
  // Execution record from a non-owner/autopilot authority or a model is refused.
  assert.throws(() => buildSkillHistory(null, {registry: reg, skillId: 'digest', executions: [exec('digest', 2, {authorizedBy: 'model'})]}), SoloLevelingError);
  assert.throws(() => buildSkillHistory(null, {registry: reg, skillId: 'digest', executions: [{...exec('digest', 2), successCount: 99}]}), /필드/);
  // A hand-written S history is rejected at load.
  const honest = buildSkillHistory(null, {registry: registry(run('digest', 1, 'a', 'x')), skillId: 'digest', executions: [exec('digest', 1)]});
  assert.throws(() => validateSkillHistory({...honest, grade: 'S'}), err => err.code === 'LEVELING_TAMPERED');
  assert.throws(() => validateSkillHistory({...honest, successes: [...honest.successes, {...honest.successes[0], jobId: uuid(9), inputSha256: hash('z')}]}), err => err.code === 'LEVELING_TAMPERED');
  assert.throws(() => validateSkillHistory({...honest, promotions: []}), err => err.code === 'LEVELING_TAMPERED');
  assert.throws(() => validateSkillHistory({...honest, extra: 1}), /필드/);
  assert.throws(() => buildSkillHistory({...honest, fingerprint: sha256('x')}, {registry: reg, skillId: 'digest'}), err => err.code === 'LEVELING_TAMPERED');
  assert.throws(() => buildSkillHistory(honest, {registry: reg, skillId: 'triage'}), /다른 기능/);
});

test('evidence that disappears demotes (never silently keeps the grade), and the trail records it with the evidence timestamp', () => {
  const {reg, executions, verdict} = fullEvidence();
  const s = buildSkillHistory(null, {registry: reg, skillId: 'digest', executions, verdicts: [verdict]});
  const withoutVerdict = buildSkillHistory(s, {registry: reg, skillId: 'digest', executions});
  assert.deepEqual([withoutVerdict.grade, withoutVerdict.promotions.map(p => [p.from, p.to, p.kind])], ['A', [['E', 'S', 'promotion'], ['S', 'A', 'demotion']]]);
  assert.equal(withoutVerdict.promotions.at(-1).at, at(5));
  const again = buildSkillHistory(withoutVerdict, {registry: reg, skillId: 'digest', executions, verdicts: [verdict]});
  assert.deepEqual(again.promotions.map(p => p.to), ['S', 'A', 'S']);
  const unchanged = buildSkillHistory(again, {registry: reg, skillId: 'digest', executions, verdicts: [verdict]});
  assert.equal(unchanged.fingerprint, again.fingerprint, 'no new evidence, no new trail entry');
});

test('same evidence => identical history and fingerprint across restart (JSON round trip), input order and re-polling; secrets are refused', () => {
  const {reg, executions, verdict} = fullEvidence();
  const a = buildSkillHistory(null, {registry: reg, skillId: 'digest', executions, verdicts: [verdict]});
  const b = buildSkillHistory(null, {registry: {entries: [...reg.entries].reverse(), history: [...reg.history].reverse()}, skillId: 'digest', executions: [...executions].reverse(), verdicts: [verdict, verdict]});
  assert.equal(a.fingerprint, b.fingerprint);
  const restored = parseSkillHistory(JSON.stringify(a));
  assert.deepEqual(restored, a);
  const next = buildSkillHistory(restored, {registry: JSON.parse(JSON.stringify(reg)), skillId: 'digest', executions, verdicts: [JSON.parse(JSON.stringify(verdict))]});
  assert.equal(next.fingerprint, a.fingerprint);
  assert.deepEqual(Object.keys(a).sort(), [...HISTORY_FIELDS].sort());
  assert.throws(() => buildSkillHistory(null, {registry: reg, skillId: 'digest', executions, interventions: [{jobId: uuid(3), skillId: 'digest', kind: 'pause', by: 'owner', at: at(3), token: 'x'}]}), /필드/);
  assert.throws(() => buildSkillHistory(null, {registry: {...reg, apiKey: 'sk-1'}, skillId: 'digest'}), err => err.code === 'OUTCOME_SECRET');
  assert.throws(() => parseSkillHistory(JSON.stringify({...a, grade: 'E'})), err => err.code === 'LEVELING_TAMPERED');
  const overview = levelingOverview([a, buildSkillHistory(null, {registry: reg, skillId: 'triage', executions})]);
  assert.deepEqual([overview.counts.S, overview.counts.D, overview.skills[1].blocked.grade], [1, 1, 'C']);
});
