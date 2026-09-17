// E->D->C->B->A->S skill growth grading, computed only from evidence that
// already exists in a capabilities.mjs/code-workshop.mjs-shaped registry
// ({entries:[{id,versions,activeHash,previousHash}], history:[{at,action,id,
// hash,runId,inputSha256,outputSha256}]}). This module never assigns a grade
// from a claim - only from history entries the registry's own validators
// already require to be internally consistent (activation requires a passed
// fixture verification; a 'run' event requires a real runId/inputSha256/
// outputSha256). Where the current data model cannot actually prove a grade's
// requirement (skill composition, intervention counts, externally-verified
// business outcomes), the grade is reported as blocked with the specific
// missing evidence, never guessed.
export const GRADES = Object.freeze(['E', 'D', 'C', 'B', 'A', 'S']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function runsFor(history, id) {
  return history.filter(event => event.action === 'run' && event.id === id);
}
function rollbacksFor(history, id) {
  return history.filter(event => event.action === 'rollback' && event.id === id);
}

// D: an activated (fixture-verified) version has completed at least one real
// execution - "real task completion with independent verification". The
// fixtures a manifest ships with are the independent check: they are fixed
// at import time and a later run cannot silently redefine what counts as
// passing.
function gradeD(entry, runs) {
  if (!entry.activeHash) return { met: false, reason: '활성화된(시험을 통과한) 버전이 없습니다.' };
  if (runs.length < 1) return { met: false, reason: '활성화 이후 실제 실행 기록이 없습니다.' };
  return { met: true, reason: null };
}

// C: reused on genuinely different input, not the same answer replayed. Two
// runs with an identical inputSha256 prove nothing about reuse.
function gradeC(runs) {
  const distinctInputs = new Set(runs.map(run => run.inputSha256));
  if (distinctInputs.size < 2) return { met: false, reason: '서로 다른 입력 2건 이상에서 실행된 기록이 없습니다(동일 입력 재실행은 재사용으로 인정하지 않습니다).' };
  return { met: true, reason: null };
}

// B: real composition evidence - this skill's verified input hash equals
// another skill's own earlier verified output hash, i.e. it structurally
// consumed real prior output, not merely "a rollback happened and a later
// run succeeded". `leveling` (a runtime/lib/solo-leveling.mjs history,
// derived from real job/quest state by leveling-evidence.mjs) is the only
// thing that can see across skills to prove that; a bare registry alone
// cannot, so without it this stays honestly blocked on the same reason as
// before rather than inferring composition from unrelated signals such as a
// rollback-then-run pattern within a single skill.
function gradeB(runs, rollbacks, leveling) {
  if (leveling) return leveling.checks.B.met ? { met: true, reason: null } : { met: false, reason: leveling.checks.B.reason };
  const recovered = rollbacks.some(rollback => runs.some(run => Date.parse(run.at) > Date.parse(rollback.at)));
  if (!recovered) return { met: false, reason: '복구(롤백 이후 실제 실행 재개) 기록이 없습니다.' };
  return { met: false, reason: '다른 기능과의 조합 사용을 기록하는 구조가 아직 없습니다 — 복구는 확인됐지만 조합 증거가 없어 판정할 수 없습니다.' };
}

// A: "낮은 개입으로 반복 운영" needs a per-run intervention measure (how
// often the owner had to step in between runs). `leveling` supplies real
// autopilot-authorized, zero-intervention successes when the caller has it;
// without it, this stays honestly blocked rather than inferring intervention
// from run count or rollback count alone.
function gradeA(leveling) {
  if (!leveling) return { met: false, reason: '실행마다 필요했던 소유자 개입 횟수를 기록하는 구조가 아직 없습니다.' };
  return leveling.checks.A.met ? { met: true, reason: null } : { met: false, reason: leveling.checks.A.reason };
}

// S: "강한 비교 대안보다 실제 지표 우세와 고객 가치 확인" needs an
// externally-verified outcome.
// Only an outcome-verification verdict (runtime/lib/outcome-verification.mjs)
// with outcomeVerified && highGradeCandidate (external_verified) counts. A
// ledger record's own `verification` string is a claim and is never consulted.
function gradeS(verdicts) {
  const verified = verdicts.some(v => v && v.outcomeVerified === true && v.highGradeCandidate === true && v.authorizesAction === false);
  if (!verified) return { met: false, reason: '외부에서 검증된 성과 판정(outcomeVerified·external_verified)이 없습니다 — 장부의 self_reported 기록은 근거가 아닙니다.' };
  return { met: true, reason: null };
}

// outcomes: optional array of outcome-verification verdicts linked to this
// skill's executions. Omit it and S simply stays blocked.
// leveling: optional runtime/lib/solo-leveling.mjs history for this exact
// skill id (build it with leveling-evidence.mjs's levelingHistoriesFromState
// against the full runtime state - this module alone only ever sees the
// registry, never jobs/quests/artifacts). Omit it and B/A stay honestly
// blocked exactly as before, unchanged for every existing caller.
export function gradeSkill(registry, id, { outcomes = [], leveling = null } = {}) {
  if (!object(registry) || !Array.isArray(registry.entries) || !Array.isArray(registry.history)) throw new TypeError('Invalid registry');
  const entry = registry.entries.find(item => item.id === id);
  if (!entry) throw new Error(`Unknown skill id: ${id}`);
  const runs = runsFor(registry.history, id), rollbacks = rollbacksFor(registry.history, id);
  const checks = { D: gradeD(entry, runs), C: null, B: null, A: null, S: null };
  checks.C = checks.D.met ? gradeC(runs) : { met: false, reason: 'D 단계를 먼저 통과해야 합니다.' };
  checks.B = checks.C.met ? gradeB(runs, rollbacks, leveling) : { met: false, reason: 'C 단계를 먼저 통과해야 합니다.' };
  checks.A = checks.B.met ? gradeA(leveling) : { met: false, reason: 'B 단계를 먼저 통과해야 합니다.' };
  checks.S = checks.A.met ? gradeS(outcomes) : { met: false, reason: 'A 단계를 먼저 통과해야 합니다.' };
  let grade = 'E';
  for (const step of ['D', 'C', 'B', 'A', 'S']) { if (checks[step].met) grade = step; else break; }
  const next = GRADES[GRADES.indexOf(grade) + 1] ?? null;
  return {
    id, grade, nextGrade: next, blockedReason: next ? checks[next].reason : null,
    evidence: { imported: true, activated: !!entry.activeHash, runCount: runs.length, distinctInputCount: new Set(runs.map(run => run.inputSha256)).size, rollbackCount: rollbacks.length },
    checks,
  };
}

export function growthOverview(registry, kind, { outcomesById = {}, levelingById = {} } = {}) {
  if (!object(registry) || !Array.isArray(registry.entries)) throw new TypeError('Invalid registry');
  const skills = registry.entries.map(entry => gradeSkill(registry, entry.id, { outcomes: outcomesById[entry.id] ?? [], leveling: levelingById[entry.id] ?? null }));
  const counts = Object.fromEntries(GRADES.map(grade => [grade, skills.filter(skill => skill.grade === grade).length]));
  return { kind, total: skills.length, counts, skills };
}
