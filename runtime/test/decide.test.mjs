import test from 'node:test';
import assert from 'node:assert/strict';
import { decideQuest, questCandidateSignals, isDecideRequest } from '../lib/decide.mjs';

function quest(overrides = {}) {
  return {
    id: overrides.id ?? 'q-' + Math.random().toString(36).slice(2),
    status: 'proposed', goal: '기본 목표', successCriterion: '기본 성공 기준', baseline: '기준값 미측정',
    driveId: 'sloth', drive: 'sloth', maxCalls: 2, jobId: null, ...overrides,
  };
}

test('with no proposed quests, Homunculus decides nothing rather than inventing a goal', () => {
  assert.equal(decideQuest({ quests: [] }, '2026-09-14T00:00:00.000Z'), null);
  assert.equal(decideQuest({ quests: [quest({ status: 'completed' })] }, '2026-09-14T00:00:00.000Z'), null);
});

test('a quest with no baseline and no job yet scores a real verification/asset gap', () => {
  const signals = questCandidateSignals(quest({ baseline: '기준값 미측정', jobId: null, maxCalls: 4 }));
  assert.equal(signals.assetGap, 1);
  assert.equal(signals.verificationGap, 1);
  assert.equal(signals.estimatedCalls, 1);
});

test('a quest with a real baseline and an existing job has a lower gap profile', () => {
  const signals = questCandidateSignals(quest({ baseline: '지난달 방문자 120명', jobId: 'job-1', maxCalls: 1 }));
  assert.equal(signals.assetGap, 0);
  assert.equal(signals.verificationGap, 0);
  assert.equal(signals.estimatedCalls, 0.25);
});

test('decideQuest ranks only proposed quests and names which drives argued for the winner', () => {
  const state = { quests: [
    quest({ id: 'a', goal: '오래된 목표', baseline: '지난 분기 매출 800만원', jobId: 'job-a' }),
    quest({ id: 'b', goal: '근거 없는 새 목표', baseline: '기준값 미측정', jobId: null, maxCalls: 4 }),
    quest({ id: 'c', goal: '완료된 목표', status: 'completed' }),
  ], jobs: [] };
  const decision = decideQuest(state, '2026-09-14T00:00:00.000Z');
  assert.equal(decision.candidates.length, 2, 'the completed quest is never a candidate');
  assert.equal(decision.top.questId, 'b', 'the quest with the real, larger gap wins');
  assert.ok(decision.top.motivation.dominantDrives.length >= 1);
  assert.equal(decision.top.motivation.goal, '근거 없는 새 목표');
});

test('isDecideRequest recognizes the literal acceptance phrase and stays narrow otherwise', () => {
  assert.equal(isDecideRequest('지금 가장 먼저 해야 할 일을 정해줘'), true);
  assert.equal(isDecideRequest('오늘 날씨 알려줘'), false);
  assert.equal(isDecideRequest(''), false);
  assert.equal(isDecideRequest(undefined), false);
});
