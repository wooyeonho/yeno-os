import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  ProjectError, MAX_MILESTONES, validateMilestone, validateMilestones,
  milestoneProgress, addMilestone, setMilestoneCompletion, removeMilestone,
} from '../lib/projects.mjs';
import { projectUniverseSummary } from '../lib/project-universe.mjs';
import { planQuest } from '../lib/quests.mjs';
import { start } from '../server.mjs';

const at = '2026-09-18T00:00:00.000Z';
const project = () => ({ id: randomUUID(), name: 'P', repositoryUrl: '', summary: '', nextAction: '', status: 'active', version: 1, createdAt: at, updatedAt: at, milestones: [] });

test('milestones are added, toggled, removed and always report honest completed/total counts, never a percentage', () => {
  let p = project();
  assert.deepEqual(milestoneProgress(p), { completed: 0, total: 0 });
  const { project: p1, milestone: m1 } = addMilestone(p, '  첫 마일스톤  ', at);
  assert.equal(m1.text, '첫 마일스톤');
  assert.equal(m1.completed, false);
  assert.equal(m1.completedAt, null);
  assert.equal(p1.version, 2);
  assert.deepEqual(milestoneProgress(p1), { completed: 0, total: 1 });
  validateMilestones(p1.milestones);

  const later = '2026-09-18T01:00:00.000Z';
  const p2 = setMilestoneCompletion(p1, m1.id, true, later);
  assert.equal(p2.milestones[0].completed, true);
  assert.equal(p2.milestones[0].completedAt, later);
  assert.equal(p2.version, 3);
  assert.deepEqual(milestoneProgress(p2), { completed: 1, total: 1 });

  const p3 = setMilestoneCompletion(p2, m1.id, false, later);
  assert.equal(p3.milestones[0].completed, false);
  assert.equal(p3.milestones[0].completedAt, null);

  const p4 = removeMilestone(p3, m1.id, later);
  assert.equal(p4.milestones.length, 0);
  assert.equal(p4.version, 5);
});

test('milestone validation rejects malformed records, wrong field sets, oversized text and inconsistent completion state', () => {
  assert.throws(() => validateMilestone(null), ProjectError);
  assert.throws(() => validateMilestone({ id: randomUUID(), text: 'x', completed: false, createdAt: at }), ProjectError);
  assert.throws(() => validateMilestone({ id: 'not-a-uuid', text: 'x', completed: false, createdAt: at, completedAt: null }), ProjectError);
  assert.throws(() => validateMilestone({ id: randomUUID(), text: '  padded  ', completed: false, createdAt: at, completedAt: null }), ProjectError);
  assert.throws(() => validateMilestone({ id: randomUUID(), text: 'x'.repeat(301), completed: false, createdAt: at, completedAt: null }), ProjectError);
  assert.throws(() => validateMilestone({ id: randomUUID(), text: 'x', completed: true, createdAt: at, completedAt: null }), ProjectError);
  assert.throws(() => validateMilestone({ id: randomUUID(), text: 'x', completed: false, createdAt: at, completedAt: at }), ProjectError);
  assert.throws(() => validateMilestone({ id: randomUUID(), text: 'x', completed: false, createdAt: 'not-iso', completedAt: null }), ProjectError);
});

test('a project cannot exceed the maximum milestone count, and duplicate milestone IDs are rejected', () => {
  let p = project();
  for (let i = 0; i < MAX_MILESTONES; i++) p = addMilestone(p, `milestone ${i}`, at).project;
  assert.equal(p.milestones.length, MAX_MILESTONES);
  assert.throws(() => addMilestone(p, 'one too many', at), ProjectError);
  const dup = p.milestones[0];
  assert.throws(() => validateMilestones([dup, dup]), ProjectError);
});

test('toggling or removing an unknown milestone ID fails without mutating the project', () => {
  const p = addMilestone(project(), 'real one', at).project;
  assert.throws(() => setMilestoneCompletion(p, randomUUID(), true, at), error => error instanceof ProjectError && error.status === 404);
  assert.throws(() => removeMilestone(p, randomUUID(), at), error => error instanceof ProjectError && error.status === 404);
});

test('project universe aggregation reads only existing cross-referenced records, reports honest empty states, and returns null for an unknown project', () => {
  const p = project();
  const state = { projects: [p], quests: [], jobs: [], sources: [], memoryEvents: [], outcomes: [] };
  const empty = projectUniverseSummary(state, p.id);
  assert.deepEqual(empty.milestones, { completed: 0, total: 0 });
  assert.deepEqual(empty.blockers, []);
  assert.deepEqual(empty.dominantDrives, []);
  assert.deepEqual(empty.quests, []);
  assert.deepEqual(empty.sources, []);
  assert.deepEqual(empty.memoryEvents, []);
  assert.deepEqual(empty.jobs, []);
  assert.deepEqual(empty.outcomes, []);
  assert.equal(projectUniverseSummary(state, randomUUID()), null);
});

test('project universe aggregation surfaces real linked quests, jobs, sources, memory events, blockers and dominant drives, and ignores records from other projects', () => {
  const p = project(), other = project();
  const quest1 = planQuest({ goal: '실제 목표 1', drive: 'lust', projectId: p.id }, { quests: [], projects: [p, other] });
  const quest2 = planQuest({ goal: '실제 목표 2', drive: 'lust', projectId: p.id }, { quests: [], projects: [p, other] });
  const foreignQuest = planQuest({ goal: '다른 프로젝트 목표', drive: 'wrath', projectId: other.id }, { quests: [], projects: [p, other] });
  const pausedJob = { id: randomUUID(), title: '봇 작업', type: 'agent', status: 'paused', pauseReason: 'providerMissing', projectId: p.id, questId: quest1.id, updatedAt: at };
  quest1.jobId = pausedJob.id;
  const foreignJob = { id: randomUUID(), title: '다른 프로젝트 작업', type: 'agent', status: 'paused', pauseReason: 'providerMissing', projectId: other.id, updatedAt: at };
  const source = { id: randomUUID(), title: '자료', canonicalUrl: 'https://example.com', projectId: p.id, readingStatus: 'unread', decision: 'pending' };
  const foreignSource = { id: randomUUID(), title: '다른 자료', canonicalUrl: 'https://example.com/x', projectId: other.id, readingStatus: 'unread', decision: 'pending' };
  const memoryEvent = { id: randomUUID(), type: 'episode', text: '기억', confidence: 0.5, projectId: p.id, createdAt: at };
  const foreignMemoryEvent = { id: randomUUID(), type: 'episode', text: '다른 기억', confidence: 0.5, projectId: other.id, createdAt: at };
  const outcome = { id: randomUUID(), questId: quest1.id, ledger: 'wealth', summary: '성과', value: null, unit: null, createdAt: at };

  const state = {
    projects: [p, other], quests: [quest1, quest2, foreignQuest],
    jobs: [pausedJob, foreignJob], sources: [source, foreignSource],
    memoryEvents: [memoryEvent, foreignMemoryEvent], outcomes: [outcome],
  };

  const summary = projectUniverseSummary(state, p.id);
  assert.deepEqual(summary.quests.map(q => q.id).sort(), [quest1.id, quest2.id].sort());
  assert.equal(summary.jobs.length, 1);
  assert.equal(summary.jobs[0].id, pausedJob.id);
  assert.equal(summary.sources.length, 1);
  assert.equal(summary.sources[0].id, source.id);
  assert.equal(summary.memoryEvents.length, 1);
  assert.equal(summary.memoryEvents[0].id, memoryEvent.id);
  assert.equal(summary.outcomes.length, 1);
  assert.equal(summary.outcomes[0].id, outcome.id);
  assert.equal(summary.blockers.length, 1);
  assert.equal(summary.blockers[0].jobId, pausedJob.id);
  assert.equal(summary.blockers[0].questId, quest1.id);
  assert.equal(summary.blockers[0].reason, 'providerMissing');
  assert.deepEqual(summary.dominantDrives, [{ driveId: 'lust', questCount: 2, worldName: '창조', worldNameEn: 'Creation' }]);
  assert.equal(summary.counts.quests, 2);
  assert.equal(summary.counts.blockers, 1);
});

async function runtimeFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yeno-universe-'));
  const token = 'synthetic-universe-owner';
  let runtime = await start({ dataDir: dir, host: '127.0.0.1', port: 0, token });
  t.after(() => { runtime.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); });
  async function request(route, body) {
    const r = await fetch(`http://127.0.0.1:${runtime.server.address().port}${route}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify({ requestId: randomUUID(), ...body }) } : {}),
    });
    return { status: r.status, body: await r.json() };
  }
  return { dir, request, restart: async () => { runtime.shutdown(); runtime = await start({ dataDir: dir, host: '127.0.0.1', port: 0, token }); } };
}

test('milestone routes require the matching revision, reject unknown fields/actions, and survive a restart', async t => {
  const f = await runtimeFixture(t);
  const created = await f.request('/api/projects', { name: '실제 프로젝트' });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.project.milestones, []);
  const id = created.body.project.id;

  const staleRevision = await f.request(`/api/projects/${id}/milestones`, { revision: 99, text: '마일스톤' });
  assert.equal(staleRevision.status, 409);

  const unknownField = await f.request(`/api/projects/${id}/milestones`, { revision: 1, text: '마일스톤', extra: true });
  assert.equal(unknownField.status, 400);

  const added = await f.request(`/api/projects/${id}/milestones`, { revision: 1, text: '마일스톤' });
  assert.equal(added.status, 201);
  assert.equal(added.body.milestone.completed, false);
  assert.equal(added.body.project.version, 2);
  const milestoneId = added.body.milestone.id;

  const unknownAction = await f.request(`/api/projects/${id}/milestones/${milestoneId}`, { revision: 2, action: 'delete' });
  assert.equal(unknownAction.status, 400);

  const toggled = await f.request(`/api/projects/${id}/milestones/${milestoneId}`, { revision: 2, action: 'toggle', completed: true });
  assert.equal(toggled.status, 200);
  assert.equal(toggled.body.project.milestones[0].completed, true);

  await f.restart();
  const afterRestart = await f.request('/api/projects');
  assert.equal(afterRestart.body.projects[0].milestones[0].completed, true);

  const removed = await f.request(`/api/projects/${id}/milestones/${milestoneId}`, { revision: 3, action: 'remove' });
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body.project.milestones, []);
});

test('the universe route returns a real aggregation for an existing project and 404 for an unknown one', async t => {
  const f = await runtimeFixture(t);
  const created = await f.request('/api/projects', { name: '실제 프로젝트 2' });
  const id = created.body.project.id;

  const universe = await f.request(`/api/projects/${id}/universe`);
  assert.equal(universe.status, 200);
  assert.equal(universe.body.projectId, id);
  assert.deepEqual(universe.body.milestones, { completed: 0, total: 0 });
  assert.deepEqual(universe.body.blockers, []);

  const missing = await f.request(`/api/projects/${randomUUID()}/universe`);
  assert.equal(missing.status, 404);
});
