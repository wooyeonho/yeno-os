import { randomUUID } from "node:crypto";

export const SYSTEM_VERSION = "0.1.0";

export const DRIVE_DEFINITIONS = Object.freeze([
  {
    id: "greed",
    ko: "강욕",
    en: "Greed",
    question: "연호님에게 남는 돈·소유 자산·기회를 어떻게 늘릴까?",
    actions: ["유료 문제 발견", "가격 가설", "판매 실험", "비용 개선", "소유권 정리"],
    evidence: ["환불·원가 반영 순수익", "재구매", "확인된 소유권 자산"],
    forbiddenRewards: ["매출 추정치 부풀리기", "무단 결제·투자", "과도한 위험"],
  },
  {
    id: "gluttony",
    ko: "폭식",
    en: "Gluttony",
    question: "이번 목표에 필요한 어떤 능력이 부족할까?",
    actions: ["기능 요구 생성", "자료·도구 후보 탐색", "흡수 요청"],
    evidence: ["이전에는 못 하던 실제 작업의 완료"],
    forbiddenRewards: ["다운로드·도구·스크랩 개수 자체"],
  },
  {
    id: "envy",
    ko: "질투",
    en: "Envy",
    question: "경쟁 대안의 어떤 강점을 아직 못 따라가나?",
    actions: ["합법적 경쟁 비교", "품질 격차 분석", "대체 구현"],
    evidence: ["같은 조건의 독립 평가에서 확인한 개선"],
    forbiddenRewards: ["무단 복제", "사칭", "비공개 정보 탈취", "비교 조건 조작"],
  },
  {
    id: "pride",
    ko: "오만",
    en: "Pride",
    question: "최고라는 평가를 무엇으로 증명할까?",
    actions: ["품질 기준 설정", "재현 가능한 사례", "연구·공개 기여"],
    evidence: ["외부 채택·인용·추천", "고객 확인 성과", "오류 정정 이력"],
    forbiddenRewards: ["자칭 세계 1위", "허위 경력·수상·후기"],
  },
  {
    id: "lust",
    ko: "색욕",
    en: "Lust",
    question: "사람들이 이 제품과 브랜드를 진심으로 원하게 하려면?",
    actions: ["사용 경험 개선", "메시지 검증", "신뢰 관계·팬층 형성"],
    evidence: ["자발적 선택", "만족", "재방문", "동의한 구독·추천"],
    forbiddenRewards: ["취약성 악용", "기만적 유도", "중독을 노린 최적화"],
  },
  {
    id: "wrath",
    ko: "분노",
    en: "Wrath",
    question: "고객의 문제와 반복 실패를 무엇부터 없앨까?",
    actions: ["불편·불량 탐지", "원인 분석", "허용 범위 수정·복구"],
    evidence: ["오류·불만·복구 시간 감소", "장애 재발 방지"],
    forbiddenRewards: ["타인 공격·보복·비방", "장애 은폐"],
  },
  {
    id: "sloth",
    ko: "나태",
    en: "Sloth",
    question: "같은 성과를 내면서 연호님의 개입을 얼마나 줄일까?",
    actions: ["반복 업무 자동화", "템플릿·성공 절차 재사용", "승인 묶음"],
    evidence: ["같은 품질에서 줄어든 실제 개입 시간·수작업"],
    forbiddenRewards: ["일 생략", "미완료를 완료 처리"],
  },
]);

export const QUEST_STATUSES = Object.freeze([
  "proposed",
  "pending_approval",
  "approved",
  "running",
  "completed",
  "failed",
  "stopped",
  "interrupted",
]);

export const RUN_STATUSES = Object.freeze([
  "running",
  "completed",
  "failed",
  "stopped",
  "interrupted",
]);

export const SKILL_STATUSES = Object.freeze([
  "discovered",
  "rights_review",
  "isolated",
  "testing",
  "independent_verification",
  "pending_registration",
  "limited",
  "active",
  "disabled",
]);

export const SKILL_LEVELS = Object.freeze(["E", "D", "C", "B", "A", "S"]);

const clone = (value) => JSON.parse(JSON.stringify(value));
const asArray = (value) => (Array.isArray(value) ? value : []);
const asFiniteNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

export function nowIso() {
  return new Date().toISOString();
}

export function createInitialState() {
  const timestamp = nowIso();
  return {
    schemaVersion: 1,
    system: {
      name: "Black Hole",
      version: SYSTEM_VERSION,
      mode: "OFFLINE_FIRST",
      owner: "연호님",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    drives: clone(DRIVE_DEFINITIONS),
    quests: [],
    runs: [],
    evidence: [],
    skills: [],
    projects: [],
    providerChecks: [],
    ledgers: {
      wealth: [],
      honor: [],
      fame: [],
    },
    approvals: [],
    runtime: {
      stopRequested: false,
      lastRecoveryAt: null,
      recoveredRuns: [],
    },
    metrics: {
      completedQuests: 0,
      verifiedSkills: 0,
      activeSkills: 0,
      totalCostUsd: 0,
      interventionMinutes: 0,
      verifiedExternalOutcomes: 0,
    },
  };
}

export function normalizeState(input) {
  const base = createInitialState();
  const source = input && typeof input === "object" ? input : {};
  const state = {
    ...base,
    ...source,
    system: { ...base.system, ...(source.system || {}) },
    runtime: { ...base.runtime, ...(source.runtime || {}) },
    metrics: { ...base.metrics, ...(source.metrics || {}) },
    ledgers: { ...base.ledgers, ...(source.ledgers || {}) },
  };
  for (const key of ["drives", "quests", "runs", "evidence", "skills", "projects", "providerChecks", "approvals"]) {
    state[key] = asArray(state[key]);
  }
  for (const key of ["wealth", "honor", "fame"]) {
    state.ledgers[key] = asArray(state.ledgers[key]);
  }
  return state;
}

export function recoverState(input) {
  const state = normalizeState(input);
  const interrupted = [];
  for (const run of state.runs) {
    if (run.status === "running") {
      run.status = "interrupted";
      run.recoveryAction = "resume_or_rollback";
      run.interruptedAt = nowIso();
      interrupted.push(run.id);
      const quest = state.quests.find((candidate) => candidate.id === run.questId);
      if (quest && quest.status === "running") {
        quest.status = "interrupted";
      }
    }
  }
  state.runtime.lastRecoveryAt = nowIso();
  state.runtime.recoveredRuns = interrupted;
  state.system.updatedAt = nowIso();
  return { state, interruptedRunIds: interrupted };
}

export function getDrive(driveId) {
  return DRIVE_DEFINITIONS.find((drive) => drive.id === driveId) || null;
}

export function validateQuest(input) {
  const errors = [];
  if (!input || typeof input !== "object") {
    return ["quest must be an object"];
  }
  if (!String(input.title || "").trim()) errors.push("title is required");
  if (!String(input.objective || "").trim()) errors.push("objective is required");
  if (!asArray(input.successCriteria).length) errors.push("successCriteria must contain at least one item");
  const cost = asFiniteNumber(input.maxCostUsd, Number.NaN);
  if (!Number.isFinite(cost) || cost < 0) errors.push("maxCostUsd must be a non-negative number");
  const duration = asFiniteNumber(input.maxDurationMinutes, Number.NaN);
  if (!Number.isFinite(duration) || duration <= 0) errors.push("maxDurationMinutes must be greater than zero");
  if (!asArray(input.requiredPermissions).length) errors.push("requiredPermissions must contain at least one permission");
  if (!asArray(input.evidencePlan).length) errors.push("evidencePlan must contain at least one item");
  if (input.driveId && !getDrive(input.driveId)) errors.push(`unknown driveId: ${input.driveId}`);
  if (input.riskLevel && !["low", "medium", "high", "blocked"].includes(input.riskLevel)) {
    errors.push("riskLevel must be low, medium, high, or blocked");
  }
  return errors;
}

export function createQuest(input = {}) {
  const quest = {
    id: input.id || `quest_${randomUUID()}`,
    title: String(input.title || "").trim(),
    objective: String(input.objective || "").trim(),
    driveId: input.driveId || null,
    type: input.type || "hypothesis_validation",
    source: input.source || "user_or_system_signal",
    evidenceBasis: asArray(input.evidenceBasis),
    successCriteria: asArray(input.successCriteria).map(String),
    evidencePlan: asArray(input.evidencePlan).map(String),
    maxCostUsd: asFiniteNumber(input.maxCostUsd, 0),
    maxDurationMinutes: asFiniteNumber(input.maxDurationMinutes, 60),
    requiredPermissions: asArray(input.requiredPermissions).map(String),
    riskLevel: input.riskLevel || "low",
    externalSideEffects: Boolean(input.externalSideEffects),
    sensitiveData: Boolean(input.sensitiveData),
    dangerousAutonomy: Boolean(input.dangerousAutonomy),
    approvalStatus: input.approvalStatus || "pending",
    approvedBy: input.approvedBy || null,
    status: input.status || "pending_approval",
    createdAt: input.createdAt || nowIso(),
    updatedAt: nowIso(),
  };
  const errors = validateQuest(quest);
  if (errors.length) {
    const error = new Error(`Invalid quest: ${errors.join("; ")}`);
    error.code = "INVALID_QUEST";
    error.details = errors;
    throw error;
  }
  return quest;
}

export function proposeQuests({ problem, evidence = [], budgetUsd = 0, durationMinutes = 60, permissions = ["read_workspace"] } = {}) {
  const normalizedProblem = String(problem || "").trim();
  if (!normalizedProblem) throw new Error("problem is required");
  const evidenceBasis = asArray(evidence).map(String);
  const base = {
    problem: normalizedProblem,
    evidenceBasis,
    budgetUsd: Math.max(0, asFiniteNumber(budgetUsd, 0)),
    durationMinutes: Math.max(1, asFiniteNumber(durationMinutes, 60)),
    permissions: asArray(permissions).map(String),
  };
  return DRIVE_DEFINITIONS.map((drive, index) => createQuest({
    title: `${drive.ko} 후보: ${normalizedProblem}`,
    objective: `${drive.question} 대상 문제: ${normalizedProblem}`,
    driveId: drive.id,
    type: "hypothesis_validation",
    source: "seven_drive_signal",
    evidenceBasis,
    successCriteria: [
      "검증 질문과 기준값이 기록된다",
      "허용 범위 안에서 결과 산출물이 생성된다",
      `${drive.evidence[0]}에 해당하는 증거를 확인하거나 가설을 기각한다`,
    ],
    evidencePlan: ["입력·산출물 경로", "실행·비용 기록", "독립 검토 결과", "실패·중단 사유"],
    maxCostUsd: base.budgetUsd,
    maxDurationMinutes: base.durationMinutes,
    requiredPermissions: base.permissions,
    riskLevel: index === 0 ? "medium" : "low",
    externalSideEffects: false,
    approvalStatus: "pending",
    status: "proposed",
  }));
}

export function scoreQuest(quest, context = {}) {
  const evidenceStrength = Math.min(1, Math.max(0, asFiniteNumber(context.evidenceStrength, quest.evidenceBasis.length ? 0.5 : 0.1)));
  const expectedValue = Math.min(1, Math.max(0, asFiniteNumber(context.expectedValue, 0.4)));
  const reusability = Math.min(1, Math.max(0, asFiniteNumber(context.reusability, 0.4)));
  const assetFormation = Math.min(1, Math.max(0, asFiniteNumber(context.assetFormation, 0.4)));
  const interventionReduction = Math.min(1, Math.max(0, asFiniteNumber(context.interventionReduction, 0.2)));
  const userDirected = context.userDirected ? 1 : 0;
  const costPenalty = Math.min(1, Math.max(0, asFiniteNumber(quest.maxCostUsd, 0) / Math.max(1, asFiniteNumber(context.budgetCeilingUsd, 10))));
  const riskPenalty = quest.riskLevel === "high" ? 0.25 : quest.riskLevel === "medium" ? 0.1 : quest.riskLevel === "blocked" ? 1 : 0;
  const rankScore = Number((
    userDirected * 0.2 +
    evidenceStrength * 0.18 +
    expectedValue * 0.18 +
    reusability * 0.14 +
    assetFormation * 0.14 +
    interventionReduction * 0.08 -
    costPenalty * 0.04 -
    riskPenalty * 0.04
  ).toFixed(4));
  return { ...quest, rankScore, scoreInputs: { userDirected, evidenceStrength, expectedValue, reusability, assetFormation, interventionReduction, costPenalty, riskPenalty } };
}

export function rankQuestCandidates(quests, context = {}) {
  return asArray(quests)
    .map((quest) => scoreQuest(quest, context))
    .sort((a, b) => b.rankScore - a.rankScore);
}

export function gateQuest(quest, context = {}) {
  const failures = [];
  const warnings = [];
  const budgetAvailableUsd = asFiniteNumber(context.budgetAvailableUsd, Number.POSITIVE_INFINITY);
  if (quest.riskLevel === "blocked" || quest.dangerousAutonomy) failures.push({ gate: "safety", reason: "blocked risk or dangerous autonomy" });
  if (quest.sensitiveData && !asArray(quest.requiredPermissions).includes("sensitive_data_explicit")) {
    failures.push({ gate: "authority", reason: "sensitive data requires explicit permission" });
  }
  if (quest.externalSideEffects && quest.approvalStatus !== "approved") {
    failures.push({ gate: "authority", reason: "external side effects require explicit approval" });
  }
  if (quest.maxCostUsd > budgetAvailableUsd) failures.push({ gate: "budget", reason: `maxCostUsd ${quest.maxCostUsd} exceeds available ${budgetAvailableUsd}` });
  if (!asArray(quest.successCriteria).length || !asArray(quest.evidencePlan).length) failures.push({ gate: "truthfulness", reason: "success criteria and evidence plan are required" });
  if (!quest.externalSideEffects && quest.approvalStatus !== "approved") warnings.push("read-only or local quest still requires approval before starting");
  return {
    allowed: failures.length === 0 && quest.approvalStatus === "approved",
    requiresApproval: failures.length === 0 && quest.approvalStatus !== "approved",
    failures,
    warnings,
  };
}

export function approveQuest(state, questId, approvedBy = "user") {
  const quest = state.quests.find((candidate) => candidate.id === questId);
  if (!quest) throw new Error(`Quest not found: ${questId}`);
  quest.approvalStatus = "approved";
  quest.approvedBy = approvedBy;
  quest.status = "approved";
  quest.updatedAt = nowIso();
  state.approvals.push({ id: `approval_${randomUUID()}`, targetType: "quest", targetId: quest.id, approvedBy, createdAt: nowIso() });
  return quest;
}

export function startQuest(state, questId, context = {}) {
  const quest = state.quests.find((candidate) => candidate.id === questId);
  if (!quest) throw new Error(`Quest not found: ${questId}`);
  const activeRuns = state.runs.filter((run) => run.status === "running").length;
  const maxConcurrentRuns = asFiniteNumber(context.maxConcurrentRuns, 1);
  if (activeRuns >= maxConcurrentRuns) throw new Error(`Concurrent run limit reached: ${maxConcurrentRuns}`);
  const gate = gateQuest(quest, context);
  if (!gate.allowed) {
    const error = new Error(gate.requiresApproval ? "Quest requires approval" : `Quest blocked: ${gate.failures.map((item) => item.reason).join(", ")}`);
    error.code = gate.requiresApproval ? "APPROVAL_REQUIRED" : "QUEST_BLOCKED";
    error.gate = gate;
    throw error;
  }
  if (state.runtime.stopRequested) throw new Error("Global stop requested");
  const run = {
    id: `run_${randomUUID()}`,
    questId: quest.id,
    status: "running",
    startedAt: nowIso(),
    toolCalls: [],
    evidenceIds: [],
    costUsd: 0,
    interventionMinutes: 0,
  };
  quest.status = "running";
  quest.updatedAt = nowIso();
  state.runs.push(run);
  return run;
}

export function retryRun(state, runId, context = {}) {
  const previous = state.runs.find((candidate) => candidate.id === runId);
  if (!previous) throw new Error(`Run not found: ${runId}`);
  if (!["interrupted", "stopped", "failed"].includes(previous.status)) {
    throw new Error(`Only interrupted, stopped, or failed runs can be retried: ${previous.status}`);
  }
  const quest = state.quests.find((candidate) => candidate.id === previous.questId);
  if (!quest) throw new Error(`Parent quest not found: ${previous.questId}`);
  quest.status = "approved";
  previous.retriedAt = nowIso();
  const run = startQuest(state, quest.id, context);
  run.retryOf = previous.id;
  return run;
}

export function requestStop(state, targetId = null) {
  state.runtime.stopRequested = true;
  const affected = [];
  for (const run of state.runs) {
    if (run.status === "running" && (!targetId || run.id === targetId)) {
      run.stopRequestedAt = nowIso();
      affected.push(run.id);
    }
  }
  return affected;
}

export function clearStop(state) {
  state.runtime.stopRequested = false;
  return state.runtime.stopRequested;
}

export function addEvidence(state, runId, input = {}) {
  const run = state.runs.find((candidate) => candidate.id === runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  const item = {
    id: input.id || `evidence_${randomUUID()}`,
    runId,
    kind: input.kind || "execution",
    summary: String(input.summary || "").trim(),
    artifactPath: input.artifactPath || null,
    artifactHash: input.artifactHash || null,
    toolCallId: input.toolCallId || null,
    source: input.source || "local_execution",
    verified: Boolean(input.verified),
    createdAt: nowIso(),
  };
  if (!item.summary) throw new Error("evidence summary is required");
  state.evidence.push(item);
  run.evidenceIds.push(item.id);
  if (item.toolCallId) run.toolCalls.push(item.toolCallId);
  return item;
}

export function completeRun(state, runId, result = {}) {
  const run = state.runs.find((candidate) => candidate.id === runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  if (run.status !== "running") throw new Error(`Run is not running: ${run.status}`);
  const quest = state.quests.find((candidate) => candidate.id === run.questId);
  if (!quest) throw new Error(`Parent quest not found: ${run.questId}`);
  if (state.runtime.stopRequested || run.stopRequestedAt) {
    run.status = "stopped";
    run.finishedAt = nowIso();
    quest.status = "stopped";
    quest.updatedAt = nowIso();
    return run;
  }
  const output = String(result.output || result.artifactPath || "").trim();
  if (!output) throw new Error("completed run requires output or artifactPath");
  const evaluation = {
    independent: Boolean(result.independent),
    qualityScore: Math.min(1, Math.max(0, asFiniteNumber(result.qualityScore, 0))),
    newInput: Boolean(result.newInput),
    regressionPass: Boolean(result.regressionPass),
    recoveryPass: Boolean(result.recoveryPass),
    externalComparisonAdvantage: Boolean(result.externalComparisonAdvantage),
    customerValueVerified: Boolean(result.customerValueVerified),
    notes: String(result.evaluationNotes || "").trim(),
    evaluator: result.evaluator || "independent_check_required",
    evaluatedAt: nowIso(),
  };
  run.status = result.success === false ? "failed" : "completed";
  run.finishedAt = nowIso();
  run.output = output;
  run.evaluation = evaluation;
  run.costUsd = Math.max(0, asFiniteNumber(result.costUsd, 0));
  run.interventionMinutes = Math.max(0, asFiniteNumber(result.interventionMinutes, 0));
  run.failureReason = result.success === false ? String(result.failureReason || "unspecified") : null;
  quest.status = run.status === "completed" ? "completed" : "failed";
  quest.updatedAt = nowIso();
  state.metrics.totalCostUsd = Number((asFiniteNumber(state.metrics.totalCostUsd) + run.costUsd).toFixed(6));
  state.metrics.interventionMinutes += run.interventionMinutes;
  if (run.status === "completed") state.metrics.completedQuests += 1;
  return run;
}

export function extractSkill(state, runId, input = {}) {
  const run = state.runs.find((candidate) => candidate.id === runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  if (run.status !== "completed") throw new Error("Only completed runs can produce a skill candidate");
  if (!run.evaluation?.independent) throw new Error("Independent verification is required before skill extraction");
  if (!String(input.name || "").trim()) throw new Error("skill name is required");
  const skill = {
    id: input.id || `skill_${randomUUID()}`,
    name: String(input.name).trim(),
    description: String(input.description || "").trim(),
    sourceRunId: run.id,
    sourceQuestId: run.questId,
    status: "pending_registration",
    level: "D",
    version: input.version || "0.1.0",
    inputContract: asArray(input.inputContract).map(String),
    outputContract: asArray(input.outputContract).map(String),
    procedure: asArray(input.procedure).map(String),
    dependencies: asArray(input.dependencies).map(String),
    permissions: asArray(input.permissions).map(String),
    scope: String(input.scope || "limited").trim(),
    licenseReviewed: Boolean(input.licenseReviewed),
    secretsRemoved: Boolean(input.secretsRemoved),
    isolationTestPass: Boolean(input.isolationTestPass),
    regressionPasses: run.evaluation.regressionPass ? 1 : 0,
    recoveryPasses: run.evaluation.recoveryPass ? 1 : 0,
    reuseCount: run.evaluation.newInput ? 1 : 0,
    compositionCount: 0,
    repeatRuns: 1,
    qualityScore: run.evaluation.qualityScore,
    customerValueVerified: run.evaluation.customerValueVerified,
    externalComparisonAdvantage: run.evaluation.externalComparisonAdvantage,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  state.skills.push(skill);
  state.metrics.verifiedSkills += 1;
  return skill;
}

export function activateSkill(state, skillId, checks = {}) {
  const skill = state.skills.find((candidate) => candidate.id === skillId);
  if (!skill) throw new Error(`Skill not found: ${skillId}`);
  const failures = [];
  if (!checks.approvedBy) failures.push("approvedBy is required");
  if (!skill.licenseReviewed && !checks.licenseReviewed) failures.push("license review is required");
  if (!skill.secretsRemoved && !checks.secretsRemoved) failures.push("secret removal check is required");
  if (!skill.isolationTestPass && !checks.isolationTestPass) failures.push("isolation test is required");
  if (!checks.testsPassed) failures.push("independent activation tests must pass");
  if (failures.length) {
    const error = new Error(`Skill activation blocked: ${failures.join("; ")}`);
    error.code = "SKILL_ACTIVATION_BLOCKED";
    error.details = failures;
    throw error;
  }
  skill.licenseReviewed = true;
  skill.secretsRemoved = true;
  skill.isolationTestPass = true;
  skill.status = "limited";
  skill.activatedBy = checks.approvedBy;
  skill.activatedAt = nowIso();
  skill.updatedAt = nowIso();
  state.metrics.activeSkills += 1;
  return skill;
}

export function disableSkill(state, skillId, reason = "manual_stop") {
  const skill = state.skills.find((candidate) => candidate.id === skillId);
  if (!skill) throw new Error(`Skill not found: ${skillId}`);
  skill.status = "disabled";
  skill.disabledAt = nowIso();
  skill.disabledReason = reason;
  skill.updatedAt = nowIso();
  if (state.metrics.activeSkills > 0) state.metrics.activeSkills -= 1;
  return skill;
}

export function assessSkill(skill) {
  const evidence = [];
  let level = "E";
  evidence.push("시제품·실행 결과가 존재함");
  if (skill.licenseReviewed && skill.secretsRemoved && skill.isolationTestPass) {
    level = "D";
    evidence.push("권리·비밀·격리 관문 통과");
  }
  if (skill.reuseCount >= 1 && skill.regressionPasses >= 1) {
    level = "C";
    evidence.push("새 입력 재사용 및 회귀 검수");
  }
  if (skill.compositionCount >= 1 && skill.recoveryPasses >= 1) {
    level = "B";
    evidence.push("스킬 조합 및 복구 검수");
  }
  if (skill.repeatRuns >= 3 && skill.qualityScore >= 0.8 && skill.interventionReductionVerified) {
    level = "A";
    evidence.push("반복 운영·품질·개입량 기준 통과");
  }
  if (skill.externalComparisonAdvantage && skill.customerValueVerified) {
    level = "S";
    evidence.push("외부 비교 우세 및 고객 가치 확인");
  }
  return {
    level,
    evidence,
    next: level === "S" ? "유효성·권리·안전 기준을 유지하며 범위만 확대" : `다음 단계 ${SKILL_LEVELS[SKILL_LEVELS.indexOf(level) + 1] || "없음"} 조건을 새 입력으로 검증`,
  };
}

export function addLedgerEntry(state, ledgerName, entry = {}) {
  if (!Object.hasOwn(state.ledgers, ledgerName)) throw new Error(`Unknown ledger: ${ledgerName}`);
  if (!String(entry.summary || "").trim()) throw new Error("ledger summary is required");
  if (!asArray(entry.evidenceIds).length) throw new Error("ledger entries require evidenceIds");
  const missing = asArray(entry.evidenceIds).filter((id) => !state.evidence.some((item) => item.id === id));
  if (missing.length) throw new Error(`Unknown evidence ids: ${missing.join(", ")}`);
  const ledgerEntry = {
    id: entry.id || `ledger_${randomUUID()}`,
    summary: String(entry.summary).trim(),
    value: entry.value ?? null,
    unit: entry.unit || null,
    evidenceIds: asArray(entry.evidenceIds),
    verified: Boolean(entry.verified),
    createdAt: nowIso(),
  };
  state.ledgers[ledgerName].push(ledgerEntry);
  if (ledgerEntry.verified) state.metrics.verifiedExternalOutcomes += 1;
  return ledgerEntry;
}

export function createGoalContract(input = {}) {
  const errors = [];
  if (!String(input.objective || "").trim()) errors.push("objective is required");
  if (!asArray(input.successCriteria).length) errors.push("successCriteria must contain at least one item");
  if (!asArray(input.requiredPermissions).length) errors.push("requiredPermissions must contain at least one permission");
  if (asFiniteNumber(input.maxCostUsd, Number.NaN) < 0 || !Number.isFinite(asFiniteNumber(input.maxCostUsd, Number.NaN))) errors.push("maxCostUsd must be a non-negative number");
  if (asFiniteNumber(input.maxDurationMinutes, Number.NaN) <= 0 || !Number.isFinite(asFiniteNumber(input.maxDurationMinutes, Number.NaN))) errors.push("maxDurationMinutes must be greater than zero");
  if (errors.length) {
    const error = new Error(`Invalid goal contract: ${errors.join("; ")}`);
    error.code = "INVALID_GOAL_CONTRACT";
    error.details = errors;
    throw error;
  }
  return {
    id: input.id || `goal_${randomUUID()}`,
    objective: String(input.objective).trim(),
    successCriteria: asArray(input.successCriteria).map(String),
    evidencePlan: asArray(input.evidencePlan || ["입력", "산출물", "독립 검토", "비용·개입 기록"]).map(String),
    maxCostUsd: asFiniteNumber(input.maxCostUsd, 0),
    maxDurationMinutes: asFiniteNumber(input.maxDurationMinutes, 60),
    requiredPermissions: asArray(input.requiredPermissions).map(String),
    ownerApprovalRequired: input.ownerApprovalRequired !== false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

export function createProject(input = {}) {
  if (!String(input.name || "").trim()) throw new Error("project name is required");
  const goalContract = createGoalContract(input.goalContract || input);
  return {
    id: input.id || `project_${randomUUID()}`,
    name: String(input.name).trim(),
    path: input.path || null,
    source: input.source || "user_registered",
    status: input.status || "discovered",
    goalContract,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

export function recordProviderChecks(state, checks = []) {
  const entries = asArray(checks).map((check) => ({
    providerId: String(check.id || check.providerId || "unknown"),
    status: String(check.status || "unknown"),
    ok: Boolean(check.ok),
    model: check.model || null,
    checkedAt: check.checkedAt || nowIso(),
    error: check.error ? String(check.error).slice(0, 240) : null,
  }));
  state.providerChecks.push(...entries);
  return entries;
}

export function summarizeState(state) {
  const runningRuns = state.runs.filter((run) => run.status === "running");
  const pendingQuests = state.quests.filter((quest) => ["proposed", "pending_approval", "approved", "interrupted"].includes(quest.status));
  const activeSkills = state.skills.filter((skill) => ["limited", "active"].includes(skill.status));
  return {
    system: state.system,
    currentGoal: "연호님의 부·명예·인지도를 높이는 검증 가능한 사업·제품 성과",
    counts: {
      quests: state.quests.length,
      pendingQuests: pendingQuests.length,
      runningRuns: runningRuns.length,
      skills: state.skills.length,
      activeSkills: activeSkills.length,
      evidence: state.evidence.length,
      projects: state.projects.length,
    },
    currentRuns: runningRuns,
    pendingQuests: pendingQuests.slice(0, 10),
    metrics: state.metrics,
    ledgers: {
      wealth: state.ledgers.wealth.length,
      honor: state.ledgers.honor.length,
      fame: state.ledgers.fame.length,
    },
    projects: state.projects.slice(-10),
    providerChecks: state.providerChecks.slice(-10),
    stopRequested: state.runtime.stopRequested,
    lastRecoveryAt: state.runtime.lastRecoveryAt,
  };
}
