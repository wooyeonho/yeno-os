import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {
  initialCoreState, validateCoreState, evaluateHeartbeat, coreSummary, coreHomeSummary,
  ACTIVITY_STATES, CORE_SCHEMA_VERSION, BlackholeCoreError,
} from '../lib/blackhole-core.mjs';
import {
  createMemoryEvent, validateMemoryEvent, validateMemoryEvents, addMemoryEvent,
  MEMORY_EVENT_TYPES, MemoryEventError, MAX_MEMORY_EVENTS,
} from '../lib/memory-events.mjs';
import {OutcomeVerificationError} from '../lib/outcome-verification.mjs';

// BLACKHOLE Living Core, Phase A — persistent self + event-driven heartbeat +
// canonical Memory Event primitive. These are pure-function tests against the
// exact projection/validation logic store.mjs and server.mjs wire in; the
// restart-persistence and emergency-stop behaviour are covered end-to-end in
// blackhole-core-server.test.mjs against the real store/server.

const at = () => new Date().toISOString();
function baseState(overrides = {}) {
  return {emergencyStop: false, jobs: [], quests: [], projects: [], outcomes: [], sources: [], capabilities: {entries: []}, memoryEvents: [], ...overrides};
}
function project(id, overrides = {}) {
  const t = at();
  return {id, name: 'P', repositoryUrl: '', summary: '', nextAction: '', status: 'active', version: 1, createdAt: t, updatedAt: t, ...overrides};
}
function quest(id, jobId, overrides = {}) {
  const t = at();
  return {id, driveId: 'sloth', drive: 'sloth', projectId: null, status: 'queued', jobId, updatedAt: t, createdAt: t, goal: 'g', successCriterion: 's', baseline: 'b', ...overrides};
}
function job(id, overrides = {}) {
  const t = at();
  return {id, status: 'queued', updatedAt: t, createdAt: t, artifacts: [], ...overrides};
}

test('initialCoreState is idle, empty and validates against an empty state', () => {
  const state = baseState();
  const core = initialCoreState();
  assert.equal(core.schemaVersion, CORE_SCHEMA_VERSION);
  assert.equal(core.activity, 'idle');
  assert.equal(core.missionQuestId, null);
  assert.equal(core.dominantDriveId, null);
  assert.deepEqual(core.activeShadowIds, []);
  assert.equal(core.heartbeatCount, 0);
  assert.equal(core.lastHeartbeatAt, null);
  validateCoreState(core, state);
});

test('every taxonomy activity is accepted by validation even though Phase A only ever produces idle/executing/emergency', () => {
  assert.deepEqual([...ACTIVITY_STATES].sort(), ['absorbing', 'blocked', 'emergency', 'executing', 'idle', 'leveling', 'listening', 'offline', 'planning', 'remembering', 'thinking', 'verifying'].sort());
  const state = baseState();
  for (const activity of ACTIVITY_STATES) {
    const core = {...initialCoreState(), activity};
    validateCoreState(core, state);
  }
});

test('heartbeat derives executing only from a real running job, idle otherwise, emergency whenever emergencyStop is true regardless of jobs', () => {
  const idleState = baseState();
  const {core: idleCore} = evaluateHeartbeat(initialCoreState(), idleState, {at: at()});
  assert.equal(idleCore.activity, 'idle');

  const runningState = baseState({jobs: [job(randomUUID(), {status: 'running'})]});
  const {core: runningCore} = evaluateHeartbeat(initialCoreState(), runningState, {at: at()});
  assert.equal(runningCore.activity, 'executing');

  const emergencyState = baseState({emergencyStop: true, jobs: [job(randomUUID(), {status: 'running'})]});
  const {core: emergencyCore} = evaluateHeartbeat(initialCoreState(), emergencyState, {at: at()});
  assert.equal(emergencyCore.activity, 'emergency');
});

test('mission/focusProject/dominantDriveId derive only from a live (queued/running/paused) quest, never a completed/cancelled/failed one, and are null when nothing is live', () => {
  const projectId = randomUUID(), jobId = randomUUID(), questId = randomUUID();
  for (const status of ['completed', 'failed', 'cancelled']) {
    const state = baseState({
      projects: [project(projectId)],
      jobs: [job(jobId, {status: 'completed', artifacts: [{id: 'a1', name: 'a'}]})],
      quests: [quest(questId, jobId, {status, projectId, driveId: 'wrath'})],
    });
    const {core} = evaluateHeartbeat(initialCoreState(), state, {at: at()});
    assert.equal(core.missionQuestId, null, `status ${status} must not be a live mission`);
    assert.equal(core.dominantDriveId, null);
  }
  for (const status of ['queued', 'running', 'paused']) {
    const state = baseState({
      projects: [project(projectId)],
      jobs: [job(jobId, {status: status === 'queued' ? 'queued' : status})],
      quests: [quest(questId, jobId, {status, projectId, driveId: 'envy'})],
    });
    const {core} = evaluateHeartbeat(initialCoreState(), state, {at: at()});
    assert.equal(core.missionQuestId, questId);
    assert.equal(core.focusProjectId, projectId);
    assert.equal(core.dominantDriveId, 'envy', 'dominant drive is the mission quest\'s own already-assigned driveId, never scored here');
    validateCoreState(core, state);
  }
});

test('the most recently updated live quest wins as the mission, never an arbitrary or first one', () => {
  const older = quest(randomUUID(), randomUUID(), {status: 'queued', updatedAt: '2026-01-01T00:00:00.000Z', driveId: 'greed'});
  const newer = quest(randomUUID(), randomUUID(), {status: 'paused', updatedAt: '2026-06-01T00:00:00.000Z', driveId: 'pride'});
  const state = baseState({quests: [older, newer], jobs: [job(older.jobId, {status: 'queued'}), job(newer.jobId, {status: 'paused'})]});
  const {core} = evaluateHeartbeat(initialCoreState(), state, {at: at()});
  assert.equal(core.missionQuestId, newer.id);
  assert.equal(core.dominantDriveId, 'pride');
});

test('active shadows are only real running project-bot jobs, never queued/paused ones and never a decorative count', () => {
  const running = job(randomUUID(), {status: 'running', botAssignment: {profile: 'primary'}});
  const paused = job(randomUUID(), {status: 'paused', botAssignment: {profile: 'primary'}});
  const runningNonBot = job(randomUUID(), {status: 'running'});
  const state = baseState({jobs: [running, paused, runningNonBot]});
  const {core} = evaluateHeartbeat(initialCoreState(), state, {at: at()});
  assert.deepEqual(core.activeShadowIds, [running.id]);
  validateCoreState(core, state);
});

test('recent verified result is only the most recently updated completed quest job that actually carries an artifact', () => {
  const olderJobId = randomUUID(), olderQuestId = randomUUID();
  const newerJobId = randomUUID(), newerQuestId = randomUUID();
  const noArtifactJobId = randomUUID(), noArtifactQuestId = randomUUID();
  const state = baseState({
    jobs: [
      job(olderJobId, {status: 'completed', updatedAt: '2026-01-01T00:00:00.000Z', artifacts: [{id: 'old-art', name: 'a'}]}),
      job(newerJobId, {status: 'completed', updatedAt: '2026-06-01T00:00:00.000Z', artifacts: [{id: 'new-art', name: 'a'}]}),
      job(noArtifactJobId, {status: 'completed', updatedAt: '2026-09-01T00:00:00.000Z', artifacts: []}),
    ],
    quests: [
      quest(olderQuestId, olderJobId, {status: 'completed'}),
      quest(newerQuestId, newerJobId, {status: 'completed'}),
      quest(noArtifactQuestId, noArtifactJobId, {status: 'completed'}),
    ],
  });
  const {core} = evaluateHeartbeat(initialCoreState(), state, {at: at()});
  assert.deepEqual(core.recentResultRef, {type: 'quest', questId: newerQuestId, jobId: newerJobId, artifactId: 'new-art'});
  validateCoreState(core, state);
});

test('relationshipMemoryPointer is re-derived fresh every heartbeat from the most recent relationship memory event, never an independently settable field', () => {
  const state = baseState();
  const older = createMemoryEvent({type: 'relationship', text: '첫 상호작용', confidence: 0.5, projectId: null, questId: null, sourceRefs: []}, state, {at: '2026-01-01T00:00:00.000Z'});
  state.memoryEvents = addMemoryEvent(state.memoryEvents, older, state);
  const {core: core1} = evaluateHeartbeat(initialCoreState(), state, {at: at()});
  assert.equal(core1.relationshipMemoryPointer, older.id);

  const newer = createMemoryEvent({type: 'relationship', text: '더 최근 상호작용', confidence: 0.5, projectId: null, questId: null, sourceRefs: []}, state, {at: '2026-06-01T00:00:00.000Z'});
  state.memoryEvents = addMemoryEvent(state.memoryEvents, newer, state);
  const {core: core2} = evaluateHeartbeat(core1, state, {at: at()});
  assert.equal(core2.relationshipMemoryPointer, newer.id);
  validateCoreState(core2, state);
});

test('heartbeatLog is bounded and always keeps the most recent entries, never grows unbounded', () => {
  const state = baseState();
  let core = initialCoreState();
  for (let i = 0; i < 30; i++) {
    core = evaluateHeartbeat(core, state, {at: new Date(Date.now() + i * 1000).toISOString()}).core;
  }
  assert.equal(core.heartbeatCount, 30);
  assert.ok(core.heartbeatLog.length <= 20);
  assert.equal(core.heartbeatLog.length, 20);
  validateCoreState(core, state);
});

test('validateCoreState fails closed on tampering: dominant drive disagreeing with the mission, a dangling mission/project/shadow reference, and an inconsistent heartbeat counter', () => {
  const projectId = randomUUID(), jobId = randomUUID(), questId = randomUUID();
  const state = baseState({
    projects: [project(projectId)],
    jobs: [job(jobId, {status: 'queued'})],
    quests: [quest(questId, jobId, {status: 'queued', projectId, driveId: 'lust'})],
  });
  const {core} = evaluateHeartbeat(initialCoreState(), state, {at: at()});
  validateCoreState(core, state);

  assert.throws(() => validateCoreState({...core, dominantDriveId: 'wrath'}, state), BlackholeCoreError);
  assert.throws(() => validateCoreState({...core, missionQuestId: randomUUID()}, state), BlackholeCoreError);
  assert.throws(() => validateCoreState({...core, focusProjectId: randomUUID()}, state), BlackholeCoreError);
  assert.throws(() => validateCoreState({...core, activeShadowIds: [randomUUID()]}, state), BlackholeCoreError);
  assert.throws(() => validateCoreState({...core, activeShadowIds: [jobId, jobId]}, state), BlackholeCoreError, 'duplicate shadow ids must be rejected even if the id is real');
  assert.throws(() => validateCoreState({...core, heartbeatCount: 0}, state), BlackholeCoreError, 'lastHeartbeatAt set but heartbeatCount 0 is inconsistent');
  assert.throws(() => validateCoreState({...core, activity: 'not-a-real-activity'}, state), BlackholeCoreError);
  assert.throws(() => validateCoreState({...core, extraField: true}, state), BlackholeCoreError, 'unexpected field must fail closed');
});

test('coreSummary and coreHomeSummary never fabricate a field: every value traces to the stored Core record or a real referenced quest/project/memory event', () => {
  const projectId = randomUUID(), jobId = randomUUID(), questId = randomUUID();
  const state = baseState({
    projects: [project(projectId, {name: '실제 프로젝트'})],
    jobs: [job(jobId, {status: 'running'})],
    quests: [quest(questId, jobId, {status: 'running', projectId, driveId: 'gluttony', goal: '실제 목표'})],
  });
  state.blackholeCore = evaluateHeartbeat(initialCoreState(), state, {at: at()}).core;
  const summary = coreSummary(state);
  assert.equal(summary.activity, 'executing');
  assert.equal(summary.mission.goal, '실제 목표');
  assert.equal(summary.focusProject.name, '실제 프로젝트');
  assert.equal(summary.dominantDriveId, 'gluttony');
  assert.equal(typeof summary.dominantDriveName, 'string');

  const home = coreHomeSummary(state);
  assert.equal(home.activity, 'executing');
  assert.equal(home.missionGoal, '실제 목표');
  assert.equal(home.focusProjectName, '실제 프로젝트');
  assert.equal(home.dominantDriveId, 'gluttony');

  // No live mission: placeholders are null, never a fabricated drive/goal.
  const empty = baseState();
  empty.blackholeCore = initialCoreState();
  const emptyHome = coreHomeSummary(empty);
  assert.equal(emptyHome.missionGoal, null);
  assert.equal(emptyHome.dominantDriveId, null);
  assert.equal(emptyHome.dominantDriveName, null);
});

// --- Memory Event primitive ---

test('createMemoryEvent produces a self-consistent, referentially valid record for every declared type', () => {
  const projectId = randomUUID(), jobId = randomUUID(), questId = randomUUID();
  const state = baseState({
    projects: [project(projectId)],
    jobs: [job(jobId, {status: 'completed'})],
    quests: [quest(questId, jobId, {status: 'completed'})],
  });
  for (const type of MEMORY_EVENT_TYPES) {
    const claim = {type, text: `${type} 기억`, confidence: 0.7, projectId, questId, sourceRefs: [{type: 'quest', id: questId}, {type: 'job', id: jobId}, {type: 'project', id: projectId}]};
    const event = createMemoryEvent(claim, state, {at: at()});
    validateMemoryEvent(event, state);
    assert.equal(event.type, type);
  }
});

test('memory events reject secrets in text, dangling source references, out-of-range confidence, and tampering', () => {
  const state = baseState();
  const claim = {type: 'episode', text: 'ordinary text', confidence: 0.5, projectId: null, questId: null, sourceRefs: []};

  // Redaction is the exact reused assertNoSecrets from outcome-verification.mjs
  // (never reimplemented), so it throws its own error type, unwrapped - the
  // same behaviour solo-leveling.mjs's validateSkillHistory already relies on.
  assert.throws(() => createMemoryEvent({...claim, text: 'sk-abcdefghijklmnopqrstuvwx'}, state, {at: at()}), OutcomeVerificationError);
  assert.throws(() => createMemoryEvent({...claim, sourceRefs: [{type: 'job', id: randomUUID()}]}, state, {at: at()}), MemoryEventError);
  assert.throws(() => createMemoryEvent({...claim, confidence: 1.5}, state, {at: at()}), MemoryEventError);
  assert.throws(() => createMemoryEvent({...claim, confidence: -0.1}, state, {at: at()}), MemoryEventError);
  assert.throws(() => createMemoryEvent({...claim, type: 'not-a-real-type'}, state, {at: at()}), MemoryEventError);

  const event = createMemoryEvent(claim, state, {at: at()});
  assert.throws(() => validateMemoryEvent({...event, text: 'changed after fingerprinting'}, state), MemoryEventError);
  assert.throws(() => validateMemoryEvent({...event, confidence: 0.9}, state), MemoryEventError);
});

test('duplicate source references within one event are rejected even when each reference is individually real', () => {
  const jobId = randomUUID();
  const state = baseState({jobs: [job(jobId, {status: 'completed'})]});
  const claim = {type: 'episode', text: 't', confidence: 0.5, projectId: null, questId: null, sourceRefs: [{type: 'job', id: jobId}, {type: 'job', id: jobId}]};
  assert.throws(() => createMemoryEvent(claim, state, {at: at()}), MemoryEventError);
});

test('addMemoryEvent enforces the capacity bound and validateMemoryEvents rejects a duplicate id', () => {
  const state = baseState();
  const claim = {type: 'episode', text: 't', confidence: 0.5, projectId: null, questId: null, sourceRefs: []};
  const event = createMemoryEvent(claim, state, {at: at()});
  const full = Array.from({length: MAX_MEMORY_EVENTS}, () => event);
  assert.throws(() => addMemoryEvent(full, event, state), MemoryEventError);
  assert.throws(() => validateMemoryEvents([event, event], state), MemoryEventError);
});

test('a capability sourceRef must reference a real, already-imported capability registry entry', () => {
  const state = baseState({capabilities: {entries: [{id: 'evidence-gap-brief'}]}});
  const claim = {type: 'skill', text: '이 기능을 성공적으로 사용함', confidence: 0.9, projectId: null, questId: null, sourceRefs: [{type: 'capability', id: 'evidence-gap-brief'}]};
  const event = createMemoryEvent(claim, state, {at: at()});
  validateMemoryEvent(event, state);
  assert.throws(() => createMemoryEvent({...claim, sourceRefs: [{type: 'capability', id: 'never-imported'}]}, state, {at: at()}), MemoryEventError);
});
