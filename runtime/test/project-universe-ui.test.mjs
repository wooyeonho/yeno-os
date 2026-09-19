// project-universe-view.mjs is the shared Project Universe surface for UI
// Slice 2 (issue #25), used unchanged by both the web cockpit and the
// native Android controller - see living-core-ui.test.mjs for the same
// jsdom-unit-test convention this file follows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createProjectUniverseView } from '../public/project-universe-view.mjs';
const { JSDOM } = createRequire(new URL('../../apps/controller/package.json', import.meta.url))('jsdom');

function setup(overrides = {}) {
  const dom = new JSDOM('<main></main>'), root = dom.window.document.querySelector('main');
  const opened = [], navigated = [], milestoneActions = [];
  let onMilestoneAction = overrides.onMilestoneAction || (async (action, payload) => {
    milestoneActions.push({ action, payload });
    return { detail: overrides.nextDetail || null };
  });
  const view = createProjectUniverseView({
    root,
    onOpenProject: id => opened.push(id),
    onBack: () => opened.push('__back__'),
    onNavigate: (target, payload) => navigated.push({ target, payload }),
    onMilestoneAction: (action, payload) => onMilestoneAction(action, payload),
  });
  return { dom, root, view, opened, navigated, milestoneActions, close() { view.destroy(); dom.window.close(); } };
}

function project(overrides = {}) {
  return { id: '1', name: 'P', status: 'active', milestones: { completed: 0, total: 0 }, nextAction: null, hasBlocker: false, hasActiveWork: false, ...overrides };
}
function detail(overrides = {}) {
  return {
    projectId: '1', name: 'P', status: 'active', summary: null, nextAction: null,
    milestones: { completed: 0, total: 0, items: [] },
    quests: [], jobs: [], sources: [], memoryEvents: [], outcomes: [], blockers: [], dominantDrives: [],
    reason: null,
    ...overrides,
  };
}

test('an empty project list shows the honest empty state, never a fabricated project', () => {
  const h = setup();
  h.view.updateState({ screen: 'list', projects: [] });
  assert.match(h.root.textContent, /등록된 프로젝트가 없습니다/);
  h.close();
});

test('real project cards show status, honest completed/total milestone counts (never a percentage), and blocker/active badges', () => {
  const h = setup();
  h.view.updateState({
    screen: 'list',
    projects: [
      project({ id: 'a', name: '실제 프로젝트', status: 'active', milestones: { completed: 3, total: 7 }, nextAction: '다음 단계 진행', hasActiveWork: true }),
      project({ id: 'b', name: '보류 프로젝트', status: 'paused', hasBlocker: true }),
    ],
  });
  assert.match(h.root.textContent, /3 \/ 7/);
  assert.doesNotMatch(h.root.textContent, /%/, 'milestone progress must never render as a percentage');
  assert.match(h.root.textContent, /진행/);
  assert.match(h.root.textContent, /보류/);
  assert.match(h.root.textContent, /확인 필요/);
  assert.match(h.root.textContent, /진행 중/);
  h.close();
});

test('a long project name truncates visibly but the click target still opens by its real ID', () => {
  const h = setup();
  const longName = '아주 아주 아주 아주 아주 아주 아주 아주 아주 아주 긴 프로젝트 이름입니다';
  h.view.updateState({ screen: 'list', projects: [project({ id: 'long-id', name: longName })] });
  assert.match(h.root.textContent, /…/);
  h.root.querySelector('.puv-card').dispatchEvent(new h.dom.window.Event('click', { bubbles: true }));
  assert.deepEqual(h.opened, ['long-id']);
  h.close();
});

test('clicking a project card calls onOpenProject with its real id, never a raw click on a non-card element', () => {
  const h = setup();
  h.view.updateState({ screen: 'list', projects: [project({ id: 'p-1' })] });
  h.root.querySelector('[data-puv-action="open"]').dispatchEvent(new h.dom.window.Event('click', { bubbles: true }));
  assert.deepEqual(h.opened, ['p-1']);
  h.close();
});

test('the detail screen renders identity, milestones, blockers, sources, memory and outcomes from real data, with honest empty sections otherwise', () => {
  const h = setup();
  h.view.updateState({
    screen: 'detail',
    detail: detail({
      name: '실제 프로젝트', status: 'active', nextAction: '다음 작업 내용', reason: '진화 관련 목표 진행 중',
      milestones: { completed: 1, total: 2, items: [
        { id: 'm1', text: '완료된 항목', completed: true, createdAt: '2026-09-01T00:00:00.000Z', completedAt: '2026-09-02T00:00:00.000Z' },
        { id: 'm2', text: '미완료 항목', completed: false, createdAt: '2026-09-01T00:00:00.000Z', completedAt: null },
      ] },
      blockers: [{ jobId: 'j1', questId: 'q1', title: '봇 작업', reason: 'providerMissing' }],
      sources: [{ id: 's1', title: '실제 자료', readingStatus: 'read', decision: 'candidate' }],
      memoryEvents: [{ id: 'e1', type: 'episode', text: '실제 기억', createdAt: '2026-09-01T00:00:00.000Z' }],
      outcomes: [{ id: 'o1', ledger: 'wealth', summary: '실제 성과', value: null, unit: null }],
    }),
  });
  const text = h.root.textContent;
  assert.match(text, /실제 프로젝트/);
  assert.match(text, /1 \/ 2/);
  assert.match(text, /완료된 항목/);
  assert.match(text, /미완료 항목/);
  assert.match(text, /완료 기록/);
  assert.doesNotMatch(text, /검증 완료/, 'a stored milestone completion must never be worded as independent verification');
  assert.match(text, /providerMissing/);
  assert.match(text, /실제 자료/);
  assert.match(text, /실제 기억/);
  assert.match(text, /실제 성과/);
  assert.match(text, /진화 관련 목표 진행 중/);
  h.close();
});

test('sections with no linked records show the honest empty line instead of omitting the section', () => {
  const h = setup();
  h.view.updateState({ screen: 'detail', detail: detail() });
  const text = h.root.textContent;
  assert.match(text, /판단 근거 부족/);
  assert.match(text, /연결된 자료가 없습니다/);
  assert.match(text, /연결된 기억이 없습니다/);
  assert.match(text, /기록된 성과가 없습니다/);
  assert.match(text, /진행 중인 작업이 없습니다/);
  assert.match(text, /아직 등록한 마일스톤이 없습니다/);
  h.close();
});

test('deferred future surfaces (Shadow Army, Absorption, Growth) show an honest unavailable state, never a fake implementation', () => {
  const h = setup();
  h.view.updateState({ screen: 'detail', detail: detail() });
  assert.match(h.root.textContent, /아직 연결되지 않았습니다/);
  h.close();
});

test('never exposes a raw project/milestone/job/source/memory UUID as visible text, only inside data attributes', () => {
  const h = setup();
  const uuid = '11111111-1111-4111-8111-111111111111';
  h.view.updateState({
    screen: 'detail',
    detail: detail({
      projectId: uuid,
      milestones: { completed: 0, total: 1, items: [{ id: uuid, text: 'x', completed: false, createdAt: '2026-09-01T00:00:00.000Z', completedAt: null }] },
      blockers: [{ jobId: uuid, questId: uuid, title: 'job', reason: 'r' }],
      sources: [{ id: uuid, title: 's', readingStatus: 'unread', decision: 'pending' }],
      memoryEvents: [{ id: uuid, type: 'episode', text: 'm', createdAt: '2026-09-01T00:00:00.000Z' }],
    }),
  });
  assert.equal(h.root.textContent.includes(uuid), false);
  assert.ok(h.root.innerHTML.includes(uuid), 'the id must still exist internally as a data attribute for wiring');
  h.close();
});

test('project name/goal/summary text is escaped and never injects HTML (XSS-safe)', () => {
  const h = setup();
  const hostile = '<img src=x onerror=alert(1)>';
  h.view.updateState({ screen: 'list', projects: [project({ name: hostile })] });
  assert.equal(h.root.querySelector('img'), null);
  assert.match(h.root.innerHTML, /&lt;img/);
  h.close();
});

test('adding a milestone calls onMilestoneAction with the real project id and text, then reflects the host-confirmed result', async () => {
  const nextDetail = detail({ milestones: { completed: 0, total: 1, items: [{ id: 'new', text: '새 마일스톤', completed: false, createdAt: '2026-09-01T00:00:00.000Z', completedAt: null }] } });
  const h = setup({ nextDetail });
  h.view.updateState({ screen: 'detail', detail: detail() });
  const form = h.root.querySelector('[data-puv-form="add-milestone"]');
  form.querySelector('input[name="text"]').value = '새 마일스톤';
  form.dispatchEvent(new h.dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(h.milestoneActions, [{ action: 'add', payload: { projectId: '1', text: '새 마일스톤' } }]);
  assert.match(h.root.textContent, /새 마일스톤/);
  h.close();
});

test('toggling a milestone checkbox calls onMilestoneAction and only reflects the host-confirmed completed state, never optimistically', async () => {
  let resolveAction;
  const pending = new Promise(r => { resolveAction = r; });
  const h = setup({ onMilestoneAction: async (action, payload) => { await pending; return { detail: detail({ milestones: { completed: 1, total: 1, items: [{ id: 'm1', text: 'x', completed: true, createdAt: '2026-09-01T00:00:00.000Z', completedAt: '2026-09-02T00:00:00.000Z' }] } }) }; } });
  h.view.updateState({ screen: 'detail', detail: detail({ milestones: { completed: 0, total: 1, items: [{ id: 'm1', text: 'x', completed: false, createdAt: '2026-09-01T00:00:00.000Z', completedAt: null }] } }) });
  const checkbox = h.root.querySelector('[data-puv-action="toggle-milestone"]');
  checkbox.checked = true;
  checkbox.dispatchEvent(new h.dom.window.Event('change', { bubbles: true }));
  // Still awaiting the host - the view must not have flipped to "완료 기록" on its own.
  assert.doesNotMatch(h.root.textContent, /완료 기록/);
  assert.equal(h.root.querySelector('[data-puv-action="toggle-milestone"]').disabled, true, 'the control must show a busy state while the host confirms');
  resolveAction();
  await new Promise(r => setTimeout(r, 0));
  assert.match(h.root.textContent, /완료 기록/);
  h.close();
});

test('a 409 revision conflict never silently overwrites: the view shows the host notice and the reloaded (unmutated) state', async () => {
  const conflictDetail = detail({ milestones: { completed: 0, total: 1, items: [{ id: 'm1', text: '변경 전', completed: false, createdAt: '2026-09-01T00:00:00.000Z', completedAt: null }] } });
  const h = setup({
    onMilestoneAction: async () => { const error = new Error('프로젝트가 변경되었습니다. 최신 정보를 다시 불러왔습니다.'); throw error; },
  });
  h.view.updateState({ screen: 'detail', detail: conflictDetail });
  const checkbox = h.root.querySelector('[data-puv-action="toggle-milestone"]');
  checkbox.dispatchEvent(new h.dom.window.Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 0));
  assert.match(h.root.textContent, /프로젝트가 변경되었습니다/);
  // The milestone itself must remain exactly what the host's conflict
  // response reported, not whatever the view guessed the click meant.
  assert.match(h.root.textContent, /변경 전/);
  h.close();
});

test('removing a milestone calls onMilestoneAction with the real ids', async () => {
  const h = setup();
  h.view.updateState({ screen: 'detail', detail: detail({ milestones: { completed: 0, total: 1, items: [{ id: 'm1', text: 'x', completed: false, createdAt: '2026-09-01T00:00:00.000Z', completedAt: null }] } }) });
  h.root.querySelector('[data-puv-action="remove-milestone"]').dispatchEvent(new h.dom.window.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(h.milestoneActions, [{ action: 'remove', payload: { projectId: '1', milestoneId: 'm1' } }]);
  h.close();
});

test('back navigation and cross-surface links (sources/memory) call the real host callbacks', () => {
  const h = setup();
  h.view.updateState({ screen: 'detail', detail: detail({ sources: [{ id: 's1', title: 't', readingStatus: 'unread', decision: 'pending' }] }) });
  h.root.querySelector('.puv-back').dispatchEvent(new h.dom.window.Event('click', { bubbles: true }));
  assert.deepEqual(h.opened, ['__back__']);
  h.root.querySelector('[data-puv-action="navigate"][data-target="sources"]').dispatchEvent(new h.dom.window.Event('click', { bubbles: true }));
  assert.deepEqual(h.navigated, [{ target: 'sources', payload: { projectId: '1' } }]);
  h.close();
});

test('destroy() removes all content and stops responding to input', () => {
  const h = setup();
  h.view.updateState({ screen: 'list', projects: [project()] });
  h.view.destroy();
  assert.equal(h.root.innerHTML, '');
  h.dom.window.close();
});
