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
const DECIDE_PHRASES = [/가장\s*먼저.*(?:정해|골라|알려)/, /지금\s*(?:뭐|무엇).*(?:할지|해야).*(?:정해|알려)/, /다음\s*(?:할|해야\s*할)\s*일.*(?:정해|골라)/];
export function isDecideRequest(text) {
  return typeof text === 'string' && DECIDE_PHRASES.some(pattern => pattern.test(text));
}
