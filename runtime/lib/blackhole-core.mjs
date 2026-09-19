import {randomUUID} from 'node:crypto';
import {SEVEN_DRIVES} from './quests.mjs';

// BLACKHOLE Living Core, Phase A — persistent self + event-driven heartbeat.
//
// This is deliberately NOT a parallel state system: activity/mission/focus
// project/dominant drive/active shadows/recent result are all *derived* on
// every heartbeat from the existing durable jobs/quests/projects/botAssignment
// records this codebase already validates and persists (quests.mjs already
// assigns every quest a real driveId from SEVEN_DRIVES; project-bots.mjs
// already tracks running bot-assigned jobs as the Shadow precursor). The only
// genuinely new durable fields are the ones nothing else already represents:
// the activity enum itself, the heartbeat trace log, and a pointer into the
// new memory-events ledger (see memory-events.mjs). No Seven Drives scoring
// algorithm, no Shadow provider execution, no XP - those are later phases.
export const CORE_SCHEMA_VERSION = 1;

// The full runtime-activity taxonomy from issue #25. Phase A only ever
// *produces* idle/executing/emergency (the only ones with a real, cheap,
// local signal today); the rest are accepted by validation so later phases
// (listening = Live Voice active, thinking/planning/verifying = Jarvis,
// absorbing = Kirby, remembering/leveling = memory/XP, blocked = a real
// blocker, offline = no live provider) can start writing them without a
// schema migration.
export const ACTIVITY_STATES = Object.freeze([
  'idle', 'listening', 'thinking', 'absorbing', 'planning', 'executing',
  'verifying', 'remembering', 'leveling', 'blocked', 'emergency', 'offline',
]);

const CORE_FIELDS = Object.freeze([
  'schemaVersion', 'identity', 'activity', 'missionQuestId', 'focusProjectId', 'dominantDriveId',
  'activeShadowIds', 'recentArtifactRef', 'verifiedResultRef', 'relationshipMemoryPointer',
  'lastHeartbeatAt', 'heartbeatCount', 'heartbeatLog', 'updatedAt',
]);
const IDENTITY_FIELDS = Object.freeze(['id', 'name', 'createdAt']);
// "Why it woke" (an external fact about the caller) is always recorded
// separately from "what changed" (reason/changedFields, derived from the
// projection itself) - see evaluateHeartbeat(). state_changed is the honest
// default for the many call sites that have no more specific provenance to
// give; it is never upgraded to imply autonomous initiative it didn't have.
export const HEARTBEAT_TRIGGERS = Object.freeze([
  'runtime_started', 'owner_command', 'job_completed', 'job_failed',
  'memory_recorded', 'source_received', 'backup_restored', 'state_changed',
]);
const HEARTBEAT_ENTRY_FIELDS = Object.freeze(['id', 'at', 'trigger', 'reason', 'previousActivity', 'nextActivity', 'changedFields']);
const RESULT_REF_FIELDS = Object.freeze(['type', 'questId', 'jobId', 'artifactId']);
const MAX_ACTIVE_SHADOWS = 50;
const MAX_HEARTBEAT_LOG = 20;
const DRIVE_IDS = Object.freeze(SEVEN_DRIVES.map(d => d.id));
const LIVE_QUEST_STATUSES = Object.freeze(['queued', 'running', 'paused']);

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

export class BlackholeCoreError extends Error {
  constructor(message) { super(message); this.name = 'BlackholeCoreError'; }
}

// The smallest durable identity for the Persistent Self: generated exactly
// once (here, or by the store.mjs migration for a store whose blackholeCore
// predates this field) and then carried forward unchanged by every save() -
// never regenerated on restart. No existing installation/runtime identity
// was reusable: BOOT_ID and runtimeBoots (server.mjs/https-evidence.mjs) are
// deliberately a fresh id *per process boot*, not a stable instance identity,
// and device/pairing credentials identify a connecting client, not the Core
// itself. This is a plain identity record, not a second device/account
// system - it grants no authority and is never used for authentication.
export function createCoreIdentity(at) {
  return {id: randomUUID(), name: 'BLACKHOLE', createdAt: at};
}

export function initialCoreState(at = null) {
  return {
    schemaVersion: CORE_SCHEMA_VERSION,
    identity: createCoreIdentity(at ?? new Date().toISOString()),
    activity: 'idle',
    missionQuestId: null,
    focusProjectId: null,
    dominantDriveId: null,
    activeShadowIds: [],
    recentArtifactRef: null,
    // No durable outcome-verification verdict store exists anywhere in this
    // codebase yet (outcome-verification.mjs's verifyOutcome() output is
    // never persisted) - so this stays null until such real, checkable
    // evidence exists. It must never be filled from a completed job's
    // artifact alone; that is recentArtifactRef, and is not verification.
    verifiedResultRef: null,
    relationshipMemoryPointer: null,
    lastHeartbeatAt: null,
    heartbeatCount: 0,
    heartbeatLog: [],
    updatedAt: null,
  };
}

// This is an artifact reference, deliberately not called "verified": it only
// proves a quest job completed and attached a file, exactly quests.mjs's own
// "artifact_recorded" status - not outcome-verification.mjs's much stronger
// outcomeVerified verdict (which nothing in this codebase persists yet).
function validateArtifactRef(ref, state) {
  if (ref === null) return;
  if (!exactKeys(ref, RESULT_REF_FIELDS) || ref.type !== 'quest') throw new BlackholeCoreError('Invalid Core recentArtifactRef shape');
  if (!uuid(ref.questId) || !uuid(ref.jobId) || typeof ref.artifactId !== 'string' || !ref.artifactId) throw new BlackholeCoreError('Invalid Core recentArtifactRef identifiers');
  const quest = (state.quests ?? []).find(q => q.id === ref.questId);
  const job = (state.jobs ?? []).find(j => j.id === ref.jobId);
  if (!quest || quest.jobId !== ref.jobId || !job || job.status !== 'completed') throw new BlackholeCoreError('Core recentArtifactRef does not match a real completed quest job');
  if (!(job.artifacts ?? []).some(a => a.id === ref.artifactId)) throw new BlackholeCoreError('Core recentArtifactRef artifact is not attached to its job');
}

function validateIdentity(identity, at) {
  if (!exactKeys(identity, IDENTITY_FIELDS) || !uuid(identity.id)) throw new BlackholeCoreError('Invalid Core identity shape');
  if (typeof identity.name !== 'string' || !identity.name || identity.name.length > 80) throw new BlackholeCoreError('Invalid Core identity name');
  if (!iso(identity.createdAt) || (at !== undefined && identity.createdAt > at)) throw new BlackholeCoreError('Invalid Core identity createdAt');
}

function validateHeartbeatEntry(entry) {
  if (!exactKeys(entry, HEARTBEAT_ENTRY_FIELDS) || !uuid(entry.id) || !iso(entry.at)) throw new BlackholeCoreError('Invalid heartbeat log entry');
  if (!HEARTBEAT_TRIGGERS.includes(entry.trigger)) throw new BlackholeCoreError('Invalid heartbeat log trigger');
  if (!ACTIVITY_STATES.includes(entry.previousActivity) || !ACTIVITY_STATES.includes(entry.nextActivity)) throw new BlackholeCoreError('Invalid heartbeat log activity value');
  if (typeof entry.reason !== 'string' || !entry.reason || entry.reason.length > 400) throw new BlackholeCoreError('Invalid heartbeat log reason');
  if (!Array.isArray(entry.changedFields) || entry.changedFields.length > CORE_FIELDS.length || entry.changedFields.some(f => typeof f !== 'string')) throw new BlackholeCoreError('Invalid heartbeat log changedFields');
}

// Structural + referential validation against the *same* state this Core
// record lives in, so a tampered or stale pointer (a mission quest that was
// never real, a shadow job id that never existed, a dominant drive that
// disagrees with the mission quest's own real driveId) fails closed exactly
// like every other cross-referenced record in this store.
export function validateCoreState(core, state) {
  if (!exactKeys(core, CORE_FIELDS)) throw new BlackholeCoreError('Invalid BlackholeCoreState shape');
  if (core.schemaVersion !== CORE_SCHEMA_VERSION) throw new BlackholeCoreError('Unsupported BlackholeCoreState schemaVersion');
  validateIdentity(core.identity, core.updatedAt ?? undefined);
  if (!ACTIVITY_STATES.includes(core.activity)) throw new BlackholeCoreError('Invalid Core activity value');
  const mission = core.missionQuestId !== null ? (state.quests ?? []).find(q => q.id === core.missionQuestId) : null;
  if (core.missionQuestId !== null && (!uuid(core.missionQuestId) || !mission)) throw new BlackholeCoreError('Core missionQuestId does not reference a real quest');
  if (core.focusProjectId !== null && (!uuid(core.focusProjectId) || !(state.projects ?? []).some(p => p.id === core.focusProjectId))) throw new BlackholeCoreError('Core focusProjectId does not reference a real project');
  // The dominant drive is never scored here: it is exactly the real driveId
  // quests.mjs already assigned to the current mission quest at creation
  // time, or null when there is no live mission - never an independently
  // settable field, so it can never drift from or fabricate beyond that.
  if (mission === null) {
    if (core.dominantDriveId !== null) throw new BlackholeCoreError('Core dominantDriveId must be null when there is no live mission');
  } else if (core.dominantDriveId !== mission.driveId || !DRIVE_IDS.includes(core.dominantDriveId)) {
    throw new BlackholeCoreError('Core dominantDriveId must equal the mission quest\'s own driveId');
  }
  if (!Array.isArray(core.activeShadowIds) || core.activeShadowIds.length > MAX_ACTIVE_SHADOWS) throw new BlackholeCoreError('Invalid Core activeShadowIds');
  for (const id of core.activeShadowIds) if (!(state.jobs ?? []).some(j => j.id === id && j.botAssignment)) throw new BlackholeCoreError('Core activeShadowIds references a non-shadow job');
  if (new Set(core.activeShadowIds).size !== core.activeShadowIds.length) throw new BlackholeCoreError('Core activeShadowIds contains a duplicate');
  validateArtifactRef(core.recentArtifactRef, state);
  // No durable outcome-verification verdict store exists in this codebase
  // yet, so a genuinely verified result can never be represented safely -
  // this must stay null rather than ever being filled from an artifact
  // alone. Fails closed the moment a future change tries to populate it
  // without also adding the real verdict store this validation would need.
  if (core.verifiedResultRef !== null) throw new BlackholeCoreError('Core verifiedResultRef must remain null until a durable outcome-verification verdict store exists');
  if (core.relationshipMemoryPointer !== null && (!uuid(core.relationshipMemoryPointer) || !(state.memoryEvents ?? []).some(e => e.id === core.relationshipMemoryPointer && e.type === 'relationship'))) throw new BlackholeCoreError('Core relationshipMemoryPointer does not reference a real relationship memory event');
  if (core.lastHeartbeatAt !== null && !iso(core.lastHeartbeatAt)) throw new BlackholeCoreError('Invalid Core lastHeartbeatAt');
  if (!Number.isSafeInteger(core.heartbeatCount) || core.heartbeatCount < 0) throw new BlackholeCoreError('Invalid Core heartbeatCount');
  if (!Array.isArray(core.heartbeatLog) || core.heartbeatLog.length > MAX_HEARTBEAT_LOG) throw new BlackholeCoreError('Invalid Core heartbeatLog');
  core.heartbeatLog.forEach(validateHeartbeatEntry);
  if ((core.lastHeartbeatAt === null) !== (core.heartbeatCount === 0)) throw new BlackholeCoreError('Core lastHeartbeatAt/heartbeatCount are inconsistent');
  if (core.updatedAt !== null && !iso(core.updatedAt)) throw new BlackholeCoreError('Invalid Core updatedAt');
}

// Pure: given the previous Core record and the *current* full store state,
// derive the next Core record plus a trace of why/what changed. Called from
// store.mjs's save() on every real persist - i.e. on every real mutation,
// never on a timer - so this never makes a provider call or any external
// side effect merely because it ran; it only ever reads already-persisted
// jobs/quests/projects/memoryEvents and computes a projection over them.
//
// `trigger` is an external fact the caller supplies - why save() was called
// right now - and is recorded separately from `reason`/`changedFields` below
// (what the projection itself found different). Conflating the two would
// make every heartbeat look like the same generic event regardless of
// whether the runtime just booted, the owner issued a command, or nothing
// meaningful changed at all; keeping them apart is what lets a reader tell
// "why it woke" from "what it noticed" without implying autonomous
// initiative that a routine persisted save never had.
export function evaluateHeartbeat(previousCore, state, {at, trigger = 'state_changed'}) {
  if (!iso(at)) throw new BlackholeCoreError('evaluateHeartbeat requires an ISO timestamp');
  if (!HEARTBEAT_TRIGGERS.includes(trigger)) throw new BlackholeCoreError('evaluateHeartbeat requires a known trigger');
  const jobs = state.jobs ?? [], quests = state.quests ?? [];

  const activity = state.emergencyStop ? 'emergency' : jobs.some(j => j.status === 'running') ? 'executing' : 'idle';

  // Current mission: the most recently updated quest still actually live
  // (queued/running/paused) - never a completed/cancelled/failed one, and
  // never invented when nothing is live.
  const liveMissions = quests.filter(q => LIVE_QUEST_STATUSES.includes(q.status)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const mission = liveMissions[0] ?? null;
  const missionQuestId = mission?.id ?? null;
  const focusProjectId = mission?.projectId ?? null;
  // Real, already-assigned evidence (quests.mjs sets driveId from SEVEN_DRIVES
  // at creation) - never scored or invented here, and null whenever there is
  // nothing live to attribute a drive to.
  const dominantDriveId = mission?.driveId ?? null;

  // Active shadows: real running project-bot jobs (project-bots.mjs), not a
  // decorative count. Deliberately excludes queued/paused - "active" means
  // actually running right now.
  const activeShadowIds = jobs.filter(j => j.botAssignment && j.status === 'running').map(j => j.id).slice(0, MAX_ACTIVE_SHADOWS);

  // Recent artifact: the most recently updated completed quest job that
  // actually produced an artifact - quests.mjs's own "artifact_recorded",
  // deliberately NOT called "verified" (see verifiedResultRef above: this
  // codebase has no durable outcome-verification verdict to point at yet).
  const resultCandidates = quests
    .map(quest => ({quest, job: jobs.find(j => j.id === quest.jobId)}))
    .filter(({job}) => job && job.status === 'completed' && (job.artifacts ?? []).length > 0)
    .sort((a, b) => b.job.updatedAt.localeCompare(a.job.updatedAt));
  const top = resultCandidates[0] ?? null;
  const recentArtifactRef = top ? {type: 'quest', questId: top.quest.id, jobId: top.job.id, artifactId: top.job.artifacts[0].id} : null;

  // Relationship memory pointer: the most recent relationship-type memory
  // event, re-derived every time rather than held as an independently
  // mutable side field, so it can never drift from what memoryEvents
  // actually contains.
  const relationshipEvents = (state.memoryEvents ?? []).filter(e => e.type === 'relationship').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const relationshipMemoryPointer = relationshipEvents[0]?.id ?? null;

  const changedFields = [];
  if (previousCore.activity !== activity) changedFields.push('activity');
  if (previousCore.missionQuestId !== missionQuestId) changedFields.push('missionQuestId');
  if (previousCore.focusProjectId !== focusProjectId) changedFields.push('focusProjectId');
  if (previousCore.dominantDriveId !== dominantDriveId) changedFields.push('dominantDriveId');
  if (JSON.stringify(previousCore.activeShadowIds) !== JSON.stringify(activeShadowIds)) changedFields.push('activeShadowIds');
  if (JSON.stringify(previousCore.recentArtifactRef) !== JSON.stringify(recentArtifactRef)) changedFields.push('recentArtifactRef');
  if (previousCore.relationshipMemoryPointer !== relationshipMemoryPointer) changedFields.push('relationshipMemoryPointer');

  const entry = {
    id: randomUUID(),
    at,
    trigger,
    reason: changedFields.length ? `changed: ${changedFields.join(', ')}` : 'observed, no change',
    previousActivity: previousCore.activity,
    nextActivity: activity,
    changedFields,
  };

  const core = {
    schemaVersion: CORE_SCHEMA_VERSION,
    identity: previousCore.identity,
    activity,
    missionQuestId,
    focusProjectId,
    dominantDriveId,
    activeShadowIds,
    recentArtifactRef,
    verifiedResultRef: null,
    relationshipMemoryPointer,
    lastHeartbeatAt: at,
    heartbeatCount: (previousCore.heartbeatCount ?? 0) + 1,
    heartbeatLog: [...(previousCore.heartbeatLog ?? []), entry].slice(-MAX_HEARTBEAT_LOG),
    updatedAt: at,
  };
  return {core, entry};
}

// The public, read-only projection this Core record is actually served as
// (GET /api/core, and a trimmed subset embedded in GET /api/state so the
// Android Home binding needs no extra network round trip). No field here is
// ever fabricated: every value is either a stored Core field or looked up
// directly from the same real quest/project/memory-event records the
// heartbeat itself derives from.
export function coreSummary(state) {
  const core = state.blackholeCore;
  const mission = core.missionQuestId ? (state.quests ?? []).find(q => q.id === core.missionQuestId) ?? null : null;
  const drive = core.dominantDriveId ? SEVEN_DRIVES.find(d => d.id === core.dominantDriveId) ?? null : null;
  const focusProject = core.focusProjectId ? (state.projects ?? []).find(p => p.id === core.focusProjectId) ?? null : null;
  const relationshipMemory = core.relationshipMemoryPointer ? (state.memoryEvents ?? []).find(e => e.id === core.relationshipMemoryPointer) ?? null : null;
  return {
    schemaVersion: core.schemaVersion,
    identity: core.identity,
    activity: core.activity,
    emergencyStop: state.emergencyStop,
    mission: mission ? {id: mission.id, goal: mission.goal, status: mission.status, driveId: mission.driveId} : null,
    focusProject: focusProject ? {id: focusProject.id, name: focusProject.name, status: focusProject.status} : null,
    dominantDriveId: core.dominantDriveId,
    dominantDriveName: drive?.name ?? null,
    // Owner-facing semantic name from the Phase C Seven Drives
    // reconciliation (seven-drives.mjs) - additive, never replaces
    // dominantDriveName so existing callers keep working unchanged.
    dominantDriveWorldName: drive?.worldName ?? null,
    activeShadowCount: core.activeShadowIds.length,
    activeShadowIds: core.activeShadowIds,
    // recentArtifactResult: a completed quest job's attached artifact - real,
    // but only integrity evidence (quests.mjs's own "artifact_recorded").
    // verifiedResult: stays null until a durable outcome-verification verdict
    // exists in this codebase; never backfilled from the artifact alone.
    recentArtifactResult: core.recentArtifactRef,
    verifiedResult: core.verifiedResultRef,
    relationshipMemory: relationshipMemory ? {id: relationshipMemory.id, type: relationshipMemory.type, text: relationshipMemory.text, createdAt: relationshipMemory.createdAt} : null,
    lastHeartbeatAt: core.lastHeartbeatAt,
    heartbeatCount: core.heartbeatCount,
    heartbeatLog: core.heartbeatLog,
    updatedAt: core.updatedAt,
  };
}

// The trimmed subset embedded into the existing GET /api/state response
// (main.ts already polls this every 3s) so the native Home binding needs no
// second fetch path at all.
export function coreHomeSummary(state) {
  const full = coreSummary(state);
  return {
    activity: full.activity,
    missionGoal: full.mission?.goal ?? null,
    focusProjectName: full.focusProject?.name ?? null,
    // Additive (UI Slice 2, issue #25): the real project ID behind
    // focusProjectName, so Home can link straight to that project's
    // Universe detail instead of only displaying its name.
    focusProjectId: full.focusProject?.id ?? null,
    dominantDriveId: full.dominantDriveId,
    dominantDriveName: full.dominantDriveName,
    dominantDriveWorldName: full.dominantDriveWorldName,
    activeShadowCount: full.activeShadowCount,
    recentArtifactResult: full.recentArtifactResult ? {questId: full.recentArtifactResult.questId} : null,
    verifiedResult: full.verifiedResult,
    lastHeartbeatAt: full.lastHeartbeatAt,
  };
}
