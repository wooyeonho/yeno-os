import {publicQuest, validateQuestState} from './quests.mjs';
import {createCapabilityRequest} from './capabilities.mjs';
import {createCodeRequest, codeInputFields} from './code-workshop.mjs';
import {gradeSkill, GRADES} from './growth.mjs';
import {requiredCapability, discoverCapability, qualifyCandidate, projectInput} from './capability-discovery.mjs';
import {verifyExecution} from './outcome-verification.mjs';
import {observeEvidenceGaps, synthesizeAutonomousGoal} from './goal-synthesis.mjs';

// BLACKHOLE Closed Loop - real wiring.
//
//   Homunculus goal (synthesized quest) -> General Kirby discovery
//   (requiredCapability -> searchCapabilities over the registry, the code
//   workshop and the reviewed manifests -> qualifyCandidate) -> Kirby
//   acquisition under owner authority when a reviewed candidate qualifies ->
//   Jarvis execution (declarative capability job, zero model calls) ->
//   execution verification (outcome-verification.verifyExecution: persisted
//   artifact SHA-256 == run outputSha256; integrity only, never an outcome) ->
//   Solo Leveling grade from the same registry history -> Homunculus replan.
//
// This module is pure: it reads state store.mjs has validated and returns a
// plan or a status; server.mjs applies at most ONE action per call. No
// archetype is mapped to a capability id: a goal needs whatever can consume
// the records its provenance names, and only discovery decides that.
// Authority is never widened: `approvalRequired` quests advance only on an
// explicit owner request, acquisition of a not-yet-held capability is a
// capability change and needs the owner, the scheduler only advances
// `local-reversible` reuse while the owner has autopilot enabled, and
// emergency stop refuses every mutation (qualifyCandidate blocks reuse too).
export const LOOP_VERSION = 3;
export const LOOP_KEYS = 'authorizedBy,capabilityId,discoveryFingerprint,engine,gradeBefore,jobId,kirbyAction,startedAt,version';
export const LOOP_ENGINES = Object.freeze(['declarative-v1', 'quickjs-v1']);
export const LOOP_AUTHORITIES = Object.freeze(['owner', 'autopilot']);
// Migration record of the first slice's fixed mapping. Kept only so traces
// can show whether general discovery agrees with it; it decides nothing.
export const LEGACY_ARCHETYPE_CAPABILITY = Object.freeze({repair: 'failure-triage', 'acquire-capability': 'ledger-digest'});
export const ARCHETYPE_CAPABILITY = LEGACY_ARCHETYPE_CAPABILITY;

// Registry a loop engine executes from: declarative capabilities live in
// capabilities.mjs, QuickJS code in code-workshop.mjs. Both keep the same
// `entries[].versions[]` + `history[]` (run/rollback) shape growth reads.
export const loopRegistry = (state, engine) => engine === 'quickjs-v1' ? state.codeWorkshop : state.capabilities;
const entryOf = (state, id, engine) => (loopRegistry(state, engine)?.entries ?? []).find(entry => entry.id === id) ?? null;
const activeManifest = (state, id, engine) => {
  const entry = entryOf(state, id, engine);
  return entry?.activeHash ? entry.versions.find(item => item.hash === entry.activeHash)?.manifest ?? null : null;
};
// The request a loop job carries; code jobs keep it under codeTask.request.
export const loopRequest = job => job?.type === 'code' ? job.codeTask?.request ?? null : job?.capabilityRequest ?? null;

// General Kirby stage for one goal. Returns what discovery found, what the
// qualification verdict was, and the single action the loop may take.
export function kirbyStage(state, quest, {manifests = [], emergencyStop = false} = {}) {
  const discovery = discoverCapability(state, quest, {manifests});
  const summary = {gap: discovery.gap, reason: discovery.reason, requirementFingerprint: discovery.requirement?.fingerprint ?? null,
    recordType: discovery.requirement?.recordType ?? null, recordCount: discovery.requirement?.recordCount ?? 0,
    searched: discovery.searched ?? 0, matches: discovery.matches.map(item => ({id: item.id, origin: item.origin, engine: item.engine})),
    legacyCapabilityId: LEGACY_ARCHETYPE_CAPABILITY[quest.synthesis?.archetype] ?? null};
  if (discovery.gap === 'evidence_changed' || discovery.gap === 'no_records') return {...summary, stage: discovery.gap, capabilityId: null, active: false, qualification: null};
  if (discovery.gap === 'missing') return {...summary, stage: 'missing', capabilityId: null, active: false, qualification: null};
  if (discovery.gap === 'inactive_owner_review') {
    const qualification = qualifyCandidate(discovery.candidate, {emergencyStop});
    return {...summary, stage: 'inactive_owner_review', capabilityId: discovery.candidate.id, active: false, qualification};
  }
  if (discovery.gap === 'none') {
    // Jarvis executes either engine: a declarative capability job or a QuickJS
    // code run. A declarative match is preferred; a QuickJS match executes only
    // when its active version carries sandbox proof (`verified`) and an
    // explicit input contract - both re-checked here, never assumed.
    const candidate = discovery.candidate.engine === 'declarative-v1' ? discovery.candidate
      : discovery.matches.find(item => item.origin === 'active' && item.engine === 'declarative-v1') ?? discovery.candidate;
    const qualification = qualifyCandidate(candidate, {emergencyStop});
    if (!LOOP_ENGINES.includes(candidate.engine)) return {...summary, stage: 'engine_unsupported', capabilityId: candidate.id, active: true, qualification};
    if (candidate.engine === 'quickjs-v1' && (candidate.verified !== true || !codeInputFields(activeManifest(state, candidate.id, 'quickjs-v1')))) {
      return {...summary, stage: 'blocked', capabilityId: candidate.id, active: true, engine: candidate.engine, qualification: {...qualification, action: 'blocked', eligible: false,
        blockers: [...(qualification.blockers ?? []), candidate.verified !== true ? 'sandbox_proof_missing' : 'input_contract_missing']}};
    }
    return {...summary, stage: qualification.action === 'reuse' ? 'active' : 'blocked', capabilityId: candidate.id, active: true, engine: candidate.engine, hash: candidate.hash, qualification};
  }
  // acquire_reviewed: a repository-reviewed manifest fits; Kirby may import ->
  // verify -> activate it, but only once qualification passes and the owner asks.
  const manifest = manifests.find(item => item.id === discovery.candidate.id) ?? null;
  const qualification = qualifyCandidate(discovery.candidate, {manifest, emergencyStop});
  return {...summary, stage: qualification.action === 'acquire_with_owner_approval' ? 'gap' : 'blocked', capabilityId: discovery.candidate.id, active: false,
    manifestVersion: discovery.candidate.version, qualification};
}

// Capability input comes only from the exact records the provenance names,
// projected down to the fields the matched manifest declares. If any record
// vanished or changed status the evidence is gone and nothing executes.
export function loopInput(state, quest, {manifests = []} = {}) {
  const kirby = kirbyStage(state, quest, {manifests});
  if (kirby.stage !== 'active') return null;
  const manifest = activeManifest(state, kirby.capabilityId, kirby.engine);
  const required = requiredCapability(state, quest);
  if (!manifest || !required.ok || !required.records.length) return null;
  return projectInput(required.records, manifest);
}

function verificationStage(state, quest, job) {
  if (!job || job.status !== 'completed') return {verified: false, executionVerified: false, outcomeVerified: false, reason: job ? `작업 상태 ${job.status}` : '실행 없음', artifact: null, run: null};
  const artifacts = publicQuest(quest, state).artifacts;
  const run = (loopRegistry(state, quest.loop.engine)?.history ?? []).find(item => item.action === 'run' && item.runId === job.id) ?? null;
  // A code run stores its report and its canonical JSON output; the output
  // artifact is the one whose bytes the run record digested.
  const artifact = (run && artifacts.find(item => item.sha256 === run.outputSha256)) ?? artifacts[0] ?? null;
  if (!artifact) return {verified: false, executionVerified: false, outcomeVerified: false, reason: '산출물 없음', artifact: null, run};
  if (!run) return {verified: false, executionVerified: false, outcomeVerified: false, reason: '기능 실행 기록 없음', artifact, run: null};
  const verdict = verifyExecution({artifactSha256: artifact.sha256, run, job: {...job, capabilityRequest: loopRequest(job)}});
  const sameCapability = run.id === quest.loop.capabilityId;
  const verified = verdict.executionVerified && sameCapability;
  return {verified, executionVerified: verified, outcomeVerified: false, reason: verified ? null : !sameCapability ? '실행 기록의 기능이 고리 기록과 다름' : verdict.reasons.join('; '), artifact, run, reasons: verdict.reasons};
}

function growthStage(state, quest) {
  try {
    const now = gradeSkill(loopRegistry(state, quest.loop.engine), quest.loop.capabilityId);
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
      const kirby = kirbyStage(state, quest, {manifests, emergencyStop: !!state.emergencyStop});
      const job = quest.loop ? (state.jobs ?? []).find(item => item.id === quest.loop.jobId) ?? null : null;
      const shown = publicQuest(quest, state);
      return {
        goal: {questId: quest.id, archetype: quest.synthesis.archetype, status: shown.status, approvalRequired: quest.synthesis.approvalRequired, sourceEvidenceFingerprint: quest.synthesis.sourceEvidenceFingerprint},
        capabilityGap: {capabilityId: quest.loop?.capabilityId ?? kirby.capabilityId, evidenceIntact: !['evidence_changed', 'no_records'].includes(kirby.stage), gap: kirby.gap,
          requirementFingerprint: kirby.requirementFingerprint, recordType: kirby.recordType, recordCount: kirby.recordCount, legacyCapabilityId: kirby.legacyCapabilityId, agreesWithLegacy: kirby.capabilityId ? kirby.capabilityId === kirby.legacyCapabilityId : null},
        kirby,
        execution: quest.loop ? {kind: 'capability', engine: quest.loop.engine, jobId: quest.loop.jobId, status: job?.status ?? 'missing_job', authorizedBy: quest.loop.authorizedBy, startedAt: quest.loop.startedAt, kirbyAction: quest.loop.kirbyAction} : quest.jobId ? {kind: 'agent', jobId: quest.jobId, status: shown.status, authorizedBy: 'owner'} : null,
        verification: quest.loop ? verificationStage(state, quest, job) : {verified: false, executionVerified: false, outcomeVerified: false, reason: quest.jobId ? '소유자 실행(모델 작업)은 기존 성과 기록 경로로 검증' : '실행 없음', artifact: null, run: null},
        growth: quest.loop ? growthStage(state, quest) : null,
        replan: replanStage(state, at, quest, manifests),
      };
    }),
  };
}

// Choose at most one mutation. `authorizedBy:'owner'` is the explicit
// POST /api/quests/loop request; 'autopilot' is the scheduler acting under the
// owner's standing autopilot opt-in and is limited to local-reversible reuse.
export function planClosedLoop(state, at, {emergencyStop = false, authorizedBy = 'autopilot', manifests = []} = {}) {
  if (!LOOP_AUTHORITIES.includes(authorizedBy)) throw new Error('Invalid loop authority');
  const none = (reason, extra = {}) => ({kind: 'none', reason, ...extra});
  if (emergencyStop) return none('emergency_stop');
  if ((state.jobs ?? []).some(job => ['queued', 'running'].includes(job.status))) return none('busy');
  const waiting = (state.quests ?? []).filter(quest => quest.synthesis && quest.jobId === null);
  if (!waiting.length) return none('no_autonomous_goal');
  let blocked = null;
  for (const quest of waiting) {
    if (quest.synthesis.approvalRequired && authorizedBy !== 'owner') {blocked ??= {reason: 'owner_approval_required', questId: quest.id}; continue;}
    const kirby = kirbyStage(state, quest, {manifests, emergencyStop});
    const capabilityId = kirby.capabilityId;
    if (kirby.stage === 'gap') {
      if (kirby.qualification.approvalRequired && authorizedBy !== 'owner') {blocked ??= {reason: 'owner_approval_required', questId: quest.id, capabilityId, risk: kirby.qualification.risk}; continue;}
      return {kind: 'acquire', questId: quest.id, capabilityId, manifestHash: kirby.qualification.hash, risk: kirby.qualification.risk, authorizedBy, discoveryFingerprint: kirby.requirementFingerprint};
    }
    if (kirby.stage !== 'active') {blocked ??= {reason: ['evidence_changed', 'no_records'].includes(kirby.stage) ? kirby.stage : `capability_${kirby.stage}`, questId: quest.id, capabilityId, blockers: kirby.qualification?.blockers ?? []}; continue;}
    const input = loopInput(state, quest, {manifests});
    if (!input) {blocked ??= {reason: 'evidence_changed', questId: quest.id}; continue;}
    return {kind: 'execute', questId: quest.id, capabilityId, engine: kirby.engine, manifestHash: kirby.hash, input, authorizedBy, kirbyAction: kirby.qualification.action, discoveryFingerprint: kirby.requirementFingerprint};
  }
  return none(blocked.reason, blocked);
}

// The durable link written when Jarvis accepts a loop execution. Same
// fail-closed check the store applies on load, before anything is saved.
export function bindLoopExecution(state, quest, job, {authorizedBy, at, kirbyAction = 'reuse', discoveryFingerprint}) {
  const engine = job.type === 'code' ? 'quickjs-v1' : 'declarative-v1';
  const held = loopRequest(job);
  if (!held || (engine === 'quickjs-v1' && job.codeTask?.mode !== 'run')) throw new Error('Loop job must carry an execution request');
  const request = engine === 'quickjs-v1' ? createCodeRequest(state.codeWorkshop, held.id, held.input) : createCapabilityRequest(state.capabilities, held.id, held.input);
  if (request.hash !== held.hash) throw new Error('Capability version changed');
  if (typeof discoveryFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(discoveryFingerprint)) throw new Error('Discovery fingerprint required');
  const loop = {version: LOOP_VERSION, engine, capabilityId: held.id, jobId: job.id, gradeBefore: gradeSkill(loopRegistry(state, engine), held.id).grade, startedAt: at, authorizedBy, kirbyAction, discoveryFingerprint};
  const bound = {...quest, jobId: job.id, status: 'assigned', startedAt: at, updatedAt: at, version: quest.version + 1, loop};
  validateQuestState({...state, quests: (state.quests ?? []).map(item => item.id === quest.id ? bound : item), jobs: (state.jobs ?? []).map(item => item.id === job.id ? {...job, questId: quest.id} : item)});
  return bound;
}
