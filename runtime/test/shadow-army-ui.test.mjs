// BLACKHOLE Shadow Army UI Slice 3 (issue #25).
// The shared Project Universe view is mounted by both the web cockpit and
// native Android controller. These tests prove the UI only renders durable
// mission/job evidence and never upgrades a deterministic artifact check into
// semantic quality or external success.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createProjectUniverseView } from '../public/project-universe-view.mjs';
import { projectUniverseDetailModel } from '../public/project-universe-model.mjs';
const { JSDOM } = createRequire(new URL('../../apps/controller/package.json', import.meta.url))('jsdom');

function setup() {
  const dom = new JSDOM('<main></main>');
  const root = dom.window.document.querySelector('main');
  const view = createProjectUniverseView({root});
  return {dom, root, view, close() { view.destroy(); dom.window.close(); }};
}

function detail(overrides = {}) {
  return {
    projectId: 'project-1', name: 'BLACKHOLE', status: 'active', summary: null, nextAction: null,
    milestones: {completed: 0, total: 0, items: []},
    quests: [], jobs: [], sources: [], memoryEvents: [], outcomes: [], blockers: [], dominantDrives: [],
    shadowMissions: [], reason: null, ...overrides,
  };
}

const IDs = {
  mission: '11111111-1111-4111-8111-111111111111',
  scout: '22222222-2222-4222-8222-222222222222',
  verify: '33333333-3333-4333-8333-333333333333',
};

test('an empty Project Universe renders an honest Shadow Army empty state', () => {
  const h = setup();
  h.view.updateState({screen: 'detail', detail: detail()});
  assert.match(h.root.textContent, /Shadow Army/);
  assert.match(h.root.textContent, /현재 배정된 실제 Shadow 임무가 없습니다/);
  assert.doesNotMatch(h.root.textContent, /검증 통과/);
  h.close();
});

test('real Shadow mission state renders roles, evidence counts and deterministic verification without claiming semantic quality', () => {
  const h = setup();
  h.view.updateState({
    screen: 'detail',
    detail: detail({
      shadowMissions: [{
        missionId: IDs.mission, projectId: 'project-1', phase: 'completed',
        shadows: [{
          jobId: IDs.scout, role: 'scout', status: 'completed',
          pauseReason: null, dependsOnJobIds: [], artifacts: [{id: 'artifact-1', name: 'scout.md'}],
          provider: 'openai', model: 'test-model',
        }],
        verify: {
          jobId: IDs.verify, status: 'completed', pauseReason: null,
          result: {verified: true, reasons: [], subjects: [{jobId: IDs.scout, verified: true, reasons: []}]},
        },
      }],
    }),
  });
  const visible = h.root.textContent;
  assert.match(visible, /Shadow 임무 1/);
  assert.match(visible, /Scout · 자료 탐색/);
  assert.match(visible, /완료/);
  assert.match(visible, /산출물 1개/);
  assert.match(visible, /실행 제공자 · openai · test-model/);
  assert.match(visible, /결정론적 검사 통과/);
  assert.match(visible, /내용의 품질이나 외부 성과를 자동 보증하지 않습니다/);
  assert.equal(visible.includes(IDs.mission), false);
  assert.equal(visible.includes(IDs.scout), false);
  assert.equal(visible.includes(IDs.verify), false);
  assert.match(h.root.innerHTML, new RegExp(IDs.mission));
  h.close();
});

test('projectUniverseDetailModel preserves the real shadow mission projection and defaults missing data to an empty array', () => {
  const project = {id: 'project-1', name: 'P', status: 'active', milestones: [], nextAction: null};
  const universe = {
    milestones: {completed: 0, total: 0}, quests: [], jobs: [], sources: [], memoryEvents: [],
    outcomes: [], blockers: [], dominantDrives: [],
    shadowMissions: [{missionId: IDs.mission, phase: 'blocked', shadows: [], verify: null}],
  };
  assert.equal(projectUniverseDetailModel(project, universe).shadowMissions[0].missionId, IDs.mission);
  assert.deepEqual(projectUniverseDetailModel(project, {...universe, shadowMissions: undefined}).shadowMissions, []);
});
