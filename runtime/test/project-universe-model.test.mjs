// project-universe-model.mjs's pure view-model builders, shared unchanged
// by both the web cockpit and the native Android controller. Focused on
// projectReasonSentence's evidence-matching contract (PR #27 review, issue
// #25): the drive and the quest it names must be causally the same real
// record, never independently-picked list positions that merely happen to
// coexist.
import test from 'node:test';
import assert from 'node:assert/strict';
import { projectReasonSentence, projectUniverseListModel, projectUniverseDetailModel } from '../public/project-universe-model.mjs';

test('projectReasonSentence never pairs the dominant drive with an unrelated first-listed quest (mixed-drive fixture)', () => {
  const project = { nextAction: '다음 단계' };
  // The FIRST quest in storage order is a Wealth(greed) quest; the
  // dominant drive by count is Creation(lust), carried only by the SECOND
  // quest. A position-based pairing would wrongly attribute the Wealth
  // goal to the Creation drive.
  const universe = {
    dominantDrives: [{ driveId: 'lust', worldName: '창조', worldNameEn: 'Creation', questCount: 1 }],
    quests: [
      { id: 'q-wealth', goal: '부 관련 목표', driveId: 'greed', updatedAt: '2026-09-01T00:00:00.000Z' },
      { id: 'q-creation', goal: '창조 관련 실제 목표', driveId: 'lust', updatedAt: '2026-09-02T00:00:00.000Z' },
    ],
  };
  const sentence = projectReasonSentence(project, universe);
  assert.match(sentence, /창조 욕망과 관련된 목표 "창조 관련 실제 목표"/);
  assert.doesNotMatch(sentence, /부 관련 목표/, 'the unrelated first-listed quest must never be named next to a drive it does not carry');
});

test('projectReasonSentence falls back to nextAction-only, never fabricating a drive+goal pairing, when no quest carries the dominant drive', () => {
  const project = { nextAction: '실제 다음 작업' };
  const universe = {
    dominantDrives: [{ driveId: 'lust', worldName: '창조', worldNameEn: 'Creation', questCount: 1 }],
    quests: [{ id: 'q-1', goal: '전혀 다른 욕망의 목표', driveId: 'wrath', updatedAt: '2026-09-01T00:00:00.000Z' }],
  };
  const sentence = projectReasonSentence(project, universe);
  assert.match(sentence, /실제 다음 작업/);
  assert.doesNotMatch(sentence, /창조/, 'must not name a drive that has no real matching quest');
  assert.doesNotMatch(sentence, /전혀 다른 욕망의 목표/);
});

test('projectReasonSentence picks the most recently updated matching quest when several share the dominant drive', () => {
  const project = { nextAction: null };
  const universe = {
    dominantDrives: [{ driveId: 'pride', worldName: '명예', worldNameEn: 'Honor', questCount: 2 }],
    quests: [
      { id: 'q-old', goal: '오래된 목표', driveId: 'pride', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'q-new', goal: '최신 실제 목표', driveId: 'pride', updatedAt: '2026-09-01T00:00:00.000Z' },
    ],
  };
  const sentence = projectReasonSentence(project, universe);
  assert.match(sentence, /최신 실제 목표/);
  assert.doesNotMatch(sentence, /오래된 목표/);
});

test('projectReasonSentence returns null (rendered as 판단 근거 부족) with no dominant drive and no next action', () => {
  assert.equal(projectReasonSentence({ nextAction: null }, { dominantDrives: [], quests: [] }), null);
});

test('projectUniverseListModel derives honest completed/total milestone counts and real blocker/active-work flags from bulk-loaded jobs, no extra per-card fetch', () => {
  const projects = [
    { id: 'p-1', name: 'A', status: 'active', milestones: [{ completed: true }, { completed: false }], nextAction: '다음' },
    { id: 'p-2', name: 'B', status: 'archived', milestones: [] },
  ];
  const jobs = [
    { id: 'j-1', projectId: 'p-1', status: 'paused', pauseReason: 'providerMissing' },
    { id: 'j-2', projectId: 'p-1', status: 'running' },
  ];
  const model = projectUniverseListModel(projects, jobs);
  assert.equal(model.projects.length, 1, 'archived projects are excluded from the live list');
  assert.deepEqual(model.projects[0].milestones, { completed: 1, total: 2 });
  assert.equal(model.projects[0].hasBlocker, true);
  assert.equal(model.projects[0].hasActiveWork, true);
});

test('projectUniverseDetailModel carries through real milestone items from the project record, honest counts from the universe aggregation', () => {
  const project = { id: 'p-1', name: 'P', status: 'active', summary: 'S', nextAction: 'N', milestones: [{ id: 'm-1', text: 'x', completed: true }] };
  const universe = { milestones: { completed: 1, total: 1 }, quests: [], jobs: [], sources: [], memoryEvents: [], outcomes: [], blockers: [], dominantDrives: [] };
  const detail = projectUniverseDetailModel(project, universe);
  assert.equal(detail.projectId, 'p-1');
  assert.deepEqual(detail.milestones, { completed: 1, total: 1, items: project.milestones });
  assert.match(detail.reason, /N/, 'with no linked quests, the reason still honestly falls back to the real nextAction');
});
