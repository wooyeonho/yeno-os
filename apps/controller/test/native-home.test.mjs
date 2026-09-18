import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createNativeHomeNavigation } from '../src/native-home.ts';
import { createLivingCoreView } from '../../../runtime/public/living-core-view.mjs';

// BLACKHOLE Living Core Home correction for the native Android/Tauri
// controller (issue #25 Slice 1 review): proves the shared
// runtime/public/living-core-view.mjs actually mounts in the native DOM
// shape, and that its navigation activates the EXISTING native surfaces
// (Live Voice toggle, advanced-tools drawer, jobs view) rather than a new
// divergent stack. main.ts itself cannot be unit tested (it imports Tauri
// plugin APIs), which is exactly why this logic lives in its own
// native-home.ts module, matching native-live-voice-view.ts's pattern.

function setup() {
  const dom = new JSDOM(`
    <div id="living-core-root"></div>
    <div id="live-voice" hidden><button type="button" data-live-toggle>실시간 통화 시작</button></div>
    <details class="tools-drawer"><summary>고급 도구</summary></details>
  `, {url: 'https://example.test'});
  const doc = dom.window.document;
  // jsdom does not implement scrollIntoView; stub it so navigation logic
  // that calls it does not throw, and record calls for assertions.
  const scrolled = [];
  dom.window.HTMLElement.prototype.scrollIntoView = function (options) { scrolled.push({id: this.id || this.className, options}); };
  const shownViews = [];
  const nav = createNativeHomeNavigation({liveVoiceRoot: doc.getElementById('live-voice'), doc, showJobsView: () => shownViews.push('jobs')});
  return {dom, doc, nav, scrolled, shownViews, close: () => dom.window.close()};
}

test('voice navigation scrolls to the existing native Live Voice card and clicks its real toggle when enabled', () => {
  const h = setup();
  const toggle = h.doc.querySelector('[data-live-toggle]');
  let clicked = 0;
  toggle.addEventListener('click', () => clicked++);
  h.nav.navigate('voice');
  assert.equal(clicked, 1, 'the existing native toggle button must receive a real click - never a second voice system');
  assert.ok(h.scrolled.some(s => s.id === 'live-voice'));
  h.close();
});

test('voice navigation never clicks a disabled toggle, but still scrolls it into view', () => {
  const h = setup();
  const toggle = h.doc.querySelector('[data-live-toggle]');
  toggle.disabled = true;
  let clicked = 0;
  toggle.addEventListener('click', () => clicked++);
  h.nav.navigate('voice');
  assert.equal(clicked, 0);
  assert.ok(h.scrolled.some(s => s.id === 'live-voice'));
  h.close();
});

test('quests/projects/memory navigation all open the one existing advanced-tools drawer', () => {
  for (const id of ['quests', 'projects', 'memory']) {
    const h = setup();
    const details = h.doc.querySelector('.tools-drawer');
    assert.equal(details.open, false);
    h.nav.navigate(id);
    assert.equal(details.open, true, `${id} must open the existing advanced-tools drawer, not a new surface`);
    assert.ok(h.scrolled.some(s => s.id === 'tools-drawer'));
    h.close();
  }
});

test('control navigation calls the real native jobs view switch, not a fabricated one', () => {
  const h = setup();
  h.nav.navigate('control');
  assert.deepEqual(h.shownViews, ['jobs']);
  h.close();
});

test('an unrecognized navigation id is a safe no-op', () => {
  const h = setup();
  const details = h.doc.querySelector('.tools-drawer');
  h.nav.navigate('not-a-real-surface');
  assert.equal(details.open, false);
  assert.deepEqual(h.shownViews, []);
  h.close();
});

test('the shared Living Core view actually mounts into the native #living-core-root and renders real state', () => {
  const h = setup();
  const view = createLivingCoreView({root: h.doc.getElementById('living-core-root'), onNavigate: id => h.nav.navigate(id)});
  view.updateState({
    core: {activity: 'idle', missionGoal: '근거 공백을 확인한다', focusProjectName: 'Buzz', dominantDriveName: '강욕', activeShadowCount: 2, recentArtifactResult: null, verifiedResult: null, lastHeartbeatAt: null},
    emergencyStop: false,
    projects: [{id: '1', name: 'Buzz', status: 'active'}],
    memories: [{id: 'm-1', text: '최근 기억', createdAt: '2026-09-18T00:00:00.000Z'}],
  }, true);
  const root = h.doc.getElementById('living-core-root');
  assert.match(root.innerHTML, /living-orb idle/);
  assert.match(root.textContent, /블랙홀에게 말하기/);
  assert.match(root.textContent, /근거 공백을 확인한다/);
  assert.match(root.textContent, /강욕/);
  assert.match(root.textContent, /그림자 2개 활동 중/);
  assert.match(root.textContent, /최근 기억/);

  // Clicking the mounted voice CTA reaches the real native toggle through
  // the same navigation object real main.ts wiring uses.
  const toggle = h.doc.querySelector('[data-live-toggle]');
  let clicked = 0;
  toggle.addEventListener('click', () => clicked++);
  root.querySelector('.living-voice-cta').dispatchEvent(new h.dom.window.Event('click', {bubbles: true}));
  assert.equal(clicked, 1);
  view.destroy();
  h.close();
});

test('the native Home never renders a raw project/memory UUID', () => {
  const h = setup();
  const view = createLivingCoreView({root: h.doc.getElementById('living-core-root'), onNavigate: id => h.nav.navigate(id)});
  const uuid = '11111111-1111-4111-8111-111111111111';
  view.updateState({
    core: {activity: 'idle', missionGoal: null, focusProjectName: null, dominantDriveId: null, dominantDriveName: null, activeShadowCount: 0, recentArtifactResult: null, verifiedResult: null, lastHeartbeatAt: null},
    emergencyStop: false,
    projects: [{id: uuid, name: 'P', status: 'active'}],
    memories: [{id: uuid, text: '기억', createdAt: '2026-09-18T00:00:00.000Z'}],
  }, true);
  const root = h.doc.getElementById('living-core-root');
  assert.equal(root.innerHTML.includes(uuid), false);
  view.destroy();
  h.close();
});
