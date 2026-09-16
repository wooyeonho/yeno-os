import {publicQuest, validateQuestState} from './quests.mjs';
import {createCapabilityRequest} from './capabilities.mjs';
import {gradeSkill, GRADES} from './growth.mjs';
import {detectLedgerDigestGap} from './kirby.mjs';
import {observeEvidenceGaps, synthesizeAutonomousGoal} from './goal-synthesis.mjs';

// BLACKHOLE Closed Loop - first slice.
//
//   Homunculus goal (synthesized quest) -> capability gap -> Kirby ->
//   Jarvis execution (declarative capability job, zero model calls) ->
//   outcome verification (persisted artifact SHA-256 == run outputSha256) ->
//   Solo Leveling grade from the same registry history -> Homunculus replan.
//
// This module is pure: it reads state store.mjs has validated and returns a
// plan or a status; server.mjs applies at most ONE action per call. Execution
// is limited to reviewed manifests already in runtime/capabilities/*.json whose
// input is derived only from the quest's own provenance references. Authority
// is never widened: `approvalRequired` quests advance only on an explicit owner
// request, the scheduler only advances `local-reversible` quests while the
// owner has autopilot enabled, and emergency stop refuses every mutation.
// decideAndRunQuest()/runQuest() are untouched - a loop execution links to the
// quest through the normal `jobId`, so the quest completes, records artifacts
// and can receive an owner outcome exactly like any other.
export const LOOP_VERSION = 1;
export const LOOP_KEYS = 'authorizedBy,capabilityId,gradeBefore,jobId,startedAt,version';
export const LOOP_AUTHORITIES = Object.freeze(['owner', 'autopilot']);
// Archetypes with a deterministic reviewed capability that fulfils the goal's
// success criterion; the rest have none and stay owner-run only.
export const ARCHETYPE_CAPABILITY = Object.freeze({repair: 'failure-triage', 'acquire-capability': 'ledger-digest'});

const refsOf = (quest, type) => quest.synthesis.evidence.flatMap(item => item.references.filter(ref => ref.type === type).map(ref => ref.id));

// Capability input comes only from the exact records the provenance names.
// If any of them vanished or changed status, the evidence is gone and the
// loop must not execute on a different reality than the one Homunculus saw.
export function loopInput(state, quest) {
  const archetype = quest.synthesis?.archetype;
  if (archetype === 'repair') {
    const jobs = refsOf(quest, 'job').map(id => (state.jobs ?? []).find(job => job.id === id && job.status === 'failed'));
    if (!jobs.length || jobs.some(job => !job)) return null;
    return {records: jobs.slice(0, 30).map(job => ({id: job.id, title: job.title, status: job.status, error: String(job.error ?? '').slice(0, 400), nextStep: job.agentJournal?.calls?.some(call => call.status !== 'settled') ? '이전 응답 미확인: 재호출 없이 호출 기록 확인' : '보관된 입력으로 원인 재현, 수정 전후 결과 비교'}))};
  }
  if (archetype === 'acquire-capability') {
    const outcomes = refsOf(quest, 'outcome').map(id => (state.outcomes ?? []).find(o => o.id === id && typeof o.value === 'number'));
    if (!outcomes.length || outcomes.some(o => !o)) return null;
    return {records: outcomes.slice(0, 30).map(o => ({ledger: o.ledger, summary: o.summary, value: o.value, unit: o.unit}))};
  }
  return null;
}

const entryOf = (state, id) => (state.capabilities?.entries ?? []).find(entry => entry.id === id) ?? null;

function kirbyStage(state, capabilityId, manifests) {
  if (!capabilityId) return {stage: 'no_capability', capabilityId: null, active: false};
  const entry = entryOf(state, capabilityId);
  if (entry?.activeHash) return {stage: 'active', capabilityId, active: true, hash: entry.activeHash};
  const manifest = manifests.find(item => item.id === capabilityId) ?? null;
  // An imported-but-inactive entry is an owner decision (disable) or a failed
  // fixture trial. Kirby never re-activates either on its own.
  if (entry) return {stage: 'inactive_owner_review', capabilityId, active: false, versions: entry.versions.length};
  if (manifest && detectLedgerDigestGap(state, manifest)) return {stage: 'gap', capabilityId, active: false, manifestVersion: manifest.version};
  return {stage: 'unavailable', capabilityId, active: false};
}

function verificationStage(state, quest, job) {
  if (!job || job.status !== 'completed') return {verified: false, reason: job ? `작업 상태 ${job.status}` : '실행 없음', artifact: null, run: null};
  const [artifact] = publicQuest(quest, state).artifacts;
  const run = (state.capabilities?.history ?? []).find(item => item.action === 'run' && item.runId === job.id) ?? null;
  const verified = !!(artifact && run && run.id === quest.loop.capabilityId && run.outputSha256 === artifact.sha256 && run.inputSha256 === job.capabilityRequest.inputSha256);
  return {verified, reason: verified ? null : !artifact ? '산출물 없음' : !run ? '기능 실행 기록 없음' : '산출물 해시와 실행 기록 불일치', artifact: artifact ?? null, run};
}

function growthStage(state, quest) {
  try {
    const now = gradeSkill(state.capabilities, quest.loop.capabilityId);
    return {gradeBefore: quest.loop.gradeBefore, grade: now.grade, promoted: GRADES.indexOf(now.grade) > GRADES.indexOf(quest.loop.gradeBefore), nextGrade: now.nextGrade, blockedReason: now.blockedReason, evidence: now.evidence};
  } catch (error) {
    return {gradeBefore: quest.loop.gradeBefore, grade: null, promoted: false, error: error.message};
  }
}

function replanStage(state, at, quest, manifests) {
  const gaps = observeEvidenceGaps(state, {manifests});
  const same = gaps.find(gap => gap.sourceEvidenceFingerprint === quest.synthesis.sourceEvidenceFingerprint);
  const archetype = gaps.find(gap => gap.archetype === quest.synthesis.archetype);
  const next = synthesizeAutonomousGoal(state, at, {emergencyStop: !!state.emergencyStop, manifests});
  return {
    evidenceUnchanged: !!same,
    archetypeEvidence: archetype ? (same ? 'same' : 'changed') : 'resolved',
    nextOutcome: next.outcome,
    nextArchetype: next.quest?.synthesis.archetype ?? next.selected?.archetype ?? null,
  };
}

// One durable trace per autonomous quest. Read-only; nothing here decides.
export function closedLoopStatus(state, at, {manifests = []} = {}) {
  const quests = (state.quests ?? []).filter(quest => quest.synthesis);
  return {
    version: LOOP_VERSION, at,
    quests: quests.map(quest => {
      const capabilityId = ARCHETYPE_CAPABILITY[quest.synthesis.archetype] ?? null;
      const job = quest.loop ? (state.jobs ?? []).find(item => item.id === quest.loop.jobId) ?? null : null;
      const shown = publicQuest(quest, state);
      return {
        goal: {questId: quest.id, archetype: quest.synthesis.archetype, status: shown.status, approvalRequired: quest.synthesis.approvalRequired, sourceEvidenceFingerprint: quest.synthesis.sourceEvidenceFingerprint},
        capabilityGap: {capabilityId, evidenceIntact: capabilityId ? loopInput(state, quest) !== null : null},
        kirby: kirbyStage(state, capabilityId, manifests),
        execution: quest.loop ? {kind: 'capability', jobId: quest.loop.jobId, status: job?.status ?? 'missing_job', authorizedBy: quest.loop.authorizedBy, startedAt: quest.loop.startedAt} : quest.jobId ? {kind: 'agent', jobId: quest.jobId, status: shown.status, authorizedBy: 'owner'} : null,
        verification: quest.loop ? verificationStage(state, quest, job) : {verified: false, reason: quest.jobId ? '소유자 실행(모델 작업)은 기존 성과 기록 경로로 검증' : '실행 없음', artifact: null, run: null},
        growth: quest.loop ? growthStage(state, quest) : null,
        replan: replanStage(state, at, quest, manifests),
      };
    }),
  };
}

// Choose at most one mutation. `authorizedBy:'owner'` is the explicit
// POST /api/quests/loop request; 'autopilot' is the scheduler acting under the
// owner's standing autopilot opt-in and is limited to local-reversible goals.
export function planClosedLoop(state, at, {emergencyStop = false, authorizedBy = 'autopilot', manifests = []} = {}) {
  if (!LOOP_AUTHORITIES.includes(authorizedBy)) throw new Error('Invalid loop authority');
  const none = (reason, extra = {}) => ({kind: 'none', reason, ...extra});
  if (emergencyStop) return none('emergency_stop');
  if ((state.jobs ?? []).some(job => ['queued', 'running'].includes(job.status))) return none('busy');
  const waiting = (state.quests ?? []).filter(quest => quest.synthesis && quest.jobId === null && ARCHETYPE_CAPABILITY[quest.synthesis.archetype]);
  if (!waiting.length) return none('no_autonomous_goal');
  let blocked = null;
  for (const quest of waiting) {
    const capabilityId = ARCHETYPE_CAPABILITY[quest.synthesis.archetype];
    if (quest.synthesis.approvalRequired && authorizedBy !== 'owner') {blocked ??= {reason: 'owner_approval_required', questId: quest.id}; continue;}
    const input = loopInput(state, quest);
    if (!input) {blocked ??= {reason: 'evidence_changed', questId: quest.id}; continue;}
    const kirby = kirbyStage(state, capabilityId, manifests);
    if (kirby.stage === 'gap') return {kind: 'acquire', questId: quest.id, capabilityId, authorizedBy};
    if (kirby.stage !== 'active') {blocked ??= {reason: `capability_${kirby.stage}`, questId: quest.id, capabilityId}; continue;}
    return {kind: 'execute', questId: quest.id, capabilityId, manifestHash: kirby.hash, input, authorizedBy};
  }
  return none(blocked.reason, blocked);
}

// The durable link written when Jarvis accepts a loop execution. Same
// fail-closed check the store applies on load, before anything is saved.
export function bindLoopExecution(state, quest, job, {authorizedBy, at}) {
  const request = createCapabilityRequest(state.capabilities, job.capabilityRequest.id, job.capabilityRequest.input);
  if (request.hash !== job.capabilityRequest.hash) throw new Error('Capability version changed');
  const loop = {version: LOOP_VERSION, capabilityId: job.capabilityRequest.id, jobId: job.id, gradeBefore: gradeSkill(state.capabilities, job.capabilityRequest.id).grade, startedAt: at, authorizedBy};
  const bound = {...quest, jobId: job.id, status: 'assigned', startedAt: at, updatedAt: at, version: quest.version + 1, loop};
  validateQuestState({...state, quests: (state.quests ?? []).map(item => item.id === quest.id ? bound : item), jobs: (state.jobs ?? []).map(item => item.id === job.id ? {...job, questId: quest.id} : item)});
  return bound;
}
