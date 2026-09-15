import {rankMotivatedCandidates} from './motivation.mjs';
import {planQuest, publicQuest, validateQuestState, SYNTHESIS_VERSION, SYNTHESIS_ARCHETYPES, SYNTHESIS_ARCHETYPE_RISK, synthesisApprovalRequired, synthesisFingerprint, synthesisQuestId} from './quests.mjs';
import {detectLedgerDigestGap} from './kirby.mjs';

// Homunculus Autonomous Goal Synthesis - first production-safe slice.
//
//   observe validated durable state -> normalized evidence gaps -> bounded
//   archetype candidates -> existing Seven Drives ranking -> ONE normal
//   `proposed` Quest with provenance.
//
// Everything here is deterministic local logic over state that store.mjs has
// already validated. No model call, no network, no free-form goal text: every
// goal is a fixed template filled only with counts and record ids. Creating a
// goal grants no execution authority - the Quest sits in `proposed` exactly
// like an owner-written one until the owner (or the existing decide/run path)
// starts it. Emergency stop: observation is allowed, persistence is refused.
// Owner priority: while any owner-written quest is still `proposed`, nothing
// autonomous is persisted at all (outcome `owner_quest_pending`).
export {SYNTHESIS_ARCHETYPES, SYNTHESIS_VERSION};
// Archetypes whose observer is enabled in this slice. The other three stay in
// the schema but produce nothing until a durable signal exists for them:
//   reduce-owner-intervention - two unrelated owner pauses are not a pattern;
//   refresh-evidence          - no stored staleness signal; no invented age threshold.
export const ENABLED_ARCHETYPES = Object.freeze(['repair', 'verify', 'acquire-capability', 'measure-outcome']);
export const MAX_AUTONOMOUS_PROPOSED = SYNTHESIS_ARCHETYPES.length;
export const AUTONOMOUS_KIND = 'autonomous-goal';

const NO_BASELINE = '기준값 미측정';
const ids = items => [...new Set(items)].sort();
const listIds = list => list.slice(0, 8).join(', ') + (list.length > 8 ? ` 외 ${list.length - 8}건` : '');

// Each observer reads one kind of durable evidence and returns null when the
// evidence does not justify a goal. `references` identify the exact records,
// `values` are the material facts the goal depends on; both feed the
// fingerprint, so a new failing job or a newly measured quest changes the
// identity while time, revision or code SHA never do.
const OBSERVERS = Object.freeze({
  repair(state) {
    const failed = (state.jobs ?? []).filter(job => job.status === 'failed');
    if (failed.length < 2) return null;
    return {
      kind: 'repeated_failed_jobs',
      references: ids(failed.map(job => job.id)).map(id => ({type: 'job', id})),
      values: {failedJobs: failed.length},
      signals: {repairNeed: Math.min(failed.length, 8), verificationGap: 1, estimatedCalls: 0.25},
      goal: `반복 실패한 작업 ${failed.length}건의 저장된 오류·단계를 분석해 재발 방지 조치를 정리한다 (작업 ID: ${listIds(ids(failed.map(job => job.id)))})`,
      successCriterion: '각 실패 작업의 저장된 오류 원인과 실패 단계, 재시도 없이 적용할 수 있는 수정 조치를 산출물 1개로 정리한다. 실패한 입력은 자동 재전송하지 않는다.',
      reason: `저장된 작업 기록에서 status:'failed'인 작업이 ${failed.length}건 확인되었습니다.`,
    };
  },
  verify(state) {
    const unverified = questRecords(state).filter(q => q.status === 'completed' && (q.resultStatus === 'artifact_missing' || q.outcomeUnknown));
    if (!unverified.length) return null;
    const list = ids(unverified.map(q => q.id));
    return {
      kind: 'completed_without_verified_artifact',
      references: list.map(id => ({type: 'quest', id})),
      values: {unverifiedQuests: unverified.length},
      signals: {verificationGap: Math.min(unverified.length, 8), deliveryGap: 1, estimatedCalls: 0.25},
      goal: `완료 표시만 있고 확인 가능한 산출물이 없는 목표 ${unverified.length}건의 실행 기록을 검증한다 (목표 ID: ${listIds(list)})`,
      successCriterion: '해당 목표마다 저장된 호출 기록·결과 참조를 대조해 실제 산출물 유무와 부족한 근거를 산출물 1개로 기록한다.',
      reason: `완료된 목표 ${unverified.length}건에 SHA-256 산출물 참조가 없거나 모델 응답이 미확인 상태입니다.`,
    };
  },
  'measure-outcome'(state) {
    const unmeasured = questRecords(state).filter(q => q.status === 'completed' && q.resultStatus === 'artifact_recorded' && q.outcomeRecords.length === 0);
    if (!unmeasured.length) return null;
    const list = ids(unmeasured.map(q => q.id));
    return {
      kind: 'completed_without_outcome',
      references: list.map(id => ({type: 'quest', id})),
      values: {unmeasuredQuests: unmeasured.length},
      signals: {assetGap: Math.min(unmeasured.length, 8), verificationGap: 1, estimatedCalls: 0.25},
      goal: `산출물은 저장됐지만 성과 측정이 없는 목표 ${unmeasured.length}건의 측정 항목과 기준값을 정리한다 (목표 ID: ${listIds(list)})`,
      successCriterion: '각 산출물에 대해 부·명예·인지도 중 측정 가능한 항목, 단위, 확인 방법을 산출물 1개로 정리한다. 측정값 자체를 지어내지 않는다.',
      reason: `산출물이 기록된 완료 목표 ${unmeasured.length}건에 성과 기록이 없습니다.`,
    };
  },
  // Demand-backed only: reuses Kirby's own gap detector, which requires real
  // measured ledger outcomes AND the reviewed manifest not yet active. An
  // inactive capability nobody has demonstrated a need for yields nothing.
  'acquire-capability'(state, {manifests}) {
    const gaps = manifests.map(manifest => ({manifest, gap: detectLedgerDigestGap(state, manifest)})).filter(item => item.gap);
    if (!gaps.length) return null;
    const measured = ids((state.outcomes ?? []).filter(o => typeof o.value === 'number' && o.value >= 0).map(o => o.id));
    const list = ids(gaps.map(item => item.manifest.id));
    return {
      kind: 'demanded_capability_inactive',
      references: [...list.map(id => ({type: 'capability', id})), ...measured.map(id => ({type: 'outcome', id}))],
      values: {capabilities: list, measuredOutcomes: measured.length},
      signals: {knowledgeGap: 1, assetGap: Math.min(measured.length, 8), estimatedCalls: 0},
      goal: `측정값이 있는 성과 기록 ${measured.length}건이 요구하는 미활성 기능 ${list.length}종의 흡수 조건을 정리한다 (기능 ID: ${listIds(list)})`,
      successCriterion: '각 기능의 저장된 원본·시험 기록과 그 기능이 정리할 성과 기록을 대조해 활성화를 막는 조건과 안전한 다음 단계를 산출물 1개로 기록한다. 활성화는 소유자 승인 후에만 진행한다.',
      reason: gaps.map(item => item.gap.reason).join(' '),
    };
  },
  'refresh-evidence'(state) {
    const projects = (state.projects ?? []).filter(project => project.status === 'active');
    const stalled = projects.filter(project => !(state.jobs ?? []).some(job => job.projectId === project.id) && !(state.quests ?? []).some(q => q.projectId === project.id));
    if (!stalled.length) return null;
    const list = ids(stalled.map(project => project.id));
    return {
      kind: 'active_project_without_execution_evidence',
      references: list.map(id => ({type: 'project', id})),
      values: {stalledProjects: stalled.length},
      signals: {knowledgeGap: Math.min(stalled.length, 8), coverageGap: 1, estimatedCalls: 0.25},
      goal: `실행 기록이 전혀 없는 활성 프로젝트 ${stalled.length}개의 저장된 다음 행동과 필요한 근거를 정리한다 (프로젝트 ID: ${listIds(list)})`,
      successCriterion: '각 프로젝트의 저장된 요약·다음 행동을 바탕으로 부족한 근거와 첫 실행 단계를 산출물 1개로 정리한다.',
      reason: `활성 프로젝트 ${stalled.length}개에 연결된 작업·목표가 하나도 없습니다.`,
    };
  },
  'reduce-owner-intervention'(state) {
    const paused = (state.jobs ?? []).filter(job => job.status === 'paused' && job.pauseReason === 'owner');
    if (paused.length < 2) return null;
    const list = ids(paused.map(job => job.id));
    return {
      kind: 'repeated_owner_pause',
      references: list.map(id => ({type: 'job', id})),
      values: {ownerPausedJobs: paused.length},
      signals: {reuseArtifacts: Math.min(paused.length, 8), deliveryGap: 1, estimatedCalls: 0},
      goal: `소유자가 직접 멈춘 작업 ${paused.length}건의 공통 원인을 정리해 개입 없이 끝낼 수 있는 조건을 제안한다 (작업 ID: ${listIds(list)})`,
      successCriterion: '각 중지 작업의 저장된 상태·단계를 비교해 반복되는 개입 원인과 사전 확인 항목을 산출물 1개로 정리한다. 작업을 자동 재개하지 않는다.',
      reason: `pauseReason:'owner'로 멈춘 작업이 ${paused.length}건 저장되어 있습니다.`,
    };
  },
});

function questRecords(state) {
  return (state.quests ?? []).map(quest => publicQuest(quest, state));
}

export function evidenceFingerprint(archetype, evidence) {
  return synthesisFingerprint(archetype, evidence);
}

const ownerProposedQuests = state => (state.quests ?? []).filter(quest => quest.status === 'proposed' && !quest.synthesis);

// Pure. Throws when the state itself is not a valid Quest state - unverifiable
// evidence must fail closed instead of producing a goal. `manifests` are the
// repository-reviewed Kirby manifests the runtime already loads.
export function observeEvidenceGaps(state, {manifests = []} = {}) {
  validateQuestState(state);
  return ENABLED_ARCHETYPES.flatMap(archetype => {
    const observed = OBSERVERS[archetype](state, {manifests});
    if (!observed) return [];
    const evidence = [{kind: observed.kind, references: observed.references, values: observed.values}];
    return [{archetype, evidence, sourceEvidenceFingerprint: synthesisFingerprint(archetype, evidence), ...observed}];
  });
}

const autonomousQuests = state => (state.quests ?? []).filter(quest => quest.synthesis);

// Pure. Ranks every observed gap through the existing Seven Drives engine and
// explains, per gap, whether a Quest already exists for exactly this evidence.
export function previewAutonomousGoals(state, at, options = {}) {
  const gaps = observeEvidenceGaps(state, options);
  const ranked = rankMotivatedCandidates(state, gaps.map(gap => ({
    action: {kind: AUTONOMOUS_KIND, taskKey: `${AUTONOMOUS_KIND}:${gap.archetype}:${gap.sourceEvidenceFingerprint}`},
    goal: gap.goal, successCriterion: gap.successCriterion, signals: gap.signals, gap,
  })), at);
  const existing = autonomousQuests(state);
  return {
    version: SYNTHESIS_VERSION, at,
    candidates: ranked.map(candidate => ({
      archetype: candidate.gap.archetype, evidence: candidate.gap.evidence, reason: candidate.gap.reason,
      sourceEvidenceFingerprint: candidate.gap.sourceEvidenceFingerprint, goal: candidate.goal, successCriterion: candidate.successCriterion,
      riskClass: SYNTHESIS_ARCHETYPE_RISK[candidate.gap.archetype], approvalRequired: synthesisApprovalRequired(SYNTHESIS_ARCHETYPE_RISK[candidate.gap.archetype]), motivation: candidate.motivation,
      existingQuestId: existing.find(q => q.synthesis.sourceEvidenceFingerprint === candidate.gap.sourceEvidenceFingerprint)?.id ?? null,
    })),
    autonomousQuests: existing.map(q => ({id: q.id, status: q.status, archetype: q.synthesis.archetype, sourceEvidenceFingerprint: q.synthesis.sourceEvidenceFingerprint})),
    ownerProposedQuestIds: ownerProposedQuests(state).map(q => q.id),
  };
}

// Decides what ONE Quest (if any) this observation justifies. Returns a plan;
// it never mutates `state`. `persist` is only true when the caller may append
// `plan.quest` to state.quests through the normal Quest contract.
export function synthesizeAutonomousGoal(state, at, {emergencyStop = false, manifests = []} = {}) {
  const preview = previewAutonomousGoals(state, at, {manifests});
  const existing = autonomousQuests(state);
  const base = {...preview, persist: false, quest: null};
  if (!preview.candidates.length) return {...base, outcome: 'no_actionable_evidence'};
  // Owner priority is absolute, not a score: an owner-written proposed quest
  // means the owner has already said what matters. Preview stays visible.
  if (preview.ownerProposedQuestIds.length) return {...base, outcome: 'owner_quest_pending'};
  // Highest-ranked gap first. Evidence that already has its quest is answered
  // with that quest; an archetype whose earlier quest is still `proposed` is
  // not re-proposed on new evidence (bounded accumulation: at most one open
  // autonomous quest per archetype, MAX_AUTONOMOUS_PROPOSED overall).
  let known = null;
  for (const candidate of preview.candidates) {
    if (candidate.existingQuestId) {known ??= {quest: existing.find(q => q.id === candidate.existingQuestId), selected: candidate}; continue;}
    if (existing.some(q => q.status === 'proposed' && q.synthesis.archetype === candidate.archetype)) continue;
    if (existing.filter(q => q.status === 'proposed').length >= MAX_AUTONOMOUS_PROPOSED) return {...base, outcome: 'autonomous_capacity', selected: candidate};
    if (emergencyStop) return {...base, outcome: 'emergency_stop', selected: candidate};
    const quest = buildQuest(state, candidate, at);
    return {...base, outcome: 'new_quest', persist: true, quest, selected: candidate};
  }
  return known ? {...base, outcome: 'existing_quest', ...known} : {...base, outcome: 'archetype_pending'};
}

function buildQuest(state, candidate, at) {
  const planned = planQuest({goal: candidate.goal, successCriterion: candidate.successCriterion, baseline: NO_BASELINE, driveId: candidate.motivation.dominantDrives[0], maxCalls: 1, durationMinutes: 30}, state);
  const id = synthesisQuestId(candidate.sourceEvidenceFingerprint);
  const quest = {
    ...planned, id, createdAt: at, updatedAt: at,
    synthesis: {
      version: SYNTHESIS_VERSION, archetype: candidate.archetype, evidence: structuredClone(candidate.evidence),
      sourceState: {revision: Number.isSafeInteger(state.revision) ? state.revision : 0, quests: (state.quests ?? []).length, jobs: (state.jobs ?? []).length},
      reason: candidate.reason, riskClass: candidate.riskClass, approvalRequired: candidate.approvalRequired,
      autonomousGoalId: id, sourceEvidenceFingerprint: candidate.sourceEvidenceFingerprint,
      motivation: structuredClone(candidate.motivation), createdAt: at,
    },
  };
  // Same fail-closed gate the store applies on load: an unpersistable quest is
  // rejected here, before anything is written.
  validateQuestState({...state, quests: [quest, ...(state.quests ?? [])]});
  return quest;
}
