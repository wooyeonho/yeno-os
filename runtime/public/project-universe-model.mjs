// BLACKHOLE Project Universe view-model builders (UI Slice 2, issue #25).
// Pure, host-agnostic functions shared by both the web cockpit (app.js) and
// the native Android controller (apps/controller/src/native-projects.ts) -
// exactly the "one shared implementation" the mission requires, just like
// project-universe-view.mjs itself. Neither host may keep its own divergent
// copy of this logic.
export function projectUniverseListModel(projects, jobs) {
  const list = projects || [], allJobs = jobs || [];
  return {
    screen: 'list', notice: null, loading: false,
    projects: list.filter(p => p.status !== 'archived').map(p => ({
      id: p.id, name: p.name, status: p.status,
      milestones: {completed: (p.milestones || []).filter(m => m.completed).length, total: (p.milestones || []).length},
      nextAction: p.nextAction || null,
      hasBlocker: allJobs.some(j => j.projectId === p.id && j.status === 'paused' && j.pauseReason),
      hasActiveWork: allJobs.some(j => j.projectId === p.id && ['queued', 'running'].includes(j.status)),
    })),
  };
}

// "왜 이 프로젝트인가?" - built only from real evidence already aggregated
// by GET /api/projects/:id/universe (dominant drive + a real quest that
// actually carries that same drive) and the project's own stored
// nextAction. Returns null (rendered as "판단 근거 부족" by
// project-universe-view.mjs) when neither exists - never a generated
// justification.
//
// topDrive and topQuest must be causally linked: dominantDrives[0] is the
// drive with the most linked quests, but quests[0] is merely first in
// storage order and can easily belong to a different drive. Pairing them
// independently could state a drive next to a goal that has nothing to do
// with it - a fabricated-sounding rationale. So the quest is selected BY
// the chosen drive's id, never by list position.
export function projectReasonSentence(project, universe) {
  const topDrive = (universe.dominantDrives || [])[0];
  if (topDrive) {
    const matching = (universe.quests || []).filter(quest => quest.driveId === topDrive.driveId);
    // Array.prototype.sort is stable, so ties keep their original (already
    // deterministic) relative order - no further tiebreak is needed.
    const topQuest = matching.slice().sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0))[0];
    if (topQuest) return `${topDrive.worldName} 욕망과 관련된 목표 "${topQuest.goal}"를 진행 중입니다.${project.nextAction ? ` 다음 작업: ${project.nextAction}` : ''}`;
  }
  if (project.nextAction) return `다음 작업으로 "${project.nextAction}"을(를) 진행할 예정입니다.`;
  return null;
}

export function projectUniverseDetailModel(project, universe) {
  return {
    projectId: project.id, name: project.name, status: project.status,
    summary: project.summary || null, nextAction: project.nextAction || null,
    milestones: {completed: universe.milestones.completed, total: universe.milestones.total, items: project.milestones || []},
    quests: universe.quests, jobs: universe.jobs, sources: universe.sources, memoryEvents: universe.memoryEvents,
    outcomes: universe.outcomes, blockers: universe.blockers, dominantDrives: universe.dominantDrives,
    // Shadow Army is a read-only projection of real durable jobs. Keep the
    // field present even when empty so both web and Android render the same
    // honest empty state without inventing worker activity.
    shadowMissions: universe.shadowMissions ?? [],
    reason: projectReasonSentence(project, universe),
  };
}
