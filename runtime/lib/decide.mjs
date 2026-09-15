import {rankMotivatedCandidates} from './motivation.mjs';

// "지금 가장 먼저 해야 할 일을 정해줘" - Homunculus ranks GOALS THAT ALREADY
// EXIST as proposed quests. It never invents a new goal from nothing: a goal
// only becomes a decidable candidate once the owner (or another part of the
// system) has already written it down via POST /api/quests. This mirrors how
// rankMotivatedCandidates already works for the background autopilot loop -
// the only difference is the candidate set (real proposed quests, not the
// fixed world/research/forai/video/capability kinds).
const NO_BASELINE = '기준값 미측정';

// Signals derived only from fields the quest record already carries and
// quests.mjs already validated - never estimated or invented.
export function questCandidateSignals(quest) {
  return {
    assetGap: quest.jobId ? 0 : 1,
    verificationGap: quest.baseline === NO_BASELINE ? 1 : 0,
    estimatedCalls: Math.max(0, Math.min(1, quest.maxCalls / 4)),
  };
}

// Returns null (not a fabricated pick) when there is nothing to decide among.
export function decideQuest(state, at) {
  const proposed = (state.quests ?? []).filter(quest => quest.status === 'proposed');
  if (!proposed.length) return null;
  const candidates = proposed.map(quest => ({
    action: { kind: 'quest', taskKey: 'quest:' + quest.id },
    goal: quest.goal,
    successCriterion: quest.successCriterion,
    signals: questCandidateSignals(quest),
    questId: quest.id,
  }));
  const ranked = rankMotivatedCandidates(state, candidates, at);
  return { at, top: ranked[0], candidates: ranked };
}

// A small, fixed set of phrases that mean "decide for me," so a spoken
// command can route to the real Homunculus ranking instead of becoming a
// generic free-text model call. Kept narrow and literal on purpose - this is
// a trigger, not a language model, and a false negative (falling back to the
// normal voice path) is always safe.
//
// The first three patterns are explicit imperatives ("정해줘"/"골라줘"/"알려줘"
// aimed at a named target like "가장 먼저 할 일" or "다음 할 일"). The next four
// cover the same request phrased the way an owner actually talks to an
// assistant rather than issuing a command - conversational forms that never
// use "정해"/"골라" at all:
//   - "우선순위" itself named as the thing to decide ("우선순위 좀 잡아줘")
//   - asking what's most important/urgent right now ("네가 봤을 때 지금 제일
//     중요한 게 뭐야?") - a judgment question, not an imperative
//   - "뭐부터/뭘 먼저 ...하면/할까" - asking what to start with
//     ("오늘 뭐부터 하면 돼?")
//   - "알아서" (use your own judgment) paired with a decision verb
//     ("알아서 우선순위 잡아봐")
const DECIDE_PHRASES = [
  /가장\s*먼저.*(?:정해|골라|알려)/,
  /지금\s*(?:뭐|무엇).*(?:할지|해야).*(?:정해|알려)/,
  /다음\s*(?:할|해야\s*할)\s*일.*(?:정해|골라)/,
  /우선순위.*(?:정해|잡아|알려|골라|판단)/,
  /(?:제일|가장)\s*(?:중요한|급한|시급한)(?:\s*(?:게|것|일|목표))?.*(?:뭐|뭔|무엇)/,
  /(?:뭐|무엇)(?:를)?\s*(?:부터|먼저).{0,10}(?:하면|할까|해야|좋을까)/,
  /알아서.*(?:정해|잡아|골라|판단)/,
];
export function isDecideRequest(text) {
  return typeof text === 'string' && DECIDE_PHRASES.some(pattern => pattern.test(text));
}
