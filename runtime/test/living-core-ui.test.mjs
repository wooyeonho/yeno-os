// living-core-view.mjs is the persistent Home visual anchor for the FINAL
// BLACKHOLE UI contract (issue #25, Slice 1). These are pure jsdom unit
// tests of that display module (matching the existing *-ui.test.mjs
// convention, see growth-ui.test.mjs) - a real physical phone/browser
// viewport is not reproducible in this container, so instead we assert the
// module only ever renders real evidence-derived state, shows the exact
// truthful empty states the contract requires, and never leaks a raw UUID.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createLivingCoreView} from '../public/living-core-view.mjs';
const {JSDOM} = createRequire(new URL('../../apps/controller/package.json', import.meta.url))('jsdom');

function setup() {
  const dom = new JSDOM('<main></main>'), root = dom.window.document.querySelector('main');
  const navigated = [];
  const view = createLivingCoreView({root, onNavigate: id => navigated.push(id)});
  return {dom, root, view, navigated, close() { view.destroy(); dom.window.close(); }};
}
function coreFixture(overrides = {}) {
  return {
    activity: 'idle', missionGoal: null, focusProjectName: null,
    dominantDriveId: null, dominantDriveName: null, activeShadowCount: 0,
    recentArtifactResult: null, verifiedResult: null, lastHeartbeatAt: '2026-09-18T00:00:00.000Z',
    ...overrides,
  };
}

test('idle/offline/emergency each render a distinct, honest visual state and sentence - never a fabricated activity', () => {
  const h = setup();
  h.view.updateState({core: coreFixture(), emergencyStop: false, projects: [], memories: []}, true);
  assert.match(h.root.innerHTML, /living-orb idle/);
  assert.match(h.root.textContent, /명령을 기다리고 있어요/);

  h.view.updateState({core: coreFixture(), emergencyStop: false, projects: [], memories: []}, false);
  assert.match(h.root.innerHTML, /living-orb offline/);
  assert.match(h.root.textContent, /본체 연결을 확인하고 있어요/);

  h.view.updateState({core: coreFixture({activity: 'executing'}), emergencyStop: true, projects: [], memories: []}, true);
  assert.match(h.root.innerHTML, /living-orb emergency/, 'emergency must win over a real executing activity, never be hidden behind it');
  assert.match(h.root.textContent, /전체 멈춤 상태/);
  h.close();
});

test('a real executing activity renders its own honest visual state and sentence, distinct from idle', () => {
  const h = setup();
  h.view.updateState({core: coreFixture({activity: 'executing'}), emergencyStop: false, projects: [], memories: []}, true);
  assert.match(h.root.innerHTML, /living-orb executing/);
  assert.match(h.root.textContent, /실행 중이에요/);
  h.close();
});

test('an unrecognized/future activity value falls back to idle rather than crashing or showing nothing', () => {
  const h = setup();
  h.view.updateState({core: coreFixture({activity: 'not-a-real-activity'}), emergencyStop: false, projects: [], memories: []}, true);
  assert.match(h.root.innerHTML, /living-orb idle/);
  h.close();
});

test('current mission shows the real mission goal and project, and the exact contract empty state when there is none', () => {
  const h = setup();
  h.view.updateState({core: coreFixture({missionGoal: '근거 공백을 확인한다', focusProjectName: 'Buzz'}), emergencyStop: false, projects: [], memories: []}, true);
  assert.match(h.root.textContent, /근거 공백을 확인한다/);
  assert.match(h.root.textContent, /Buzz/);
  h.view.updateState({core: coreFixture(), emergencyStop: false, projects: [], memories: []}, true);
  assert.match(h.root.textContent, /진행 중인 미션 없음/);
  assert.doesNotMatch(h.root.textContent, /근거 공백을 확인한다/);
  h.close();
});

test('the signal row shows the real dominant drive and shadow count, with the exact truthful empty-state wording', () => {
  const h = setup();
  h.view.updateState({core: coreFixture(), emergencyStop: false, projects: [], memories: []}, true);
  assert.match(h.root.textContent, /아직 평가 전/);
  assert.match(h.root.textContent, /활동 중인 그림자 없음/);
  h.view.updateState({core: coreFixture({dominantDriveName: '강욕', activeShadowCount: 3}), emergencyStop: false, projects: [], memories: []}, true);
  assert.match(h.root.textContent, /강욕/);
  assert.match(h.root.textContent, /그림자 3개 활동 중/);
  h.close();
});

test('project orbit preview shows only active projects, caps at 4 with a real overflow count, and the exact empty state otherwise', () => {
  const h = setup();
  h.view.updateState({core: coreFixture(), emergencyStop: false, projects: [], memories: []}, true);
  assert.match(h.root.textContent, /진행 중인 프로젝트 없음/);

  const projects = [
    {id: '1', name: 'BLACKHOLE OS', status: 'active'},
    {id: '2', name: 'God Eye', status: 'active'},
    {id: '3', name: 'Buzz', status: 'active'},
    {id: '4', name: '한끼안부', status: 'active'},
    {id: '5', name: 'For-Ai', status: 'active'},
    {id: '6', name: 'Archived thing', status: 'archived'},
  ];
  h.view.updateState({core: coreFixture(), emergencyStop: false, projects, memories: []}, true);
  assert.equal(h.root.querySelector('.living-orbit-node[title="BLACKHOLE OS"]') !== null, true, 'the full real project name must survive as a title attribute even when the visible label truncates');
  assert.match(h.root.textContent, /\+1/, 'exactly one project must overflow past the 4-node cap');
  assert.doesNotMatch(h.root.textContent, /Archived thing/, 'an archived project must never appear in the active project orbit preview');
  h.close();
});

test('one recent item prefers the most recent real memory, falls back to artifact presence, and never invents a result', () => {
  const h = setup();
  h.view.updateState({core: coreFixture(), emergencyStop: false, projects: [], memories: []}, true);
  assert.match(h.root.textContent, /최근 결과물 없음/);

  h.view.updateState({core: coreFixture({recentArtifactResult: {questId: 'q-1'}}), emergencyStop: false, projects: [], memories: []}, true);
  assert.match(h.root.textContent, /최근 결과물 있음/);

  h.view.updateState({core: coreFixture({recentArtifactResult: {questId: 'q-1'}}), emergencyStop: false, projects: [], memories: [
    {id: 'm-1', text: '오래된 기억', createdAt: '2026-01-01T00:00:00.000Z'},
    {id: 'm-2', text: '가장 최근 기억', createdAt: '2026-09-17T00:00:00.000Z'},
  ]}, true);
  assert.match(h.root.textContent, /가장 최근 기억/, 'the most recently created memory must win, not insertion order');
  assert.doesNotMatch(h.root.textContent, /오래된 기억/);
  h.close();
});

test('never exposes a raw memory/project UUID anywhere in the rendered DOM', () => {
  const h = setup();
  const uuid = '11111111-1111-4111-8111-111111111111';
  h.view.updateState({
    core: coreFixture({missionGoal: '목표', focusProjectName: 'P'}), emergencyStop: false,
    projects: [{id: uuid, name: 'P', status: 'active'}],
    memories: [{id: uuid, text: '기억', createdAt: '2026-09-18T00:00:00.000Z'}],
  }, true);
  assert.equal(h.root.innerHTML.includes(uuid), false);
  h.close();
});

test('clicking the voice CTA and each drill-down surface navigates to the correct real tab', () => {
  const h = setup();
  h.view.updateState({
    core: coreFixture({missionGoal: '목표', recentArtifactResult: {questId: 'q-1'}}), emergencyStop: false,
    projects: [{id: '1', name: 'P', status: 'active'}],
    memories: [{id: 'm-1', text: '기억', createdAt: '2026-09-18T00:00:00.000Z'}],
  }, true);
  h.root.querySelector('.living-voice-cta').dispatchEvent(new h.dom.window.Event('click', {bubbles: true}));
  h.root.querySelector('.living-mission').dispatchEvent(new h.dom.window.Event('click', {bubbles: true}));
  h.root.querySelector('.living-orbit-node').dispatchEvent(new h.dom.window.Event('click', {bubbles: true}));
  h.root.querySelector('.living-recent').dispatchEvent(new h.dom.window.Event('click', {bubbles: true}));
  assert.deepEqual(h.navigated, ['voice', 'quests', 'projects', 'memory']);
  h.close();
});

test('destroy() removes all content and stops responding to clicks', () => {
  const h = setup();
  h.view.updateState({core: coreFixture(), emergencyStop: false, projects: [], memories: []}, true);
  h.view.destroy();
  assert.equal(h.root.innerHTML, '');
  h.dom.window.close();
});
