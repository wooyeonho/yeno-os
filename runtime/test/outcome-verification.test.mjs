import test from 'node:test';
import assert from 'node:assert/strict';
import {createOutcomeEvidence, validateOutcomeEvidence, parseOutcomeEvidence, verifyExecution, verifyOutcome, validateOutcomeVerdict, assertNoSecrets, OutcomeVerificationError, EVIDENCE_FIELDS, sha256} from '../lib/outcome-verification.mjs';

const QUEST = '11111111-1111-4111-8111-111111111111';
const JOB = '22222222-2222-4222-8222-222222222222';
const ARTIFACT = sha256('artifact-bytes');
const INPUT = sha256('capability-input');
const AT = '2026-09-15T04:00:00.000Z';
const LINKS = {questId: QUEST, jobId: JOB, artifactSha256: ARTIFACT};
const claim = (overrides = {}) => ({
  questId: QUEST, jobId: JOB, artifactSha256: ARTIFACT, metric: 'wealth.revenue', value: 120000, unit: 'KRW',
  sourceType: 'payment_processor', sourceId: 'stripe:acct_1:payout_77', sourceTimestamp: '2026-09-14T12:00:00.000Z',
  verificationType: 'external_verified', authority: 'external_attested', confidence: 0.95, ...overrides
});
const evidence = (overrides = {}, collectedAt = AT) => createOutcomeEvidence(claim(overrides), {collectedAt});
const source = (overrides = {}) => ({sourceType: 'payment_processor', sourceId: 'stripe:acct_1:payout_77', records: [{metric: 'wealth.revenue', value: 120000, unit: 'KRW', timestamp: '2026-09-14T12:00:00.000Z'}], ...overrides});
const job = {id: JOB, status: 'completed', capabilityRequest: {inputSha256: INPUT}};
const run = {action: 'run', runId: JOB, inputSha256: INPUT, outputSha256: ARTIFACT};

test('1: artifact SHA == capability run hash => executionVerified:true, and that alone never makes outcomeVerified:true', () => {
  const execution = verifyExecution({artifactSha256: ARTIFACT, run, job});
  assert.deepEqual(execution, {executionVerified: true, reasons: []});
  assert.deepEqual(verifyExecution({artifactSha256: ARTIFACT, run: {...run, outputSha256: sha256('other')}, job}).reasons, ['artifact_hash_mismatch']);
  assert.deepEqual(verifyExecution({artifactSha256: ARTIFACT, run: {...run, runId: QUEST}, job}).reasons, ['run_job_mismatch']);
  assert.deepEqual(verifyExecution({artifactSha256: ARTIFACT, run: null, job}).reasons, ['run_record_missing']);
  // Owner report on a perfectly verified execution: integrity yes, reality no.
  const selfReport = evidence({verificationType: 'self_reported', authority: 'owner', sourceType: 'owner_report', sourceId: 'owner:report:1', confidence: 0.5});
  const verdict = verifyOutcome(selfReport, {links: LINKS, source: null, execution, at: AT});
  assert.equal(verdict.executionVerified, true);
  assert.equal(verdict.outcomeVerified, false);
  assert.ok(verdict.reasons.includes('type_not_outcome_verifying:self_reported'));
  assert.equal(verdict.authorizesAction, false);
});

test('2: self_reported => outcomeVerified:false even when a matching structured record is offered; self_reported may not claim an external source', () => {
  const selfReport = evidence({verificationType: 'self_reported', authority: 'owner', sourceType: 'owner_report', sourceId: 'owner:report:1', confidence: 1});
  const verdict = verifyOutcome(selfReport, {links: LINKS, source: {sourceType: 'owner_report', sourceId: 'owner:report:1', records: [{metric: 'wealth.revenue', value: 120000, unit: 'KRW', timestamp: '2026-09-14T12:00:00.000Z'}]}, at: AT});
  assert.deepEqual([verdict.outcomeVerified, verdict.highGradeCandidate, verdict.reasons], [false, false, ['type_not_outcome_verifying:self_reported']]);
  assert.throws(() => evidence({verificationType: 'self_reported', authority: 'owner'}), /owner_report/);
  assert.throws(() => evidence({verificationType: 'self_reported', authority: 'external_attested', sourceType: 'owner_report'}), /authority/);
  // internal_observed is recorded honestly but is not an outcome either.
  const internal = evidence({verificationType: 'internal_observed', authority: 'runtime', sourceType: 'runtime_record', sourceId: 'runtime:outcomes:9'});
  assert.equal(verifyOutcome(internal, {links: LINKS, source: {sourceType: 'runtime_record', sourceId: 'runtime:outcomes:9', records: source().records}, at: AT}).outcomeVerified, false);
});

test('3: external verified evidence + defined metric/value/unit + matching links + matching source => outcomeVerified:true and high-grade candidate; external_structured verifies but is not high-grade', () => {
  const verdict = verifyOutcome(evidence(), {links: LINKS, source: source(), execution: verifyExecution({artifactSha256: ARTIFACT, run, job}), at: AT});
  assert.deepEqual([verdict.outcomeVerified, verdict.executionVerified, verdict.highGradeCandidate, verdict.reasons, verdict.ledger], [true, true, true, [], 'wealth']);
  validateOutcomeVerdict(verdict);
  const structured = verifyOutcome(evidence({verificationType: 'external_structured', authority: 'external'}), {links: LINKS, source: source(), at: AT});
  assert.deepEqual([structured.outcomeVerified, structured.highGradeCandidate, structured.executionVerified], [true, false, null]);
  // Verified outcome on an unverified execution is not accepted.
  const broken = verifyOutcome(evidence(), {links: LINKS, source: source(), execution: verifyExecution({artifactSha256: ARTIFACT, run: null, job}), at: AT});
  assert.deepEqual([broken.outcomeVerified, broken.reasons], [false, ['execution_not_verified']]);
});

test('4: source identity mismatch => false', () => {
  assert.deepEqual(verifyOutcome(evidence(), {links: LINKS, source: source({sourceId: 'stripe:acct_1:payout_78'}), at: AT}).reasons, ['source_id_mismatch']);
  assert.deepEqual(verifyOutcome(evidence(), {links: LINKS, source: source({sourceType: 'bank_statement'}), at: AT}).reasons, ['source_type_mismatch']);
});

test('5: quest/job/artifact link mismatch => false', () => {
  assert.deepEqual(verifyOutcome(evidence(), {links: {...LINKS, questId: JOB}, source: source(), at: AT}).reasons, ['link_mismatch:questId']);
  assert.deepEqual(verifyOutcome(evidence(), {links: {...LINKS, jobId: QUEST}, source: source(), at: AT}).reasons, ['link_mismatch:jobId']);
  assert.deepEqual(verifyOutcome(evidence(), {links: {...LINKS, artifactSha256: sha256('x')}, source: source(), at: AT}).reasons, ['link_mismatch:artifactSha256']);
});

test('6: stale or changed evidence => false (source gone, record gone, value changed, timestamp moved)', () => {
  assert.deepEqual(verifyOutcome(evidence(), {links: LINKS, source: null, at: AT}).reasons, ['source_unavailable']);
  assert.deepEqual(verifyOutcome(evidence(), {links: LINKS, source: source({records: []}), at: AT}).reasons, ['claim_not_in_source']);
  assert.deepEqual(verifyOutcome(evidence(), {links: LINKS, source: source({records: [{metric: 'wealth.revenue', value: 90000, unit: 'KRW', timestamp: '2026-09-14T12:00:00.000Z'}]}), at: AT}).reasons, ['source_changed']);
  assert.deepEqual(verifyOutcome(evidence(), {links: LINKS, source: source({records: [{metric: 'wealth.revenue', value: 120000, unit: 'USD', timestamp: '2026-09-14T12:00:00.000Z'}]}), at: AT}).reasons, ['source_changed']);
  assert.deepEqual(verifyOutcome(evidence(), {links: LINKS, source: source({records: [{metric: 'wealth.revenue', value: 120000, unit: 'KRW', timestamp: '2026-09-15T12:00:00.000Z'}]}), at: AT}).reasons, ['claim_not_in_source']);
});

test('7: model-generated text is never outcome evidence', () => {
  assert.throws(() => evidence({sourceType: 'model_output', sourceId: 'job:model:text'}), /model_output/, 'model_output cannot be declared external_verified');
  assert.throws(() => evidence({authority: 'model'}), /authority/);
  const observed = evidence({verificationType: 'internal_observed', authority: 'runtime', sourceType: 'model_output', sourceId: 'job:model:text'});
  const verdict = verifyOutcome(observed, {links: LINKS, source: {sourceType: 'model_output', sourceId: 'job:model:text', records: source().records}, at: AT});
  assert.equal(verdict.outcomeVerified, false);
  assert.ok(verdict.reasons.includes('model_output_is_not_evidence'));
  // A non-numeric "매출 발생" is not a value at all.
  assert.throws(() => evidence({value: '매출 발생'}), /value/);
});

test('8: fake wealth/fame/honor/adoption claims are refused: undefined metric, wrong unit, wrong source for the metric, non-external source', () => {
  assert.throws(() => evidence({metric: 'wealth.vibes'}), /metric/);
  assert.throws(() => evidence({metric: 'fame.followers', unit: 'KRW', sourceType: 'publication_platform'}), /unit/);
  assert.throws(() => evidence({metric: 'fame.followers', unit: 'count', sourceType: 'payment_processor'}), /publication_platform\|analytics_platform/);
  assert.throws(() => evidence({metric: 'honor.awards', unit: 'count', sourceType: 'analytics_platform'}), /award_registry/);
  assert.throws(() => evidence({metric: 'adoption.installs', unit: 'count', sourceType: 'runtime_record'}), /외부 구조화 source/);
  assert.throws(() => evidence({sourceType: 'owner_report', sourceId: 'owner:1'}), /외부 구조화 source/);
  // A properly sourced adoption metric verifies only against its registry record.
  const installs = evidence({metric: 'adoption.installs', value: 340, unit: 'count', sourceType: 'package_registry', sourceId: 'npm:yeno-os'});
  assert.equal(verifyOutcome(installs, {links: LINKS, source: {sourceType: 'package_registry', sourceId: 'npm:yeno-os', records: [{metric: 'adoption.installs', value: 340, unit: 'count', timestamp: '2026-09-14T12:00:00.000Z'}]}, at: AT}).outcomeVerified, true);
  assert.equal(verifyOutcome(installs, {links: LINKS, source: {sourceType: 'package_registry', sourceId: 'npm:yeno-os', records: [{metric: 'adoption.installs', value: 3400, unit: 'count', timestamp: '2026-09-14T12:00:00.000Z'}]}, at: AT}).outcomeVerified, false);
});

test('9: same evidence => same fingerprint regardless of collection time or key order', () => {
  const a = evidence(), b = evidence({}, '2026-09-16T00:00:00.000Z');
  assert.equal(a.fingerprint, b.fingerprint);
  const reordered = Object.fromEntries(Object.entries(claim()).reverse());
  assert.equal(createOutcomeEvidence(reordered, {collectedAt: AT}).fingerprint, a.fingerprint);
  assert.notEqual(evidence({value: 120001}).fingerprint, a.fingerprint);
  const v1 = verifyOutcome(a, {links: LINKS, source: source(), at: AT}), v2 = verifyOutcome(b, {links: LINKS, source: source(), at: '2026-09-17T00:00:00.000Z'});
  assert.equal(v1.fingerprint, v2.fingerprint);
});

test('10: tampered fingerprint or schema fails closed', () => {
  const a = evidence();
  assert.throws(() => validateOutcomeEvidence({...a, value: 999999}), err => err.code === 'OUTCOME_TAMPERED');
  assert.throws(() => validateOutcomeEvidence({...a, fingerprint: sha256('forged')}), err => err.code === 'OUTCOME_TAMPERED');
  assert.throws(() => validateOutcomeEvidence({...a, extra: true}), /필드/);
  const {confidence, ...missing} = a;
  assert.throws(() => validateOutcomeEvidence(missing), /필드/);
  assert.throws(() => validateOutcomeEvidence({...a, version: 2}), /version/);
  const verdict = verifyOutcome(a, {links: LINKS, source: source(), at: AT});
  assert.throws(() => validateOutcomeVerdict({...verdict, outcomeVerified: false}), OutcomeVerificationError);
  const forged = verifyOutcome(evidence({verificationType: 'external_structured', authority: 'external'}), {links: LINKS, source: source(), at: AT});
  assert.throws(() => validateOutcomeVerdict({...forged, highGradeCandidate: true}), err => err.code === 'OUTCOME_TAMPERED');
  assert.throws(() => validateOutcomeVerdict({...verdict, authorizesAction: true}), OutcomeVerificationError);
  assert.throws(() => validateOutcomeVerdict({...verdict, reasons: ['x']}), OutcomeVerificationError);
  assert.throws(() => verifyOutcome(a, {links: {...LINKS, extra: 1}, source: source(), at: AT}), /links/);
});

test('11: secret-like fields or values are rejected from evidence, links and source', () => {
  assert.throws(() => createOutcomeEvidence({...claim(), apiKey: 'x'}, {collectedAt: AT}), /필드/);
  assert.throws(() => validateOutcomeEvidence({...evidence(), sourceId: 'sk-live-abcdef'}), err => err.code === 'OUTCOME_SECRET');
  assert.throws(() => verifyOutcome(evidence(), {links: LINKS, source: {...source(), records: [{...source().records[0], access_token: 'ya29.abc'}]}, at: AT}), err => err.code === 'OUTCOME_SECRET');
  assert.throws(() => verifyOutcome(evidence(), {links: LINKS, source: {...source(), records: [{...source().records[0], note: 'Bearer abc'}]}, at: AT}), err => err.code === 'OUTCOME_SECRET');
  assert.throws(() => assertNoSecrets({authorization: 'x'}), err => err.code === 'OUTCOME_SECRET');
  const dumped = JSON.stringify(verifyOutcome(evidence(), {links: LINKS, source: source(), at: AT}));
  assert.ok(!/key|secret|token|Bearer/i.test(dumped));
  assert.deepEqual(Object.keys(evidence()).sort(), [...EVIDENCE_FIELDS].sort());
});

test('12: evidence and verdict survive a JSON round trip (restart) with the same verdict', () => {
  const a = evidence();
  const restored = parseOutcomeEvidence(JSON.stringify(a));
  assert.deepEqual(restored, a);
  const before = verifyOutcome(a, {links: LINKS, source: source(), at: AT});
  const after = verifyOutcome(restored, {links: JSON.parse(JSON.stringify(LINKS)), source: JSON.parse(JSON.stringify(source())), at: '2026-09-18T00:00:00.000Z'});
  assert.equal(before.fingerprint, after.fingerprint);
  assert.deepEqual({...before, checkedAt: null}, {...after, checkedAt: null});
  validateOutcomeVerdict(JSON.parse(JSON.stringify(before)));
  assert.throws(() => parseOutcomeEvidence(JSON.stringify({...a, value: 1})), err => err.code === 'OUTCOME_TAMPERED');
  assert.throws(() => parseOutcomeEvidence('not json'), OutcomeVerificationError);
});
