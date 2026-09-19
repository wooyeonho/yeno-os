import {decideQuest} from './decide.mjs';
import {DRIVE_CANON} from './seven-drives.mjs';

// BLACKHOLE Drive read model (UI Slice 2 / Phase C completion, issue #25).
//
// This is a SAFE PROJECTION, not a second scoring algorithm: every number
// here comes from motivation.mjs's existing rankMotivatedCandidates (via
// decide.mjs's decideQuest, the same real engine the "정해줘" voice command
// already runs), applied to real proposed quests. This module only reads
// that output and reshapes it per-drive - it computes nothing about
// priority itself.
//
// pressure/reason/linkedGoal/linkedProjectId/evidence are all null together
// whenever there are no proposed quests to rank at all (decideQuest returns
// null) - "욕망 평가 전", never a fabricated zero-with-explanation. When
// candidates DO exist, a drive can honestly measure to a real 0 (no
// candidate advances it) - that is still a measurement, not an absence of
// one, and is reported as pressure:0 with a real reason.
//
// trend is always null in this version: no persisted second measurement to
// compare against exists yet, so a delta would be fabricated. A later phase
// may add a durable measurement history and only then compute a real trend.
export function driveStatus(state, at) {
  const decision = decideQuest(state, at);
  const candidates = decision?.candidates ?? [];
  const quests = state.quests ?? [];

  const drives = DRIVE_CANON.map(entry => {
    if (!decision) {
      return {
        driveId: entry.id, worldName: entry.worldName, worldNameEn: entry.worldNameEn,
        pressure: null, reason: null, linkedGoal: null, linkedProjectId: null,
        measuredAt: null, evidence: [], trend: null,
      };
    }
    const measured = candidates.map(candidate => candidate.motivation.components[entry.id]);
    const peak = measured.length ? Math.max(...measured) : 0;
    // A "leader" only counts as real evidence when it actually contributes
    // (peak > 0); at peak 0 every candidate trivially ties, and crediting
    // one of them as this drive's linked goal would misleadingly imply a
    // real contribution that does not exist.
    const leader = peak > 0 ? candidates.find(candidate => candidate.motivation.components[entry.id] === peak) ?? null : null;
    const linkedProjectId = leader ? (quests.find(q => q.id === leader.questId)?.projectId ?? null) : null;
    return {
      driveId: entry.id, worldName: entry.worldName, worldNameEn: entry.worldNameEn,
      pressure: peak,
      reason: leader ? `${leader.goal} · 기여 ${peak}점` : '현재 이 욕망에 기여하는 제안된 목표가 없습니다.',
      linkedGoal: leader?.goal ?? null,
      linkedProjectId,
      measuredAt: at,
      evidence: leader ? [{type: 'quest', id: leader.questId}] : [],
      trend: null,
    };
  });

  return {version: 1, measuredAt: decision ? at : null, drives};
}
