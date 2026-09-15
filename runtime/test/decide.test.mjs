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

test('isDecideRequest also recognizes natural conversational phrasing, not just imperative commands', () => {
  assert.equal(isDecideRequest('오늘 뭐부터 하면 돼?'), true, '"what should I start with" question form');
  assert.equal(isDecideRequest('네가 봤을 때 지금 제일 중요한 게 뭐야?'), true, 'a judgment question, no 정해/골라 verb at all');
  assert.equal(isDecideRequest('알아서 우선순위 잡아봐'), true, 'delegating the decision with 알아서');
  assert.equal(isDecideRequest('가장 급한 일이 뭔지 알려줘'), true, 'most-urgent phrasing, not just 중요한');
  assert.equal(isDecideRequest('우선순위 좀 정해줄래?'), true);
});

test('isDecideRequest recognizes the 뭘 contraction ("무엇을"), not just 뭐/무엇', () => {
  assert.equal(isDecideRequest('뭘 먼저 해야 돼?'), true);
  assert.equal(isDecideRequest('뭘 먼저 하면 좋을까?'), true);
  assert.equal(isDecideRequest('오늘 뭘 먼저 하지?'), true, 'a casual self-question form, intentionally supported');
  assert.equal(isDecideRequest('뭘 좋아해?'), false, 'ordinary non-priority use of 뭘 - no 부터/먼저');
  assert.equal(isDecideRequest('뭘 먼저 하지 마세요'), false, '하지 starting a negation ("don\'t"), not the question form - only 하지? counts');
  assert.equal(isDecideRequest('뭘 먹었어?'), false);
});

test('isDecideRequest stays narrow: ordinary conversation using similar words does not trigger it', () => {
  assert.equal(isDecideRequest('저녁 뭐 먹을지 나중에 정해줄게'), false, 'no 부터/먼저 - not a "what first" question');
  assert.equal(isDecideRequest('모델을 호출해'), false);
  assert.equal(isDecideRequest('그 다음은?'), false);
  assert.equal(isDecideRequest('알아서 잘 지내'), false, '알아서 without a decision verb');
});

// An independent review (Devin) caught these two real false-positive classes
// on PR #11: a negated decision verb still matched because "판단" is a bare
// stem embedded in its own negation "판단하지", and the generic-pronoun
// importance form ("...중요한 게 뭐야?") fit any topic, not just work/priority.
test('isDecideRequest does not start a saved quest from a negated decision verb', () => {
  assert.equal(isDecideRequest('알아서 판단하지 마'), false, '"don\'t decide" is the opposite of delegating a decision');
  assert.equal(isDecideRequest('우선순위를 판단하지 마'), false, 'same negation collision on the 우선순위 pattern');
  assert.equal(isDecideRequest('알아서 우선순위 잡아봐'), true, 'the real delegation phrase must keep working');
});

test('isDecideRequest requires real work/priority context for the generic "중요한 게" importance form', () => {
  assert.equal(isDecideRequest('요리에서 가장 중요한 게 뭐야?'), false, 'an ordinary cooking question, not a priority question');
  assert.equal(isDecideRequest('네가 봤을 때 지금 제일 중요한 게 뭐야?'), true, '지금 anchors this to real priority context');
  assert.equal(isDecideRequest('가장 급한 일이 뭔지 알려줘'), true, '일 is already task-specific, no extra anchor needed');
});
