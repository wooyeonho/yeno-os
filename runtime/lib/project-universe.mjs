import { milestoneProgress } from './projects.mjs';
import { publicQuest } from './quests.mjs';
import { driveWorldName, driveWorldNameEn } from './seven-drives.mjs';

// BLACKHOLE Project Universe (Phase C, issue #25) — a pure read-side
// projection over records that already carry projectId (jobs, quests,
// sources, memory events) plus outcomes reached through their quest. No new
// cross-reference storage: every list here is derived by filtering existing
// state, so it can never drift out of sync with the records it reads from.
export const MAX_LINKED_RECORDS = 50;

function linkedQuests(state, projectId) {
  return (state.quests ?? [])
    .filter(quest => quest.projectId === projectId)
    .map(quest => publicQuest(quest, state));
}

function dominantDrives(quests) {
  const counts = new Map();
  for (const quest of quests) {
    if (!quest.driveId) continue;
    counts.set(quest.driveId, (counts.get(quest.driveId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([driveId, questCount]) => ({
      driveId, questCount,
      worldName: driveWorldName(driveId), worldNameEn: driveWorldNameEn(driveId),
    }));
}

// Every blocker here names a real paused job with a real pauseReason already
// set by the scheduler/bot-assignment logic elsewhere — never a fabricated
// or inferred state.
function blockersFor(jobs, quests) {
  return jobs
    .filter(job => job.status === 'paused' && job.pauseReason)
    .map(job => ({
      jobId: job.id, questId: quests.find(quest => quest.jobId === job.id)?.id ?? null,
      title: job.title, reason: job.pauseReason,
    }))
    .slice(0, MAX_LINKED_RECORDS);
}

export function projectUniverseSummary(state, projectId) {
  const project = (state.projects ?? []).find(p => p.id === projectId);
  if (!project) return null;

  const quests = linkedQuests(state, projectId);
  const questIds = new Set(quests.map(quest => quest.id));
  const jobs = (state.jobs ?? []).filter(job => job.projectId === projectId);
  const sources = (state.sources ?? []).filter(source => source.projectId === projectId);
  const memoryEvents = (state.memoryEvents ?? []).filter(event => event.projectId === projectId);
  const outcomes = (state.outcomes ?? []).filter(outcome => questIds.has(outcome.questId));

  return {
    projectId: project.id,
    milestones: milestoneProgress(project),
    blockers: blockersFor(jobs, quests),
    dominantDrives: dominantDrives(quests),
    quests: quests.slice(0, MAX_LINKED_RECORDS).map(quest => ({
      id: quest.id, goal: quest.goal, driveId: quest.driveId,
      status: quest.status, pauseReason: quest.pauseReason,
      resultStatus: quest.resultStatus, createdAt: quest.createdAt, updatedAt: quest.updatedAt,
    })),
    sources: sources.slice(0, MAX_LINKED_RECORDS).map(source => ({
      id: source.id, title: source.title, url: source.canonicalUrl,
      readingStatus: source.readingStatus, decision: source.decision,
    })),
    memoryEvents: memoryEvents.slice(0, MAX_LINKED_RECORDS).map(event => ({
      id: event.id, type: event.type, text: event.text, confidence: event.confidence, createdAt: event.createdAt,
    })),
    jobs: jobs.slice(0, MAX_LINKED_RECORDS).map(job => ({
      id: job.id, title: job.title, type: job.type, status: job.status,
      pauseReason: job.pauseReason ?? null, updatedAt: job.updatedAt,
    })),
    outcomes: outcomes.slice(0, MAX_LINKED_RECORDS).map(outcome => ({
      id: outcome.id, ledger: outcome.ledger, summary: outcome.summary,
      value: outcome.value, unit: outcome.unit, createdAt: outcome.createdAt,
    })),
    counts: {
      quests: quests.length, sources: sources.length, memoryEvents: memoryEvents.length,
      jobs: jobs.length, outcomes: outcomes.length, blockers: jobs.filter(job => job.status === 'paused' && job.pauseReason).length,
    },
  };
}
