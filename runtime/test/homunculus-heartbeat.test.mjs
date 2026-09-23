import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {
  initialCoreState, validateCoreState, evaluateHeartbeat, deriveHomunculusFields, deriveAutonomyMode,
  coreSummary, AUTONOMY_MODES, BlackholeCoreError,
} from '../lib/blackhole-core.mjs';

// BLACKHOLE continuous execution directive, Stage 2 — Homunculus Heartbeat.
// Every field here is a pure derivation from engines this codebase already
// has (decide.mjs's own quest ranking, motivation.mjs's own per-drive
// pressure, quests.mjs's own synthesis/outcome records) - these tests prove
// the derivation reuses those engines byte-for-byte rather than reimplementing
// them, that autonomyMode is never an independently settable switch, and
// that validateCoreState fails closed on fabrication while still accepting
// an honestly stale (not-yet-heartbeat-refreshed) snapshot.

const at = () => new Date().toISOString();
function baseState(overrides = {}) {
  return {emergencyStop: false, autopilot: {enabled: false}, jobs: [], quests: [], projects: [], outcomes: [], sources: [], capabilities: {entries: []}, memoryEvents: [], ...overrides};
}
function proposedQuest(overrides = {}) {
  const t = at();
  return {id: randomUUID(), driveId: 'sloth', drive: 'sloth', projectId: null, status: 'proposed', jobId: null, updatedAt: t, createdAt: t, goal: 'goal', successCriterion: 'success', baseline: '기준값 미측정', maxCalls: 2, ...overrides};
}
function outcome(overrides = {}) {
  const t = at();
  return {id: randomUUID(), version: 1, questId: randomUUID(), jobId: randomUUID(), ledger: 'honor', summary: '요약', value: null, unit: null, verification: 'self_reported', source: 'owner_report', artifactId: randomUUID(), artifactSha256: 'a'.repeat(64), createdAt: t, ...overrides};
}
const SYNTHESIS = (overrides = {}) => ({
  version: 1, archetype: 'repair', autonomousGoalId: randomUUID(), createdAt: at(), evidence: {},
  motivation: {}, reason: '이유', riskClass: 'local-reversible', sourceEvidenceFingerprint: 'f'.repeat(64), sourceState: {}, approvalRequired: false, ...overrides,
});

test('deriveAutonomyMode is never an independently settable switch - it is always exactly emergencyStop/autopilot.enabled', () => {
  assert.equal(deriveAutonomyMode(baseState()), 'paused');
  assert.equal(deriveAutonomyMode(baseState({autopilot: {enabled: true}})), 'active');
  assert.equal(deriveAutonomyMode(baseState({emergencyStop: true})), 'emergency_stopped');
  // emergency stop always wins, even if autopilot also claims enabled.
  assert.equal(deriveAutonomyMode(baseState({emergencyStop: true, autopilot: {enabled: true}})), 'emergency_stopped');
  assert.deepEqual([...AUTONOMY_MODES], ['paused', 'active', 'emergency_stopped']);
});

test('initialCoreState defaults to paused with every Homunculus field honestly empty, and validates', () => {
  const state = baseState();
  const core = initialCoreState();
  assert.equal(core.autonomyMode, 'paused');
  assert.equal(core.currentQuestId, null);
  assert.equal(core.currentGoalId, null);
  assert.equal(core.measuredDrivePressure, null);
  assert.deepEqual(core.pendingApprovalIds, []);
  assert.equal(core.lastReplanAt, null);
  assert.equal(core.lastGrowthEvidenceRef, null);
  validateCoreState(core, state);
});

test('evaluateHeartbeat picks currentQuestId from decide.mjs\'s own ranking, never invents a candidate, and stays null with nothing proposed', () => {
  const state = baseState();
  const {core: empty} = evaluateHeartbeat(initialCoreState(), state, {at: at()});
  assert.equal(empty.currentQuestId, null);
  assert.equal(empty.currentGoalId, null);
  assert.equal(empty.measuredDrivePressure, null);

  const q1 = proposedQuest({goal: '첫 번째 목표'});
  state.quests.push(q1);
  const {core} = evaluateHeartbeat(initialCoreState(), state, {at: at()});
  assert.equal(core.currentQuestId, q1.id);
  // An owner-authored quest (no synthesis) is never a Homunculus "goal".
  assert.equal(core.currentGoalId, null);
  assert.equal(typeof core.measuredDrivePressure, 'number');
  validateCoreState(core, state);
});

test('currentGoalId is only ever set for a quest Homunculus itself synthesized, and always equals currentQuestId', () => {
  const state = baseState();
  const synthesized = proposedQuest({goal: '자율 합성 목표', synthesis: SYNTHESIS()});
  state.quests.push(synthesized);
  const {core} = evaluateHeartbeat(initialCoreState(), state, {at: at()});
  assert.equal(core.currentQuestId, synthesized.id);
  assert.equal(core.currentGoalId, synthesized.id);
  validateCoreState(core, state);
});

test('at most one current quest is ever selected even with several proposed quests, matching decide.mjs\'s own single top pick', () => {
  const state = baseState();
  state.quests.push(proposedQuest({goal: 'A'}), proposedQuest({goal: 'B'}), proposedQuest({goal: 'C', synthesis: SYNTHESIS()}));
  const {core} = evaluateHeartbeat(initialCoreState(), state, {at: at()});
  assert.equal(typeof core.currentQuestId, 'string');
  assert.equal(state.quests.some(q => q.id === core.currentQuestId), true);
  // Exactly one selection - never a set of "current quests".
  assert.equal(typeof core.currentQuestId, 'string');
});

test('pendingApprovalIds only lists real proposed quests with real synthesis.approvalRequired - never auto-approves or invents entries', () => {
  const state = baseState();
  const awaiting = proposedQuest({goal: '승인 대기', synthesis: SYNTHESIS({approvalRequired: true})});
  const notAwaiting = proposedQuest({goal: '승인 불필요', synthesis: SYNTHESIS({approvalRequired: false})});
  const ownerQuest = proposedQuest({goal: '소유자 목표'});
  state.quests.push(awaiting, notAwaiting, ownerQuest);
  const {core} = evaluateHeartbeat(initialCoreState(), state, {at: at()});
  assert.deepEqual(core.pendingApprovalIds, [awaiting.id]);
  validateCoreState(core, state);
});

test('lastReplanAt tracks the most recent real goal-synthesis event and lastGrowthEvidenceRef tracks the most recent real self-reported outcome', () => {
  const state = baseState();
  assert.equal(deriveHomunculusFields(state, at()).lastReplanAt, null);
  assert.equal(deriveHomunculusFields(state, at()).lastGrowthEvidenceRef, null);

  const older = SYNTHESIS({createdAt: '2026-01-01T00:00:00.000Z'});
  const newer = SYNTHESIS({createdAt: '2026-01-02T00:00:00.000Z'});
  state.quests.push(proposedQuest({synthesis: older}), proposedQuest({synthesis: newer}));
  assert.equal(deriveHomunculusFields(state, at()).lastReplanAt, newer.createdAt);

  const olderOutcome = outcome({createdAt: '2026-01-01T00:00:00.000Z'});
  const newerOutcome = outcome({createdAt: '2026-01-02T00:00:00.000Z'});
  state.outcomes.push(olderOutcome, newerOutcome);
  assert.deepEqual(deriveHomunculusFields(state, at()).lastGrowthEvidenceRef, {type: 'outcome', outcomeId: newerOutcome.id});

  const {core} = evaluateHeartbeat(initialCoreState(), state, {at: at()});
  assert.equal(core.lastReplanAt, newer.createdAt);
  assert.deepEqual(core.lastGrowthEvidenceRef, {type: 'outcome', outcomeId: newerOutcome.id});
  validateCoreState(core, state);
});

test('coreSummary exposes the real current quest/goal/pressure/pending-approval/growth-evidence, never fabricated', () => {
  const state = baseState();
  const synthesized = proposedQuest({goal: '실제 목표', synthesis: SYNTHESIS({approvalRequired: true})});
  const paidOutcome = outcome({summary: '실제 성과'});
  state.quests.push(synthesized);
  state.outcomes.push(paidOutcome);
  const {core} = evaluateHeartbeat(initialCoreState(), state, {at: at()});
  state.blackholeCore = core;
  const summary = coreSummary(state);
  assert.equal(summary.autonomyMode, 'paused');
  assert.equal(summary.currentQuest.id, synthesized.id);
  assert.equal(summary.currentGoalId, synthesized.id);
  assert.deepEqual(summary.pendingApprovalIds, [synthesized.id]);
  assert.equal(summary.lastGrowthEvidence.id, paidOutcome.id);
  assert.equal(summary.lastGrowthEvidence.verification, 'self_reported');
});

test('validateCoreState fails closed on a fabricated currentGoalId, a dangling pendingApprovalIds entry, and an out-of-range measuredDrivePressure', () => {
  const state = baseState();
  const q = proposedQuest();
  state.quests.push(q);
  const {core} = evaluateHeartbeat(initialCoreState(), state, {at: at()});

  assert.throws(() => validateCoreState({...core, currentGoalId: q.id}, state), BlackholeCoreError, 'owner quest has no synthesis - cannot become a goal');
  assert.throws(() => validateCoreState({...core, pendingApprovalIds: [randomUUID()]}, state), BlackholeCoreError, 'dangling approval id');
  assert.throws(() => validateCoreState({...core, currentQuestId: null, measuredDrivePressure: 10}, state), BlackholeCoreError, 'pressure without a current quest');
  assert.throws(() => validateCoreState({...core, measuredDrivePressure: 999}, state), BlackholeCoreError, 'out-of-range pressure');
  assert.throws(() => validateCoreState({...core, autonomyMode: 'bogus'}, state), BlackholeCoreError, 'unknown autonomyMode');
  assert.throws(() => validateCoreState({...core, lastReplanAt: at()}, state), BlackholeCoreError, 'replan timestamp matching no real synthesis event');
  assert.throws(() => validateCoreState({...core, lastGrowthEvidenceRef: {type: 'outcome', outcomeId: randomUUID()}}, state), BlackholeCoreError, 'dangling growth evidence ref');
});

test('validateCoreState accepts an honestly stale snapshot: state mutated directly without an intervening heartbeat is not tampering', () => {
  // Regression guard for the real bug this exact case caught: a test/fixture
  // (or a real store between two heartbeats) can push a quest/outcome
  // directly without calling evaluateHeartbeat again. Core fields must stay
  // referentially valid, but are never required to be maximally fresh.
  const state = baseState();
  const core = initialCoreState();
  validateCoreState(core, state); // still valid with nothing in state yet
  state.quests.push(proposedQuest({synthesis: SYNTHESIS()}));
  state.outcomes.push(outcome());
  // core.currentQuestId/currentGoalId/lastReplanAt/lastGrowthEvidenceRef are
  // still all null here - that must not be treated as a validation failure.
  validateCoreState(core, state);
});
