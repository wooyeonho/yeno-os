// BLACKHOLE Drive Orbit view-model builder (Seven Drives UI, issue #25).
// Pure, host-agnostic - shared unchanged by the web cockpit and the native
// Android controller, exactly like project-universe-model.mjs. It combines
// two ALREADY-REAL sources and never computes a score itself:
//   - GET /api/drives/status (drive-status.mjs): the real quest-ranking
//     engine's per-drive pressure/reason/linkedGoal/linkedProjectId/
//     evidence/trend, honestly null together when nothing has been ranked.
//   - core (the same coreHomeSummary shape living-core-view.mjs already
//     renders): dominantDriveId/dominantDriveWorldName/missionGoal, the
//     real CAUSAL drive of the current live mission.
//
// These two concepts are deliberately kept distinct in the output: a
// drive's `isMissionCausal` flag comes only from core.dominantDriveId,
// never from its own pressure value, so a high-pressure drive can never be
// mistaken for the mission's real causal drive and vice versa.
export function driveOrbitModel(driveStatus, core) {
  const missionCausalDriveId = core?.dominantDriveId ?? null;
  const missionCausalWorldName = core?.dominantDriveWorldName ?? null;
  const drives = (driveStatus?.drives ?? []).map(drive => ({
    driveId: drive.driveId,
    worldName: drive.worldName,
    worldNameEn: drive.worldNameEn,
    pressure: drive.pressure ?? null,
    reason: drive.reason ?? null,
    linkedGoal: drive.linkedGoal ?? null,
    linkedProjectId: drive.linkedProjectId ?? null,
    measuredAt: drive.measuredAt ?? null,
    // Evidence is summarized to a real count only - never the raw
    // {type, id} references themselves, which would leak internal
    // job/quest UUIDs into normal UI.
    evidenceCount: Array.isArray(drive.evidence) ? drive.evidence.length : 0,
    // Always null under the current drive-status.mjs contract (no
    // persisted second measurement exists yet) - carried through as-is
    // rather than re-decided here, so a later real trend needs no view
    // model change.
    trend: drive.trend ?? null,
    isMissionCausal: missionCausalDriveId !== null && drive.driveId === missionCausalDriveId,
  }));
  return {
    measuredAt: driveStatus?.measuredAt ?? null,
    missionCausalDriveId,
    missionCausalWorldName,
    drives,
    explanation: buildExplanation(driveStatus, core),
  };
}

// "왜 BLACKHOLE이 지금 이 목표를 선택했어?" - built only from fields that
// are already real on the two inputs above. Returns null when there is
// truly nothing to say (the view renders the honest "현재 미션의 지배 욕망
// 없음" state), and the one explicit fallback sentence when there is not
// even a ranked candidate to compare against.
function buildExplanation(driveStatus, core) {
  const missionDriveId = core?.dominantDriveId ?? null;
  if (!missionDriveId) {
    if (!driveStatus?.measuredAt) return '현재 비교 가능한 제안 목표가 없어 욕망 평가가 완료되지 않았습니다.';
    return null;
  }
  const entry = (driveStatus?.drives ?? []).find(d => d.driveId === missionDriveId);
  const worldName = core?.dominantDriveWorldName ?? entry?.worldName ?? null;
  if (!worldName) return null;
  const goal = core?.missionGoal ?? entry?.linkedGoal ?? null;
  const reason = entry?.reason ?? null;
  let sentence = `현재 미션은 ${worldName} 욕망이 원인입니다.`;
  if (goal) sentence += ` 목표: "${goal}".`;
  if (reason) sentence += ` ${reason}`;
  return sentence;
}
