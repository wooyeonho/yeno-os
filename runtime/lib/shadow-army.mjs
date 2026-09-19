import {randomUUID} from 'node:crypto';
import {validateProjectRegistry} from './projects.mjs';

// BLACKHOLE Real Shadow Army — Phase D, issue #25 §6 (first slice).
//
// This module invents NO second job/mission engine. A "Shadow" is a real
// `state.jobs[]` record (the exact same durable job store server.mjs already
// runs, pauses, cancels, and recovers on restart) carrying one additive
// field, `shadowAssignment`, in the same spirit as project-bots.mjs's
// existing `botAssignment` — which blackhole-core.mjs already treats as the
// literal definition of "Shadow" (`activeShadowIds` = running jobs with a
// bot/shadow assignment). Worker roles (scout/researcher/builder) stay plain
// `type:'agent'` jobs, so every existing agent execution path (model
// routing, pause/resume/cancel, emergency stop, restart recovery, provider
// honesty) applies to them unchanged. Only the verifier role introduces a
// genuinely new job type, `'verify'` - deterministic, local, no model call -
// because no verifier-job concept existed anywhere before this slice.
//
// Jarvis planning here is intentionally the smallest real task graph that
// can prove bounded parallel + dependency-ordered execution: two independent
// leaf shadows (scout, researcher) feed one builder, which one verifier
// checks. Real world missions may need more roles later; this slice does not
// invent generic multi-role planning, only this one fixed, real shape.
export const SHADOW_ROLES = Object.freeze(['scout', 'researcher', 'builder', 'verifier']);
export const MAX_ACTIVE_MISSIONS_PER_PROJECT = 3;

export class ShadowArmyError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = value => typeof value === 'string' && UUID.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const trimmedText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max ? value.trim() : null;

const ROLE_PROMPTS = {
  scout: goal => `당신은 BLACKHOLE Shadow Army의 Scout입니다. 다음 목표에 필요한 실제 자료·제약·기존 산출물을 조사해 짧은 조사 노트를 작성하세요. 실행하지 않은 조사·확인하지 않은 사실을 확인했다고 쓰지 마세요.\n\n목표: ${goal}`,
  researcher: goal => `당신은 BLACKHOLE Shadow Army의 Researcher입니다. 다음 목표와 관련된 대안·위험·성공 기준 후보를 정리하세요. 실행하지 않은 조사를 확인했다고 쓰지 마세요.\n\n목표: ${goal}`,
  builder: goal => `당신은 BLACKHOLE Shadow Army의 Builder입니다. 이전 Scout·Researcher의 실제 노트를 입력으로 받아, 지금 사용할 수 있는 산출물 본문을 완성하세요. 계획만 나열하지 말고 실제 결과를 작성하세요.\n\n목표: ${goal}`,
};

function assertProjectUsable(project) {
  if (!project || !['active', 'paused'].includes(project.status)) throw new ShadowArmyError(400, '진행 중이거나 보류된 기존 프로젝트를 선택하세요.');
}

// Pure planning: produces plain specs only. The caller (server.mjs) turns
// each spec into a real job record and persists all of them in one durable
// save, exactly like planProjectBots/planQuest already do for their own
// records - never partially materialized, never a second store.
export function planShadowMission(state, body) {
  if (!object(body)) throw new ShadowArmyError(400, '임무 입력 형식이 잘못되었습니다.');
  if (state.emergencyStop) throw new ShadowArmyError(409, '전체 멈춤을 먼저 해제하세요.');
  if (Object.keys(body).some(key => !['requestId', 'projectId', 'goal', 'successCriterion'].includes(key))) throw new ShadowArmyError(400, '지원하지 않는 필드가 있습니다.');
  const project = (state.projects ?? []).find(p => p.id === body.projectId);
  if (!uuid(body.projectId) || !project) throw new ShadowArmyError(404, '기존 프로젝트를 찾을 수 없습니다.');
  assertProjectUsable(project);
  const activeMissions = missionsForProject(project.id, state).filter(m => !['completed', 'failed'].includes(m.phase));
  if (activeMissions.length >= MAX_ACTIVE_MISSIONS_PER_PROJECT) throw new ShadowArmyError(409, '이 프로젝트에 이미 진행 중인 임무가 최대치입니다. 기존 임무를 완료하거나 취소하세요.');
  const goal = trimmedText(body.goal, 4000);
  if (!goal) throw new ShadowArmyError(400, '목표는 1~4000자여야 합니다.');
  const successCriterion = trimmedText(body.successCriterion, 2000) ?? '실제 산출물 1개를 완성하고 검증 가능한 근거를 남긴다.';
  const missionId = randomUUID();
  const scoutId = randomUUID(), researcherId = randomUUID(), builderId = randomUUID(), verifierId = randomUUID();
  // The full project record (same shape project-bots.mjs's botAssignment.context
  // already carries) - a shadow worker's tools scope to this exact clone, so a
  // trimmed context would silently break project_read/project_sources for it.
  const projectContext = structuredClone(project);
  const base = {missionId, projectId: project.id, projectVersion: project.version, projectContext, goal, successCriterion};
  return {
    missionId,
    specs: [
      {...base, id: scoutId, role: 'scout', dependsOnJobIds: []},
      {...base, id: researcherId, role: 'researcher', dependsOnJobIds: []},
      {...base, id: builderId, role: 'builder', dependsOnJobIds: [scoutId, researcherId]},
      {...base, id: verifierId, role: 'verifier', dependsOnJobIds: [builderId]},
    ],
  };
}

// Pure job-record construction from one spec. Worker roles are ordinary
// `type:'agent'` jobs (no new execution path); the verifier role is the one
// genuinely new, deterministic, local job type this slice adds.
export function shadowJobFromSpec(spec, at) {
  const shadowAssignment = {missionId: spec.missionId, role: spec.role, dependsOnJobIds: spec.dependsOnJobIds, projectId: spec.projectId, projectVersion: spec.projectVersion, context: spec.projectContext};
  const hasDeps = spec.dependsOnJobIds.length > 0;
  const common = {id: spec.id, status: hasDeps ? 'paused' : 'queued', ...(hasDeps ? {pauseReason: 'dependencyPending'} : {}), step: 0, totalSteps: 3, createdAt: at, updatedAt: at, error: null, version: 1, artifacts: [], projectId: spec.projectId, shadowAssignment};
  if (spec.role === 'verifier') {
    return {...common, type: 'verify', title: `Shadow 검증 · ${spec.projectContext.name}`, input: JSON.stringify({missionId: spec.missionId, subjectJobIds: spec.dependsOnJobIds}), verifyRequest: {missionId: spec.missionId, subjectJobIds: spec.dependsOnJobIds}};
  }
  return {...common, type: 'agent', title: `Shadow ${spec.role} · ${spec.projectContext.name}`, input: (ROLE_PROMPTS[spec.role] ?? ROLE_PROMPTS.builder)(spec.goal)};
}

export function validateShadowAssignment(job) {
  const a = job.shadowAssignment;
  if (!Object.hasOwn(job, 'shadowAssignment')) return;
  if (!object(a) || Object.keys(a).sort().join() !== 'context,dependsOnJobIds,missionId,projectId,projectVersion,role'.split(',').sort().join()) throw new Error('Invalid shadow assignment');
  if (!uuid(a.missionId) || !SHADOW_ROLES.includes(a.role) || !Array.isArray(a.dependsOnJobIds) || a.dependsOnJobIds.length > 4 || a.dependsOnJobIds.some(id => !uuid(id))) throw new Error('Invalid shadow assignment fields');
  if (!Number.isSafeInteger(a.projectVersion) || a.projectVersion < 1) throw new Error('Invalid shadow assignment project version');
  if (!object(a.context) || a.context.id !== a.projectId || a.context.version !== a.projectVersion || !['active', 'paused'].includes(a.context.status)) throw new Error('Invalid shadow assignment context');
  validateProjectRegistry([a.context]);
  if (a.role === 'verifier') {
    if (job.type !== 'verify') throw new Error('Verifier shadow must be a verify job');
    if (!object(job.verifyRequest) || job.verifyRequest.missionId !== a.missionId || JSON.stringify(job.verifyRequest.subjectJobIds) !== JSON.stringify(a.dependsOnJobIds)) throw new Error('Invalid verify request');
  } else if (job.type !== 'agent') throw new Error('Worker shadow must be an agent job');
}

// Dependencies are resolved from real sibling job records only - never a
// second durable graph. "Met" requires every dependency to have reached a
// real completed state; a failed/cancelled dependency is reported
// separately (shadowDependencyFailed) so a builder never silently starts on
// top of a broken scout, and a stuck dependency never silently unblocks.
export function shadowDependenciesMet(job, jobs) {
  const deps = job.shadowAssignment?.dependsOnJobIds ?? [];
  return deps.every(id => jobs.find(j => j.id === id)?.status === 'completed');
}
export function shadowDependencyFailed(job, jobs) {
  const deps = job.shadowAssignment?.dependsOnJobIds ?? [];
  return deps.some(id => ['failed', 'cancelled'].includes(jobs.find(j => j.id === id)?.status));
}

// Mirrors project-bots.mjs's botBlockReason exactly in spirit (same honest
// reasons, never auto-retried, never silently promoted) but for a shadow
// worker job, which has no per-job provider profile - it uses the same
// default agent config every other unassigned agent job would.
export function shadowBlockReason(job, state, config) {
  const a = job.shadowAssignment; if (!a || job.type !== 'agent') return null;
  const project = state.projects.find(p => p.id === job.projectId);
  if (!project || project.status !== a.context.status || project.version !== a.projectVersion) return 'projectChanged';
  if (!config?.ready) return 'providerMissing';
  if (job.agentJournal?.calls.some(c => c.status !== 'settled')) return 'outcomeUnknown';
  if (!state.modules.ai) return 'moduleDisabled';
  return null;
}

// The one genuinely new verification logic this slice adds: no capability
// run exists for an agent-produced artifact (outcome-verification.mjs's
// verifyExecution checks a capability run's stored output hash, which does
// not apply here), so this reuses the exact same integrity bar
// quests.mjs's recordQuestOutcome already requires before it will accept a
// job's output as real evidence - a completed job, at least one recorded
// artifact, and no unresolved ("unknown") model-call outcome. This is a
// deterministic, evidence-based check; it makes no model call and asserts
// nothing about the artifact's *content* quality.
export function verifyShadowArtifacts(subjectJobs) {
  const subjects = subjectJobs.map(job => {
    if (!job) return {jobId: null, verified: false, reasons: ['subject_job_missing']};
    const reasons = [];
    if (job.status !== 'completed') reasons.push('subject_not_completed');
    if (!(job.artifacts ?? []).length) reasons.push('subject_artifact_missing');
    if ((job.agentJournal?.calls ?? []).some(c => c.status !== 'settled')) reasons.push('subject_outcome_unknown');
    return {jobId: job.id, verified: reasons.length === 0, reasons};
  });
  return {verified: subjects.length > 0 && subjects.every(s => s.verified), reasons: subjects.flatMap(s => s.reasons), subjects};
}

function shadowPhase(shadows, verify) {
  if (shadows.some(s => s.status === 'failed') || verify?.status === 'failed') return 'failed';
  if (verify?.status === 'completed') return 'completed';
  if (shadows.every(s => s.status === 'completed') && verify) return 'verifying';
  if (shadows.some(s => s.status === 'paused')) return 'blocked';
  if (shadows.some(s => ['queued', 'running'].includes(s.status))) return 'running';
  return 'planning';
}

// Pure read-side aggregation over the real job records - the same idiom
// project-universe.mjs's projectUniverseSummary already uses (filter
// existing state, never a parallel index). Nothing here is fabricated: every
// field is copied from a real job.
export function missionStatus(missionId, state) {
  const jobs = (state.jobs ?? []).filter(job => job.shadowAssignment?.missionId === missionId);
  if (!jobs.length) return null;
  const verify = jobs.find(job => job.shadowAssignment.role === 'verifier') ?? null;
  const shadows = jobs.filter(job => job.shadowAssignment.role !== 'verifier').map(job => ({
    jobId: job.id, role: job.shadowAssignment.role, status: job.status, pauseReason: job.pauseReason ?? null,
    dependsOnJobIds: job.shadowAssignment.dependsOnJobIds, artifacts: (job.artifacts ?? []).map(a => ({id: a.id, name: a.name})),
    provider: job.agentJournal?.provider ?? null, model: job.agentJournal?.model ?? null,
  }));
  const projectId = jobs[0].projectId;
  return {
    missionId, projectId, phase: shadowPhase(shadows, verify), shadows,
    verify: verify ? {jobId: verify.id, status: verify.status, pauseReason: verify.pauseReason ?? null, result: verify.verifyResult ?? null} : null,
  };
}

export function missionsForProject(projectId, state) {
  const ids = new Set((state.jobs ?? []).filter(job => job.shadowAssignment?.projectId === projectId).map(job => job.shadowAssignment.missionId));
  return [...ids].map(id => missionStatus(id, state)).filter(Boolean);
}
