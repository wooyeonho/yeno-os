import test from "node:test";
import assert from "node:assert/strict";
import { activateSkill, addEvidence, approveQuest, assessSkill, completeRun, createInitialState, createQuest, extractSkill, proposeQuests, recoverState, startQuest } from "../src/core.js";

test("seven drives produce traceable quest candidates", () => {
  const state = createInitialState();
  assert.equal(state.drives.length, 7);
  const candidates = proposeQuests({ problem: "반복 보고서 작성 시간을 줄이기", budgetUsd: 0 });
  assert.equal(candidates.length, 7);
  assert.deepEqual(candidates.map((quest) => quest.driveId), ["greed", "gluttony", "envy", "pride", "lust", "wrath", "sloth"]);
  assert.ok(candidates.every((quest) => quest.successCriteria.length > 0 && quest.evidencePlan.length > 0));
});

test("approval and hard gates prevent unapproved execution", () => {
  const state = createInitialState();
  const quest = createQuest({
    title: "검증 퀘스트",
    objective: "승인 전 실행이 막히는지 확인",
    successCriteria: ["결과가 기록됨"],
    evidencePlan: ["실행 로그"],
    requiredPermissions: ["read_workspace"],
  });
  state.quests.push(quest);
  assert.throws(() => startQuest(state, quest.id), { code: "APPROVAL_REQUIRED" });
  approveQuest(state, quest.id, "연호님");
  const run = startQuest(state, quest.id);
  assert.equal(run.status, "running");
});

test("completed work can become a verified and activated skill", () => {
  const state = createInitialState();
  const quest = createQuest({
    title: "스킬 추출 시험",
    objective: "업무 A를 완료하고 재사용 가능한 절차를 만든다",
    successCriteria: ["산출물이 생성됨"],
    evidencePlan: ["산출물", "독립 검토"],
    requiredPermissions: ["read_workspace"],
  });
  state.quests.push(quest);
  approveQuest(state, quest.id, "연호님");
  const run = startQuest(state, quest.id);
  addEvidence(state, run.id, { summary: "검수자가 산출물과 실행 기록을 확인함", verified: true });
  completeRun(state, run.id, {
    output: "artifacts/work-a.md",
    independent: true,
    qualityScore: 0.92,
    newInput: true,
    regressionPass: true,
    recoveryPass: true,
  });
  const skill = extractSkill(state, run.id, {
    name: "업무 A 문서 검토 절차",
    procedure: ["입력 수집", "규칙 검사", "결과 보고"],
    licenseReviewed: true,
    secretsRemoved: true,
    isolationTestPass: true,
  });
  assert.equal(skill.status, "pending_registration");
  activateSkill(state, skill.id, { approvedBy: "연호님", testsPassed: true });
  assert.equal(skill.status, "limited");
  assert.equal(assessSkill(skill).level, "C");
});

test("recovery marks in-flight runs interrupted without deleting history", () => {
  const state = createInitialState();
  const quest = createQuest({
    title: "복구 시험",
    objective: "재시작 후 진행 중 작업을 안전하게 복원",
    successCriteria: ["중단 이력이 남음"],
    evidencePlan: ["상태 파일"],
    requiredPermissions: ["read_workspace"],
  });
  state.quests.push(quest);
  approveQuest(state, quest.id, "연호님");
  const run = startQuest(state, quest.id);
  const recovered = recoverState(state);
  assert.deepEqual(recovered.interruptedRunIds, [run.id]);
  assert.equal(recovered.state.runs[0].status, "interrupted");
  assert.equal(recovered.state.quests[0].status, "interrupted");
});
