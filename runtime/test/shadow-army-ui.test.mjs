// BLACKHOLE Shadow Army UI (R2, BLACKHOLE_CLAUDE_CODE_EXECUTION.md §D).
// The shared Project Universe view is mounted by both the web cockpit and
// native Android controller. These tests prove the UI only renders durable
// mission/job evidence and never upgrades a deterministic artifact check
// into semantic content quality or external success - the two verdicts stay
// on separate lines, exactly as shadow-army.mjs's missionStatus() returns
// them.
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
  semantic: '44444444-4444-4444-8444-444444444444',
};

test('an empty Project Universe renders an honest Shadow Army empty state', () => {
  const h = setup();
  h.view.updateState({screen: 'detail', detail: detail()});
  assert.match(h.root.textContent, /Shadow Army/);
  assert.match(h.root.textContent, /현재 배정된 실제 Shadow 임무가 없습니다/);
  assert.doesNotMatch(h.root.textContent, /검증 통과/);
  h.close();
});

test('a deterministic PASS alone never renders as semantic/content verification - the two verdicts stay on separate lines', () => {
  const h = setup();
  h.view.updateState({
    screen: 'detail',
    detail: detail({
      shadowMissions: [{
        missionId: IDs.mission, projectId: 'project-1', phase: 'semantic_verifying',
        shadows: [{
          jobId: IDs.scout, role: 'scout', status: 'completed',
          pauseReason: null, dependsOnJobIds: [], artifacts: [{id: 'artifact-1', name: 'scout.md'}],
          provider: 'openai', model: 'test-model', failureReason: null,
        }],
        verify: {jobId: IDs.verify, status: 'completed', pauseReason: null, result: {verified: true}, failureReason: null},
        semantic: {jobId: IDs.semantic, status: 'queued', pauseReason: null, verdict: null, independence: null, failureReason: null},
      }],
    }),
  });
  const visible = h.root.textContent;
  assert.match(visible, /Shadow 임무 1/);
  assert.match(visible, /Scout · 자료 탐색/);
  assert.match(visible, /산출물 1개/);
  assert.match(visible, /실행 제공자 · openai · test-model/);
  assert.match(visible, /결정론적 검증 통과/);
  // The content verdict has not completed yet (still queued) - the UI must
  // never claim a content pass just because the deterministic check passed.
  assert.doesNotMatch(visible, /내용 검증 통과/);
  assert.match(visible, /내용 검증\(semantic, 별도 job\/context\)/);
  assert.equal(visible.includes(IDs.mission), false);
  assert.equal(visible.includes(IDs.scout), false);
  assert.match(h.root.innerHTML, new RegExp(IDs.mission));
  h.close();
});

test('a completed semantic PASS renders both verdicts, the independence label, and the summary - never as external success', () => {
  const h = setup();
  h.view.updateState({
    screen: 'detail',
    detail: detail({
      shadowMissions: [{
        missionId: IDs.mission, projectId: 'project-1', phase: 'completed',
        shadows: [],
        verify: {jobId: IDs.verify, status: 'completed', pauseReason: null, result: {verified: true}, failureReason: null},
        semantic: {
          jobId: IDs.semantic, status: 'completed', pauseReason: null,
          verdict: {verdict: 'pass', confidence: 0.9, criteria: [{criterion: 'x', status: 'met', reason: 'y', evidenceRefs: []}], summary: '실제 요약문'},
          independence: 'independent-model', failureReason: null,
        },
      }],
    }),
  });
  const visible = h.root.textContent;
  assert.match(visible, /결정론적 검증 통과/);
  assert.match(visible, /내용 검증 통과/);
  assert.match(visible, /독립 모델\(provider 상이\)/);
  assert.match(visible, /실제 요약문/);
  assert.match(visible, /외부 성과나 품질을 자동 보증하지 않습니다/);
  h.close();
});

test('a semantic FAIL/UNCERTAIN verdict is shown honestly, never rendered or mistaken for a pass', () => {
  const h = setup();
  h.view.updateState({
    screen: 'detail',
    detail: detail({
      shadowMissions: [{
        missionId: IDs.mission, projectId: 'project-1', phase: 'failed',
        shadows: [],
        verify: {jobId: IDs.verify, status: 'completed', pauseReason: null, result: {verified: true}, failureReason: null},
        semantic: {
          jobId: IDs.semantic, status: 'completed', pauseReason: null,
          verdict: {verdict: 'uncertain', confidence: 0.3, criteria: [{criterion: 'x', status: 'uncertain', reason: 'y', evidenceRefs: []}], summary: '증거 부족'},
          independence: 'independent-context', failureReason: null,
        },
      }],
    }),
  });
  const visible = h.root.textContent;
  assert.match(visible, /내용 검증 불확실/);
  assert.doesNotMatch(visible, /내용 검증 통과/);
  assert.match(visible, /독립 컨텍스트/);
  h.close();
});

test('a paused/failed shadow job surfaces its real pause/failure reason, and emergency stop is shown honestly (not fabricated per-mission)', () => {
  const h = setup();
  h.view.updateState({
    screen: 'detail',
    emergencyStop: true,
    detail: detail({
      shadowMissions: [{
        missionId: IDs.mission, projectId: 'project-1', phase: 'blocked',
        shadows: [{
          jobId: IDs.scout, role: 'builder', status: 'paused', pauseReason: 'provider_unavailable',
          dependsOnJobIds: [IDs.scout], artifacts: [], provider: null, model: null, failureReason: null,
        }],
        verify: null, semantic: null,
      }],
    }),
  });
  const visible = h.root.textContent;
  assert.match(visible, /대기 이유 · provider_unavailable/);
  assert.match(visible, /전체 멈춤이 적용되어 있어 새 Shadow 작업이 진행되지 않습니다/);
  assert.match(visible, /결정론적 검증 대기/);
  h.close();
});

test('projectUniverseDetailModel preserves the real shadow mission projection and defaults missing data to an empty array', () => {
  const project = {id: 'project-1', name: 'P', status: 'active', milestones: [], nextAction: null};
  const universe = {
    milestones: {completed: 0, total: 0}, quests: [], jobs: [], sources: [], memoryEvents: [],
    outcomes: [], blockers: [], dominantDrives: [],
    shadowMissions: [{missionId: IDs.mission, phase: 'blocked', shadows: [], verify: null, semantic: null}],
  };
  assert.equal(projectUniverseDetailModel(project, universe).shadowMissions[0].missionId, IDs.mission);
  assert.deepEqual(projectUniverseDetailModel(project, {...universe, shadowMissions: undefined}).shadowMissions, []);
});

test('the Project Universe list renders bounded Browser Harness evidence without exposing command ids', () => {
  const h = setup();
  h.view.updateState({
    screen: 'list',
    projects: [],
    browserJobs: [{
      status: 'completed',
      goal: '공개 페이지 제목·본문·링크 읽기',
      sourceUrl: 'https://example.com/docs',
      commandId: 'secret-command-uuid',
      artifactHash: 'a'.repeat(64),
      deterministic: 'verified',
      semantic: 'pass',
      readingStatus: 'partial',
      decision: 'pending',
    }],
  });
  const visible = h.root.textContent;
  assert.match(visible, /Browser Harness/);
  assert.match(visible, /공개 페이지 제목·본문·링크 읽기/);
  assert.match(visible, /결정론적 검증 통과/);
  assert.match(visible, /내용 검증 통과/);
  assert.match(visible, /일부 확인 · 판단 대기/);
  assert.doesNotMatch(visible, /secret-command-uuid/);
  assert.match(visible, /artifact SHA-256 · a{16}…/);
  h.close();
});

test('the Browser Harness panel keeps an honest empty state', () => {
  const h = setup();
  h.view.updateState({screen: 'list', projects: [], browserJobs: []});
  assert.match(h.root.textContent, /아직 접수된 Browser 작업이 없습니다/);
  h.close();
});
