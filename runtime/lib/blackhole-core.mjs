import {randomUUID} from 'node:crypto';
import {SEVEN_DRIVES} from './quests.mjs';
import {decideQuest} from './decide.mjs';
import {motivationStatus} from './motivation.mjs';

// BLACKHOLE Living Core, Phase A — persistent self + event-driven heartbeat.
// Extended for the Homunculus Heartbeat stage (continuous execution
// directive, Stage 2): autonomyMode/currentQuestId/currentGoalId/
// measuredDrivePressure/pendingApprovalIds/lastReplanAt/lastGrowthEvidenceRef.
//
// This is deliberately NOT a parallel state system: activity/mission/focus
// project/dominant drive/active shadows/recent result are all *derived* on
// every heartbeat from the existing durable jobs/quests/projects/botAssignment
// records this codebase already validates and persists (quests.mjs already
// assigns every quest a real driveId from SEVEN_DRIVES; project-bots.mjs
// already tracks running bot-assigned jobs as the Shadow precursor; the
// Homunculus fields below are exactly decide.mjs's own quest ranking and
// motivation.mjs's own per-drive pressure, read here rather than
// reimplemented). The only genuinely new durable fields are the ones nothing
// else already represents: the activity/autonomyMode enums, the heartbeat
// trace log, and a pointer into the new memory-events ledger (see
// memory-events.mjs). No independent Seven Drives scoring algorithm, no
// Shadow provider execution beyond what shadow-army.mjs already runs, no XP -
// those remain later phases.
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
  'schemaVersion', 'identity', 'activity', 'autonomyMode', 'missionQuestId', 'focusProjectId', 'dominantDriveId',
  'currentQuestId', 'currentGoalId', 'measuredDrivePressure', 'activeShadowIds', 'pendingApprovalIds',
  'recentArtifactRef', 'verifiedResultRef', 'relationshipMemoryPointer', 'lastGrowthEvidenceRef',
  'lastHeartbeatAt', 'lastReplanAt', 'heartbeatCount', 'heartbeatLog', 'updatedAt',
]);
// Homunculus Heartbeat (BLACKHOLE continuous execution directive, Stage 2).
// paused is the only possible starting value and the only value a store that
// never enables autopilot will ever see - it is never an independently
// settable switch, only ever exactly what deriveAutonomyMode() below already
// says from the existing, already owner-gated state.autopilot.enabled /
// state.emergencyStop. There is no new "turn Homunculus on" mutation
// anywhere in this slice.
export const AUTONOMY_MODES = Object.freeze(['paused', 'active', 'emergency_stopped']);
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
const GROWTH_EVIDENCE_REF_FIELDS = Object.freeze(['type', 'outcomeId']);
const MAX_ACTIVE_SHADOWS = 50;
const MAX_HEARTBEAT_LOG = 20;
const MAX_PENDING_APPROVALS = 50;
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
    autonomyMode: 'paused',
    missionQuestId: null,
    focusProjectId: null,
    dominantDriveId: null,
    currentQuestId: null,
    currentGoalId: null,
    measuredDrivePressure: null,
    activeShadowIds: [],
    pendingApprovalIds: [],
    recentArtifactRef: null,
    // No durable outcome-verification verdict store exists anywhere in this
    // codebase yet (outcome-verification.mjs's verifyOutcome() output is
    // never persisted) - so this stays null until such real, checkable
    // evidence exists. It must never be filled from a completed job's
    // artifact alone; that is recentArtifactRef, and is not verification.
    verifiedResultRef: null,
    relationshipMemoryPointer: null,
    lastGrowthEvidenceRef: null,
    lastHeartbeatAt: null,
    lastReplanAt: null,
    heartbeatCount: 0,
    heartbeatLog: [],
    updatedAt: null,
  };
}

// Pure. autonomyMode is never itself a stored decision - it is always exactly
// what the existing owner-gated autopilot toggle and emergency stop already
// say, so no new authority is created and no new place can turn it "active".
export function deriveAutonomyMode(state) {
  if (state.emergencyStop) return 'emergency_stopped';
  return state.autopilot?.enabled === true ? 'active' : 'paused';
}

// Pure. Every field here is read from an engine this codebase already has
// and already tests elsewhere: decide.mjs's own quest ranking (the same
// ranking "정해줘" already uses), motivation.mjs's own per-drive pressure
// (the same numbers the autopilot status screen already shows), and
// quests.mjs's own synthesis provenance / self-reported outcome ledger. This
// never scores, schedules, or creates a quest - it only reads the same real
// state every other read path already reads, so the Homunculus Heartbeat
// snapshot can never say anything the rest of the system doesn't already
// know and hasn't already validated.
export function deriveHomunculusFields(state, at) {
  const quests = state.quests ?? [];
  const decision = decideQuest(state, at);
  const currentQuestId = decision?.top?.questId ?? null;
  const currentQuest = currentQuestId ? quests.find(q => q.id === currentQuestId) ?? null : null;
  // A "goal" is a proposed quest the autonomous synthesis engine itself wrote
  // (quest.synthesis, goal-synthesis.mjs) - an owner-authored quest is a
  // quest, never a Homunculus-selected "goal", so currentGoalId stays null
  // whenever the currently-selected quest is not one Homunculus itself
  // proposed.
  const currentGoalId = currentQuest?.synthesis ? currentQuest.id : null;
  const measuredDrivePressure = decision
    ? motivationStatus(state, decision.candidates, decision.top, at).drives
        .find(drive => drive.id === decision.top.motivation.dominantDrives[0])?.pressure ?? null
    : null;
  // Real proposed quests still waiting on the owner's explicit approval
  // (goal-synthesis.mjs's own approvalRequired, set per-archetype at
  // creation, never inferred here) - not a new approval mechanism.
  const pendingApprovalIds = quests
    .filter(quest => quest.status === 'proposed' && quest.synthesis?.approvalRequired === true)
    .map(quest => quest.id);
  const replanTimestamps = quests.filter(quest => quest.synthesis).map(quest => quest.synthesis.createdAt);
  const lastReplanAt = replanTimestamps.length ? replanTimestamps.slice().sort().at(-1) : null;
  const outcomes = (state.outcomes ?? []).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  // The only durable, real growth-evidence ledger this codebase has today is
  // the owner's self-reported outcome record (quests.mjs's recordQuestOutcome
  // - wealth/honor/fame, verification:'self_reported'). Labeled honestly as
  // an outcome reference, never as an independently verified growth grade.
  const lastGrowthEvidenceRef = outcomes.length ? {type: 'outcome', outcomeId: outcomes[0].id} : null;
  return {
    autonomyMode: deriveAutonomyMode(state),
    currentQuestId, currentGoalId, measuredDrivePressure, pendingApprovalIds, lastReplanAt, lastGrowthEvidenceRef,
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
  // Homunculus Heartbeat fields (BLACKHOLE continuous execution directive,
  // Stage 2). Exactly like dominantDriveId/recentArtifactRef above, these are
  // validated for REFERENTIAL self-consistency against whatever is actually
  // claimed - never recomputed-and-compared against a fresh decide.mjs/
  // motivation.mjs run. A byte-exact recompute would reject perfectly honest
  // state that many existing fixtures (and a real store between two
  // heartbeats) legitimately have: quests/outcomes pushed directly without
  // an intervening evaluateHeartbeat() call. What actually matters here is
  // that a claimed pointer can never be fabricated or dangling - not that
  // the snapshot is maximally fresh.
  if (!AUTONOMY_MODES.includes(core.autonomyMode)) throw new BlackholeCoreError('Invalid Core autonomyMode value');
  if (core.currentQuestId !== null && (!uuid(core.currentQuestId) || !(state.quests ?? []).some(q => q.id === core.currentQuestId && q.status === 'proposed'))) throw new BlackholeCoreError('Core currentQuestId does not reference a real proposed quest');
  const currentQuest = core.currentQuestId !== null ? (state.quests ?? []).find(q => q.id === core.currentQuestId) : null;
  if (core.currentGoalId !== null) {
    // A "goal" is never a distinct record from its quest - currentGoalId is
    // either the same id as currentQuestId (when that quest is one
    // Homunculus itself synthesized) or null. It can never point elsewhere.
    if (core.currentGoalId !== core.currentQuestId || !currentQuest?.synthesis) throw new BlackholeCoreError('Core currentGoalId must equal currentQuestId and reference a quest with real synthesis provenance');
  }
  if (core.measuredDrivePressure !== null) {
    if (core.currentQuestId === null) throw new BlackholeCoreError('Core measuredDrivePressure must be null when there is no current quest to measure');
    if (typeof core.measuredDrivePressure !== 'number' || !Number.isFinite(core.measuredDrivePressure) || core.measuredDrivePressure < 0 || core.measuredDrivePressure > 100) throw new BlackholeCoreError('Invalid Core measuredDrivePressure');
  }
  if (!Array.isArray(core.pendingApprovalIds) || core.pendingApprovalIds.length > MAX_PENDING_APPROVALS) throw new BlackholeCoreError('Invalid Core pendingApprovalIds');
  for (const id of core.pendingApprovalIds) if (!uuid(id) || !(state.quests ?? []).some(q => q.id === id && q.status === 'proposed' && q.synthesis?.approvalRequired === true)) throw new BlackholeCoreError('Core pendingApprovalIds references a quest that is not really awaiting owner approval');
  if (new Set(core.pendingApprovalIds).size !== core.pendingApprovalIds.length) throw new BlackholeCoreError('Core pendingApprovalIds contains a duplicate');
  if (core.lastReplanAt !== null) {
    if (!iso(core.lastReplanAt)) throw new BlackholeCoreError('Invalid Core lastReplanAt');
    if (!(state.quests ?? []).some(q => q.synthesis?.createdAt === core.lastReplanAt)) throw new BlackholeCoreError('Core lastReplanAt does not match any real goal-synthesis event');
  }
  if (core.lastGrowthEvidenceRef !== null) {
    if (!exactKeys(core.lastGrowthEvidenceRef, GROWTH_EVIDENCE_REF_FIELDS) || core.lastGrowthEvidenceRef.type !== 'outcome') throw new BlackholeCoreError('Invalid Core lastGrowthEvidenceRef shape');
    if (!(state.outcomes ?? []).some(o => o.id === core.lastGrowthEvidenceRef.outcomeId)) throw new BlackholeCoreError('Core lastGrowthEvidenceRef does not reference a real outcome');
  }
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

  const homunculus = deriveHomunculusFields(state, at);

  const changedFields = [];
  if (previousCore.activity !== activity) changedFields.push('activity');
  if (previousCore.autonomyMode !== homunculus.autonomyMode) changedFields.push('autonomyMode');
  if (previousCore.missionQuestId !== missionQuestId) changedFields.push('missionQuestId');
  if (previousCore.focusProjectId !== focusProjectId) changedFields.push('focusProjectId');
  if (previousCore.dominantDriveId !== dominantDriveId) changedFields.push('dominantDriveId');
  if (previousCore.currentQuestId !== homunculus.currentQuestId) changedFields.push('currentQuestId');
  if (previousCore.currentGoalId !== homunculus.currentGoalId) changedFields.push('currentGoalId');
  if (previousCore.measuredDrivePressure !== homunculus.measuredDrivePressure) changedFields.push('measuredDrivePressure');
  if (JSON.stringify(previousCore.activeShadowIds) !== JSON.stringify(activeShadowIds)) changedFields.push('activeShadowIds');
  if (JSON.stringify(previousCore.pendingApprovalIds) !== JSON.stringify(homunculus.pendingApprovalIds)) changedFields.push('pendingApprovalIds');
  if (JSON.stringify(previousCore.recentArtifactRef) !== JSON.stringify(recentArtifactRef)) changedFields.push('recentArtifactRef');
  if (previousCore.relationshipMemoryPointer !== relationshipMemoryPointer) changedFields.push('relationshipMemoryPointer');
  if (JSON.stringify(previousCore.lastGrowthEvidenceRef) !== JSON.stringify(homunculus.lastGrowthEvidenceRef)) changedFields.push('lastGrowthEvidenceRef');
  if (previousCore.lastReplanAt !== homunculus.lastReplanAt) changedFields.push('lastReplanAt');

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
    autonomyMode: homunculus.autonomyMode,
    missionQuestId,
    focusProjectId,
    dominantDriveId,
    currentQuestId: homunculus.currentQuestId,
    currentGoalId: homunculus.currentGoalId,
    measuredDrivePressure: homunculus.measuredDrivePressure,
    activeShadowIds,
    pendingApprovalIds: homunculus.pendingApprovalIds,
    recentArtifactRef,
    verifiedResultRef: null,
    relationshipMemoryPointer,
    lastGrowthEvidenceRef: homunculus.lastGrowthEvidenceRef,
    lastHeartbeatAt: at,
    lastReplanAt: homunculus.lastReplanAt,
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
  const currentQuest = core.currentQuestId ? (state.quests ?? []).find(q => q.id === core.currentQuestId) ?? null : null;
  const growthEvidence = core.lastGrowthEvidenceRef ? (state.outcomes ?? []).find(o => o.id === core.lastGrowthEvidenceRef.outcomeId) ?? null : null;
  return {
    schemaVersion: core.schemaVersion,
    identity: core.identity,
    activity: core.activity,
    emergencyStop: state.emergencyStop,
    // autonomyMode is read-only here too: it is exactly the existing owner
    // autopilot toggle/emergency stop, never a separate switch this API (or
    // any client of it) can flip.
    autonomyMode: core.autonomyMode,
    mission: mission ? {id: mission.id, goal: mission.goal, status: mission.status, driveId: mission.driveId} : null,
    focusProject: focusProject ? {id: focusProject.id, name: focusProject.name, status: focusProject.status} : null,
    dominantDriveId: core.dominantDriveId,
    dominantDriveName: drive?.name ?? null,
    // Owner-facing semantic name from the Phase C Seven Drives
    // reconciliation (seven-drives.mjs) - additive, never replaces
    // dominantDriveName so existing callers keep working unchanged.
    dominantDriveWorldName: drive?.worldName ?? null,
    // currentQuest/currentGoalId: decide.mjs's own current top-ranked proposed
    // quest (the same pick "정해줘" would return) - null whenever nothing is
    // proposed. currentGoalId narrows to only quests the autonomous
    // goal-synthesis engine itself proposed (quest.synthesis present).
    currentQuest: currentQuest ? {id: currentQuest.id, goal: currentQuest.goal, status: currentQuest.status, driveId: currentQuest.driveId} : null,
    currentGoalId: core.currentGoalId,
    // measuredDrivePressure: motivation.mjs's own per-drive pressure for
    // whichever drive currently leads the top candidate - the same number
    // the autopilot status screen already exposes, never a new score.
    measuredDrivePressure: core.measuredDrivePressure,
    activeShadowCount: core.activeShadowIds.length,
    activeShadowIds: core.activeShadowIds,
    // Real proposed quests still waiting on the owner's explicit approval
    // (goal-synthesis.mjs's own approvalRequired) - never auto-approved here.
    pendingApprovalIds: core.pendingApprovalIds,
    // recentArtifactResult: a completed quest job's attached artifact - real,
    // but only integrity evidence (quests.mjs's own "artifact_recorded").
    // verifiedResult: stays null until a durable outcome-verification verdict
    // exists in this codebase; never backfilled from the artifact alone.
    recentArtifactResult: core.recentArtifactRef,
    verifiedResult: core.verifiedResultRef,
    relationshipMemory: relationshipMemory ? {id: relationshipMemory.id, type: relationshipMemory.type, text: relationshipMemory.text, createdAt: relationshipMemory.createdAt} : null,
    // lastGrowthEvidence: the most recent owner self-reported outcome
    // (quests.mjs's recordQuestOutcome ledger) - honestly labeled
    // self-reported, never an independently verified growth grade.
    lastGrowthEvidence: growthEvidence ? {id: growthEvidence.id, ledger: growthEvidence.ledger, summary: growthEvidence.summary, value: growthEvidence.value, unit: growthEvidence.unit, verification: growthEvidence.verification, createdAt: growthEvidence.createdAt} : null,
    lastHeartbeatAt: core.lastHeartbeatAt,
    lastReplanAt: core.lastReplanAt,
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
    autonomyMode: full.autonomyMode,
    missionGoal: full.mission?.goal ?? null,
    focusProjectName: full.focusProject?.name ?? null,
    // Additive (UI Slice 2, issue #25): the real project ID behind
    // focusProjectName, so Home can link straight to that project's
    // Universe detail instead of only displaying its name.
    focusProjectId: full.focusProject?.id ?? null,
    dominantDriveId: full.dominantDriveId,
    dominantDriveName: full.dominantDriveName,
    dominantDriveWorldName: full.dominantDriveWorldName,
    measuredDrivePressure: full.measuredDrivePressure,
    activeShadowCount: full.activeShadowCount,
    pendingApprovalCount: full.pendingApprovalIds.length,
    recentArtifactResult: full.recentArtifactResult ? {questId: full.recentArtifactResult.questId} : null,
    verifiedResult: full.verifiedResult,
    lastHeartbeatAt: full.lastHeartbeatAt,
    lastReplanAt: full.lastReplanAt,
  };
}
