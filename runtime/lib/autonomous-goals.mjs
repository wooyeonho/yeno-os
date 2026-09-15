import { rankMotivatedCandidates, DRIVE_IDS } from './motivation.mjs';
import { planQuest, publicQuest } from './quests.mjs';

// Homunculus, until now, only ranked goals a person (or another part of the
// system) had already written down as a 'proposed' quest - it never noticed a
// real problem and proposed a goal of its own. This module is the first,
// deliberately bounded slice of that: it OBSERVES only durable, already-
// trusted runtime state (failed jobs, completed-but-unverified quests, a real
// capability gap, completed work nobody ever measured) and, when a real,
// unaddressed condition exists, proposes exactly one new quest for it -
// through the exact same rankMotivatedCandidates() scoring every other
// candidate set in this codebase uses, so "why this goal" is the same real
// seven-drive reasoning, not a special case.
//
// What this deliberately does NOT do:
//   - No model call, ever. Synthesis is pure and deterministic; it must work
//     with zero AI credentials configured, because deciding what to work on
//     is not the same privilege as being allowed to spend an AI call on it.
//   - No archetype invents a goal from nothing. Every candidate's `evidence`
//     is a direct reference to real state (a job id, a quest id, a capability
//     id) - never a summary or a guess.
//   - No execution. This only ever proposes a 'proposed' quest into the
//     existing Quest -> Homunculus ranking -> Jarvis execution pipeline
//     (see decide.mjs/server.mjs runQuest()) - it is not a second execution
//     system, and running the result still goes through the same
//     provider-readiness and daily-call-limit checks every quest does.

// A small, fixed vocabulary, not a free-form label the synthesizer invents
// per call. The last two are reserved but never fire in this slice: neither
// has a structured, already-tracked field to observe honestly yet -
// "refresh-evidence" would just re-detect autopilot.mjs's own already-running
// research-staleness handling (a second system for the same real question),
// and "reduce-owner-intervention" would have to guess that unrelated
// owner-paused jobs are the *same* recurring task from nothing but a pause
// reason, which growth.mjs's own honest grade-A precedent already refuses to
// do. Same principle as MISSING_MEASUREMENTS in motivation.mjs: an
// unimplemented archetype stays absent, never faked.
export const ARCHETYPES = Object.freeze([
  'repair', 'verify', 'acquire-capability', 'measure-outcome',
  'refresh-evidence', 'reduce-owner-intervention',
]);
export const RISK_CLASSES = Object.freeze(['low', 'medium', 'high']);

// Every archetype this slice can actually observe routes through the exact
// same bounded 'agent' quest execution as any owner-written quest (a normal,
// already-safety-checked model call under the existing per-quest maxCalls and
// daily budget). Only 'acquire-capability' is marked approval-required: the
// goal names a real Kirby capability gap, and this project's own standing
// rule is that acquiring a new capability - even through the existing
// sandboxed import/verify/activate pipeline - is never something to
// authorize without the owner seeing it first. Nothing here can ever
// authorize a purchase, a credential change, external publishing, a
// destructive action, or a larger AI budget - none of those actions exist on
// this execution path at all.
const RISK_BY_ARCHETYPE = Object.freeze({
  repair: { riskClass: 'low', approvalRequired: false },
  verify: { riskClass: 'low', approvalRequired: false },
  'measure-outcome': { riskClass: 'low', approvalRequired: false },
  'acquire-capability': { riskClass: 'medium', approvalRequired: true },
});
// An archetype this synthesizer does not yet know how to observe (or a
// tampered/unexpected one) is never treated as automatically safe.
const UNKNOWN_RISK = Object.freeze({ riskClass: 'high', approvalRequired: true });

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const flat = value => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null;
// Evidence must stay a small, flat, JSON-safe record of real identifiers -
// the same "no nested/invented structure" bar validateOutput() in
// code-sandbox.mjs holds guest code output to.
export function boundedEvidence(value) {
  if (!object(value)) return false;
  const entries = Object.entries(value);
  if (!entries.length || entries.length > 12) return false;
  return entries.every(([key, v]) => typeof key === 'string' && key.length <= 60 && flat(v) && (typeof v !== 'string' || v.length <= 400));
}

function existingAutonomyKeys(state) {
  return new Set((state.quests ?? []).map(quest => quest.autonomy?.key).filter(Boolean));
}

// repair: the most recent job that actually failed and has no autonomous
// repair quest already on file for it. Deliberately just the single most
// recent one per call - the synthesizer only ever proposes one goal at a
// time (see synthesizeAutonomousGoal), and re-observation after a restart or
// a poll naturally reaches the next one once the first is no longer new.
function observeRepair(state, seenKeys) {
  const failed = (state.jobs ?? [])
    .filter(job => job.status === 'failed')
    .sort((a, b) => (Date.parse(b.updatedAt ?? b.createdAt) || 0) - (Date.parse(a.updatedAt ?? a.createdAt) || 0));
  for (const job of failed) {
    const key = `repair:job:${job.id}`;
    if (seenKeys.has(key)) continue;
    const error = job.error ? String(job.error).slice(0, 300) : null;
    return {
      archetype: 'repair', key,
      goal: `실패한 작업("${String(job.title ?? job.id).slice(0, 80)}")의 원인을 분석하고 복구 방법을 제안한다.`,
      successCriterion: '실패 원인, 재현 가능한 조건, 다음에 시도할 구체적인 복구 단계를 구분해 정리한다. 실패한 입력을 그대로 다시 실행하지 않는다.',
      baseline: error ? `실패 기록: ${error}` : '실패 기록에 오류 메시지가 없음',
      evidence: { jobId: job.id, jobType: String(job.type), failedAt: job.updatedAt ?? job.createdAt, hasError: !!error },
      signals: { repairNeed: 1, verificationGap: 1 },
    };
  }
  return null;
}

// verify: a completed quest whose execution actually has an unconfirmed
// ("unknown") model call - the same real ambiguity motivation.mjs's own
// observedFeedback() already tracks for the background autopilot loop,
// applied here to quest-tied jobs instead.
function observeVerify(state, seenKeys) {
  for (const quest of state.quests ?? []) {
    const pub = publicQuest(quest, state);
    if (pub.status !== 'completed' || pub.executionUsage.unknown <= 0) continue;
    const key = `verify:quest:${quest.id}`;
    if (seenKeys.has(key)) continue;
    return {
      archetype: 'verify', key,
      goal: `완료 표시된 목표("${quest.goal.slice(0, 60)}")의 미확인 모델 응답을 확인하고 결과를 검증한다.`,
      successCriterion: '미확인 호출의 실제 상태를 확인하고, 결과를 신뢰할 수 있는지 없는지를 명확히 표시한다.',
      baseline: `미확인 호출 ${pub.executionUsage.unknown}건이 있는 채로 완료 표시됨`,
      evidence: { questId: quest.id, jobId: quest.jobId, unknownCalls: pub.executionUsage.unknown },
      signals: { verificationGap: 1 },
    };
  }
  return null;
}

// measure-outcome: a completed quest with a real, verified artifact that the
// owner has never attached a wealth/honor/fame outcome to - real, finished
// work with zero measurement, not a guess that measurement is missing.
function observeMeasureOutcome(state, seenKeys) {
  const outcomes = state.outcomes ?? [];
  for (const quest of state.quests ?? []) {
    const pub = publicQuest(quest, state);
    if (pub.resultStatus !== 'artifact_recorded') continue;
    if (outcomes.some(outcome => outcome.questId === quest.id)) continue;
    const key = `measure-outcome:quest:${quest.id}`;
    if (seenKeys.has(key)) continue;
    return {
      archetype: 'measure-outcome', key,
      goal: `완료된 목표("${quest.goal.slice(0, 60)}")의 실제 효과를 측정해 부·명예·인지도 장부에 기록할 근거를 정리한다.`,
      successCriterion: '실제로 측정 가능한 값과 단위, 또는 아직 측정할 수 없다는 사실을 정직하게 정리한다. 근거 없는 수치를 만들지 않는다.',
      baseline: '완료된 결과가 있지만 성과 기록이 없음',
      evidence: { questId: quest.id, jobId: quest.jobId },
      signals: { deliveryGap: 1, verificationGap: 1 },
    };
  }
  return null;
}

// acquire-capability: reuses kirby.mjs's own detectLedgerDigestGap() (or any
// equivalent gap the caller has already computed) - never a second gap
// detector. The caller passes real gaps in; this stays pure/no file I/O.
function observeAcquireCapability(capabilityGaps, seenKeys) {
  for (const gap of capabilityGaps ?? []) {
    if (!gap?.manifest?.id) continue;
    const key = `acquire-capability:${gap.manifest.id}`;
    if (seenKeys.has(key)) continue;
    return {
      archetype: 'acquire-capability', key,
      goal: `아직 활성화하지 않은 "${gap.manifest.name ?? gap.manifest.id}" 기능을 흡수할 조건을 정리한다.`,
      successCriterion: '흡수 근거, 기대 효과, 남은 위험을 정리한다. 실제 활성화는 별도 승인 절차를 거친다.',
      baseline: String(gap.reason ?? '').slice(0, 300),
      evidence: { capabilityId: gap.manifest.id },
      signals: { assetGap: 1, verificationGap: 1 },
    };
  }
  return null;
}

// Pure and deterministic - no model call, no I/O, no mutation. Returns null
// (never a fabricated goal) when nothing real is observed, or exactly one
// candidate: the single highest-scoring real, not-already-proposed
// observation, ranked by the same motivation engine every other candidate
// set uses. `capabilityGaps` lets the caller supply already-computed
// kirby.mjs gap results (this module never reads capability manifests
// itself).
export function synthesizeAutonomousGoal(state, at, { capabilityGaps = [] } = {}) {
  const seenKeys = existingAutonomyKeys(state);
  const observed = [
    observeRepair(state, seenKeys),
    observeVerify(state, seenKeys),
    observeMeasureOutcome(state, seenKeys),
    observeAcquireCapability(capabilityGaps, seenKeys),
  ].filter(Boolean);
  if (!observed.length) return null;
  const candidates = observed.map(source => ({
    action: { kind: 'autonomous-goal', taskKey: source.key },
    goal: source.goal, successCriterion: source.successCriterion, signals: source.signals,
    _source: source,
  }));
  const ranked = rankMotivatedCandidates(state, candidates, at);
  const winner = ranked[0], source = winner._source;
  const risk = RISK_BY_ARCHETYPE[source.archetype] ?? UNKNOWN_RISK;
  return {
    archetype: source.archetype, key: source.key,
    goal: winner.motivation.goal, successCriterion: winner.motivation.successCriterion,
    baseline: source.baseline, evidence: source.evidence,
    dominantDrives: winner.motivation.dominantDrives,
    sourceRevision: Number.isSafeInteger(state.revision) ? state.revision : 0,
    riskClass: risk.riskClass, approvalRequired: risk.approvalRequired,
  };
}

// Builds a real, fully-validated quest (through the exact same planQuest()
// every owner-created quest goes through) and attaches the autonomy record
// the owner-created path never has. This never calls save()/pushes onto
// state itself - the caller (server.mjs) owns persistence, exactly like
// addQuest() does for owner-created quests.
export function planAutonomousQuest(candidate, state, config = {}) {
  const quest = planQuest({
    goal: candidate.goal, driveId: candidate.dominantDrives[0],
    successCriterion: candidate.successCriterion, baseline: candidate.baseline,
    maxCalls: 2, durationMinutes: 30,
  }, state, config);
  quest.autonomy = {
    version: 1, archetype: candidate.archetype, key: candidate.key,
    evidence: candidate.evidence, dominantDrives: candidate.dominantDrives,
    sourceRevision: candidate.sourceRevision, riskClass: candidate.riskClass,
    approvalRequired: candidate.approvalRequired, generatedAt: new Date().toISOString(),
  };
  return quest;
}

// Exported so quests.mjs's validateQuestState() and this module's own tests
// agree on exactly one definition of a valid autonomy record.
export function validAutonomy(value) {
  if (!object(value) || Object.keys(value).sort().join() !== ['approvalRequired', 'archetype', 'dominantDrives', 'evidence', 'generatedAt', 'key', 'riskClass', 'sourceRevision', 'version'].sort().join()) return false;
  if (value.version !== 1 || !ARCHETYPES.includes(value.archetype) || typeof value.key !== 'string' || !value.key || value.key.length > 200) return false;
  if (!boundedEvidence(value.evidence)) return false;
  if (!Array.isArray(value.dominantDrives) || value.dominantDrives.length < 1 || value.dominantDrives.length > 2 || new Set(value.dominantDrives).size !== value.dominantDrives.length || value.dominantDrives.some(id => !DRIVE_IDS.includes(id))) return false;
  if (!Number.isSafeInteger(value.sourceRevision) || value.sourceRevision < 0) return false;
  if (!RISK_CLASSES.includes(value.riskClass) || typeof value.approvalRequired !== 'boolean') return false;
  if (typeof value.generatedAt !== 'string' || !Number.isFinite(Date.parse(value.generatedAt)) || new Date(value.generatedAt).toISOString() !== value.generatedAt) return false;
  return true;
}
