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
// by GET /api/projects/:id/universe (dominant drive + its quest goal) and
// the project's own stored nextAction. Returns null (rendered as "판단 근거
// 부족" by project-universe-view.mjs) when neither exists - never a
// generated justification.
export function projectReasonSentence(project, universe) {
  const topDrive = (universe.dominantDrives || [])[0];
  const topQuest = (universe.quests || [])[0];
  if (topDrive && topQuest) {
    return `${topDrive.worldName} 욕망과 관련된 목표 "${topQuest.goal}"를 진행 중입니다.${project.nextAction ? ` 다음 작업: ${project.nextAction}` : ''}`;
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
    reason: projectReasonSentence(project, universe),
  };
}
