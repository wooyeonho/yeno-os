import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { synthesizeAutonomousGoal, planAutonomousQuest, validAutonomy, ARCHETYPES, RISK_CLASSES, boundedEvidence } from '../lib/autonomous-goals.mjs';

const AT = '2026-09-15T00:00:00.000Z';
function baseState(overrides = {}) {
  return { revision: 3, jobs: [], quests: [], outcomes: [], ...overrides };
}
function failedJob(overrides = {}) {
  return { id: randomUUID(), type: 'agent', title: '실패 작업', status: 'failed', error: '합성 오류', createdAt: AT, updatedAt: AT, ...overrides };
}

test('with no real evidence gap anywhere, synthesis proposes nothing rather than inventing a goal', () => {
  assert.equal(synthesizeAutonomousGoal(baseState(), AT), null);
});

test('a single real failed job produces exactly one repair candidate, grounded in that job', () => {
  const job = failedJob({ title: '문서 정리 작업' });
  const state = baseState({ jobs: [job] });
  const candidate = synthesizeAutonomousGoal(state, AT);
  assert.ok(candidate);
  assert.equal(candidate.archetype, 'repair');
  assert.equal(candidate.key, `repair:job:${job.id}`);
  assert.equal(candidate.evidence.jobId, job.id);
  assert.match(candidate.goal, /문서 정리 작업/);
  assert.ok(candidate.dominantDrives.length >= 1);
  assert.equal(candidate.riskClass, 'low');
  assert.equal(candidate.approvalRequired, false);
  assert.equal(candidate.sourceRevision, 3);
});

test('once that job\'s repair quest exists, observing the exact same state again proposes nothing new (no duplicate)', () => {
  const job = failedJob();
  const state = baseState({ jobs: [job] });
  const first = synthesizeAutonomousGoal(state, AT);
  assert.ok(first);
  const quest = planAutonomousQuest(first, state, {});
  const withQuest = { ...state, quests: [quest] };
  assert.equal(synthesizeAutonomousGoal(withQuest, AT), null, 'the same failed job must not produce a second repair quest');
});

test('a real state change (a different failed job) can produce a different goal after the first is addressed', () => {
  const jobA = failedJob({ title: '작업 A' });
  let state = baseState({ jobs: [jobA] });
  const first = synthesizeAutonomousGoal(state, AT);
  const questA = planAutonomousQuest(first, state, {});
  state = { ...state, quests: [questA] };
  assert.equal(synthesizeAutonomousGoal(state, AT), null);

  const jobB = failedJob({ title: '작업 B', updatedAt: '2026-09-15T01:00:00.000Z' });
  state = { ...state, jobs: [jobA, jobB] };
  const second = synthesizeAutonomousGoal(state, AT);
  assert.ok(second);
  assert.notEqual(second.key, first.key, 'a genuinely new failure gets its own, different goal');
  assert.equal(second.evidence.jobId, jobB.id);
});

test('a real capability gap produces an approval-required acquire-capability candidate, never auto-safe', () => {
  const state = baseState();
  const gap = { manifest: { id: 'ledger-digest', name: '원장 정리' }, reason: '측정값이 있는 원장 기록 3건을 확인했습니다.' };
  const candidate = synthesizeAutonomousGoal(state, AT, { capabilityGaps: [gap] });
  assert.ok(candidate);
  assert.equal(candidate.archetype, 'acquire-capability');
  assert.equal(candidate.riskClass, 'medium');
  assert.equal(candidate.approvalRequired, true, 'acquiring a new capability must never be automatically safe');
  assert.equal(candidate.evidence.capabilityId, 'ledger-digest');
});

test('a completed quest with an unconfirmed model call produces a verify candidate', () => {
  const jobId = randomUUID();
  const quest = { id: randomUUID(), goal: '결과가 불확실한 목표', jobId, status: 'proposed' };
  const job = { id: jobId, type: 'agent', status: 'completed', createdAt: AT, updatedAt: AT, artifacts: [], agentJournal: { calls: [{ status: 'unknown' }] } };
  const state = baseState({ quests: [quest], jobs: [job] });
  const candidate = synthesizeAutonomousGoal(state, AT);
  assert.ok(candidate);
  assert.equal(candidate.archetype, 'verify');
  assert.equal(candidate.evidence.questId, quest.id);
});

test('a completed quest with a real recorded artifact and zero outcomes produces a measure-outcome candidate', () => {
  const jobId = randomUUID(), artifactId = randomUUID();
  const quest = { id: randomUUID(), goal: '측정되지 않은 성과', jobId, status: 'proposed' };
  const job = { id: jobId, type: 'agent', status: 'completed', createdAt: AT, updatedAt: AT, artifacts: [{ id: artifactId, name: 'result.md' }], agentJournal: { calls: [{ status: 'settled' }] } };
  const artifacts = { [artifactId]: { id: artifactId, jobId, name: 'result.md', sha256: 'a'.repeat(64), bytes: 10 } };
  const state = baseState({ quests: [quest], jobs: [job], artifacts });
  const candidate = synthesizeAutonomousGoal(state, AT);
  assert.ok(candidate);
  assert.equal(candidate.archetype, 'measure-outcome');
  assert.equal(candidate.evidence.questId, quest.id);
});

test('when several real gaps exist at once, the ranking picks exactly one - never two quests from one synthesis call', () => {
  const job = failedJob();
  const gap = { manifest: { id: 'ledger-digest', name: '원장 정리' }, reason: '측정값 확인' };
  const state = baseState({ jobs: [job] });
  const candidate = synthesizeAutonomousGoal(state, AT, { capabilityGaps: [gap] });
  assert.ok(candidate);
  assert.ok(['repair', 'acquire-capability'].includes(candidate.archetype));
});

test('planAutonomousQuest produces a quest that passes the same validation every owner-created quest does', () => {
  const job = failedJob();
  const state = baseState({ jobs: [job] });
  const candidate = synthesizeAutonomousGoal(state, AT);
  const quest = planAutonomousQuest(candidate, state, {});
  assert.equal(quest.status, 'proposed');
  assert.equal(quest.jobId, null);
  assert.ok(quest.autonomy);
  assert.equal(quest.driveId, candidate.dominantDrives[0]);
  assert.ok(validAutonomy(quest.autonomy));
});

test('validAutonomy rejects malformed or tampered autonomy records', () => {
  const valid = { version: 1, archetype: 'repair', key: 'repair:job:x', evidence: { jobId: 'x' }, dominantDrives: ['wrath'], sourceRevision: 1, riskClass: 'low', approvalRequired: false, generatedAt: AT };
  assert.equal(validAutonomy(valid), true);
  assert.equal(validAutonomy({ ...valid, archetype: 'not-a-real-archetype' }), false);
  assert.equal(validAutonomy({ ...valid, riskClass: 'catastrophic' }), false);
  assert.equal(validAutonomy({ ...valid, approvalRequired: 'yes' }), false);
  assert.equal(validAutonomy({ ...valid, dominantDrives: [] }), false);
  assert.equal(validAutonomy({ ...valid, extraField: true }), false);
  assert.equal(validAutonomy({ ...valid, evidence: { nested: { too: 'deep' } } }), false);
});

test('boundedEvidence stays a flat, small, JSON-safe record - the same bar code-sandbox output is held to', () => {
  assert.equal(boundedEvidence({ jobId: 'a', count: 1, ok: true, missing: null }), true);
  assert.equal(boundedEvidence({ nested: { a: 1 } }), false);
  assert.equal(boundedEvidence({}), false);
  assert.equal(boundedEvidence([1, 2]), false);
  assert.equal(boundedEvidence({ tooLong: 'x'.repeat(401) }), false);
});

test('ARCHETYPES and RISK_CLASSES stay a small, fixed vocabulary', () => {
  assert.deepEqual([...ARCHETYPES], ['repair', 'verify', 'acquire-capability', 'measure-outcome', 'refresh-evidence', 'reduce-owner-intervention']);
  assert.deepEqual([...RISK_CLASSES], ['low', 'medium', 'high']);
});
