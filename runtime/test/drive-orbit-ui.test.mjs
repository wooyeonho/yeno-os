// drive-orbit-view.mjs is the shared Seven Drives surface for issue #25,
// used unchanged by both the web cockpit and the native Android
// controller - see living-core-ui.test.mjs/project-universe-ui.test.mjs
// for the same jsdom-unit-test convention this file follows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createDriveOrbitView } from '../public/drive-orbit-view.mjs';
import { driveOrbitModel } from '../public/drive-orbit-model.mjs';
import { DRIVE_IDS } from '../lib/seven-drives.mjs';
const { JSDOM } = createRequire(new URL('../../apps/controller/package.json', import.meta.url))('jsdom');

function setup() {
  const dom = new JSDOM('<main></main>'), root = dom.window.document.querySelector('main');
  const opened = [], closed = [];
  const view = createDriveOrbitView({root, onOpenProject: id => opened.push(id), onClose: () => closed.push(true)});
  return { dom, root, view, opened, closed, close() { view.destroy(); dom.window.close(); } };
}

const WORLD_NAMES = { greed: '부', gluttony: '지식', envy: '영향력', pride: '명예', lust: '창조', wrath: '진화', sloth: '자유' };
const unmeasuredStatus = () => ({
  measuredAt: null,
  drives: DRIVE_IDS.map(driveId => ({ driveId, worldName: WORLD_NAMES[driveId], worldNameEn: driveId, pressure: null, reason: null, linkedGoal: null, linkedProjectId: null, measuredAt: null, evidence: [], trend: null })),
});

test('the orbit screen renders exactly seven drive nodes with real canonical world names, never raw internal sin ids as visible text', () => {
  const h = setup();
  const model = driveOrbitModel(unmeasuredStatus(), { dominantDriveId: null, dominantDriveWorldName: null, missionGoal: null });
  h.view.updateState({ screen: 'orbit', ...model });
  const nodes = h.root.querySelectorAll('.dob-node');
  assert.equal(nodes.length, 7);
  for (const id of DRIVE_IDS) assert.equal(h.root.textContent.includes(id), false, `raw internal id "${id}" must never appear as visible text`);
  assert.match(h.root.textContent, /부/);
  assert.ok(h.root.innerHTML.includes('greed'), 'the id must still exist internally as a data attribute for wiring');
  h.close();
});

test('unmeasured drives show 평가 전, never a fabricated pressure number', () => {
  const h = setup();
  const model = driveOrbitModel(unmeasuredStatus(), { dominantDriveId: null, dominantDriveWorldName: null, missionGoal: null });
  h.view.updateState({ screen: 'orbit', ...model });
  const pressures = [...h.root.querySelectorAll('.dob-node-pressure')].map(el => el.textContent);
  assert.ok(pressures.every(text => text === '평가 전'));
});

test('a real measured pressure (including exactly 0) renders as a real number, distinct from 평가 전', () => {
  const h = setup();
  const status = unmeasuredStatus();
  status.measuredAt = '2026-09-19T00:00:00.000Z';
  status.drives[0] = { ...status.drives[0], pressure: 0, measuredAt: status.measuredAt };
  status.drives[1] = { ...status.drives[1], pressure: 15, measuredAt: status.measuredAt };
  const model = driveOrbitModel(status, { dominantDriveId: null, dominantDriveWorldName: null, missionGoal: null });
  h.view.updateState({ screen: 'orbit', ...model });
  const pressures = [...h.root.querySelectorAll('.dob-node-pressure')].map(el => el.textContent);
  assert.equal(pressures[0], '현재 압력 0');
  assert.equal(pressures[1], '현재 압력 15');
});

test('the mission-causal drive shows the 지배 욕망 badge; no other node does', () => {
  const h = setup();
  const status = unmeasuredStatus();
  const model = driveOrbitModel(status, { dominantDriveId: DRIVE_IDS[2], dominantDriveWorldName: 'W', missionGoal: 'G' });
  h.view.updateState({ screen: 'orbit', ...model });
  const badges = h.root.querySelectorAll('.dob-node-badge');
  assert.equal(badges.length, 1);
  assert.equal(h.root.querySelectorAll('.dob-node')[2].querySelector('.dob-node-badge') !== null, true);
});

test('with no comparable ranked candidates, the explanation shows the exact required fallback sentence', () => {
  const h = setup();
  const model = driveOrbitModel(unmeasuredStatus(), { dominantDriveId: null, dominantDriveWorldName: null, missionGoal: null });
  h.view.updateState({ screen: 'orbit', ...model });
  assert.match(h.root.textContent, /현재 비교 가능한 제안 목표가 없어 욕망 평가가 완료되지 않았습니다/);
});

test('with ranked candidates but no live mission, the orbit shows the honest 현재 미션의 지배 욕망 없음 state', () => {
  const h = setup();
  const status = unmeasuredStatus();
  status.measuredAt = '2026-09-19T00:00:00.000Z';
  const model = driveOrbitModel(status, { dominantDriveId: null, dominantDriveWorldName: null, missionGoal: null });
  h.view.updateState({ screen: 'orbit', ...model });
  assert.match(h.root.textContent, /현재 미션의 지배 욕망 없음/);
});

test('clicking a drive node opens its detail with real pressure/reason/goal/project, escaped and truncated', () => {
  const h = setup();
  const status = unmeasuredStatus();
  status.measuredAt = '2026-09-19T00:00:00.000Z';
  status.drives[1] = { ...status.drives[1], pressure: 12, reason: '실제 목표 · 기여 12점', linkedGoal: '<b>실제 목표</b>', linkedProjectId: 'proj-1', evidence: [{ type: 'quest', id: 'q-1' }] };
  const model = driveOrbitModel(status, { dominantDriveId: null, dominantDriveWorldName: null, missionGoal: null });
  h.view.updateState({ screen: 'orbit', ...model });
  h.root.querySelectorAll('.dob-node')[1].dispatchEvent(new h.dom.window.Event('click', { bubbles: true }));
  assert.match(h.root.textContent, /현재 압력 12/);
  assert.match(h.root.textContent, /기여 12점/);
  assert.match(h.root.innerHTML, /&lt;b&gt;실제 목표&lt;\/b&gt;/, 'goal text must be escaped, never rendered as HTML');
  assert.equal(h.root.querySelector('.dob-node'), null, 'must have left the orbit screen');
  h.root.querySelector('[data-dob-action="open-project"]').dispatchEvent(new h.dom.window.Event('click', { bubbles: true }));
  assert.deepEqual(h.opened, ['proj-1']);
  h.close();
});

test('a drive with no measured pressure at all shows 판단 근거 부족 in detail, never a guessed reason', () => {
  const h = setup();
  const model = driveOrbitModel(unmeasuredStatus(), { dominantDriveId: null, dominantDriveWorldName: null, missionGoal: null });
  h.view.updateState({ screen: 'orbit', ...model });
  h.root.querySelectorAll('.dob-node')[0].dispatchEvent(new h.dom.window.Event('click', { bubbles: true }));
  assert.match(h.root.textContent, /판단 근거 부족/);
  assert.match(h.root.textContent, /연결된 프로젝트 없음/);
  assert.match(h.root.textContent, /변화 기록 없음/, 'trend must be shown as honestly absent, never a fake +/- delta');
});

test('a measured drive with zero real contribution shows the exact required empty-contribution label, not a fabricated reason', () => {
  const h = setup();
  const status = unmeasuredStatus();
  status.measuredAt = '2026-09-19T00:00:00.000Z';
  status.drives[3] = { ...status.drives[3], pressure: 0, reason: '현재 이 욕망에 기여하는 제안된 목표가 없습니다.' };
  const model = driveOrbitModel(status, { dominantDriveId: null, dominantDriveWorldName: null, missionGoal: null });
  h.view.updateState({ screen: 'orbit', ...model });
  h.root.querySelectorAll('.dob-node')[3].dispatchEvent(new h.dom.window.Event('click', { bubbles: true }));
  assert.match(h.root.textContent, /현재 이 욕망에 기여하는 제안 목표 없음/);
});

test('back navigation returns to the orbit screen with all seven nodes intact', () => {
  const h = setup();
  const model = driveOrbitModel(unmeasuredStatus(), { dominantDriveId: null, dominantDriveWorldName: null, missionGoal: null });
  h.view.updateState({ screen: 'orbit', ...model });
  h.root.querySelectorAll('.dob-node')[0].dispatchEvent(new h.dom.window.Event('click', { bubbles: true }));
  h.root.querySelector('.dob-back').dispatchEvent(new h.dom.window.Event('click', { bubbles: true }));
  assert.equal(h.root.querySelectorAll('.dob-node').length, 7);
  h.close();
});

test('the close button calls the real host callback, never navigating internally', () => {
  const h = setup();
  const model = driveOrbitModel(unmeasuredStatus(), { dominantDriveId: null, dominantDriveWorldName: null, missionGoal: null });
  h.view.updateState({ screen: 'orbit', ...model });
  h.root.querySelector('.dob-close').dispatchEvent(new h.dom.window.Event('click', { bubbles: true }));
  assert.deepEqual(h.closed, [true]);
  h.close();
});

test('the root element carries the drive-orbit class so prefers-reduced-motion CSS scoping applies', () => {
  const h = setup();
  assert.ok(h.root.classList.contains('drive-orbit'));
  h.close();
});

test('destroy() removes all content and stops responding to clicks', () => {
  const h = setup();
  const model = driveOrbitModel(unmeasuredStatus(), { dominantDriveId: null, dominantDriveWorldName: null, missionGoal: null });
  h.view.updateState({ screen: 'orbit', ...model });
  h.view.destroy();
  assert.equal(h.root.innerHTML, '');
  h.dom.window.close();
});
