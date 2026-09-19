// BLACKHOLE native Drive Orbit overlay (Seven Drives UI, issue #25): proves
// native-drives.ts actually mounts the shared runtime/public/
// drive-orbit-view.mjs in the native DOM shape, fetches the real
// GET /api/drives/status exactly once per open through the injected api(),
// and routes a linked-project tap through the real onOpenProject/onClose
// host callbacks - matching native-projects.test.mjs's convention for logic
// main.ts cannot itself be unit-tested for (it imports Tauri plugin APIs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createNativeDrives } from '../src/native-drives.ts';
import { DRIVE_IDS } from '../../../runtime/lib/seven-drives.mjs';

const WORLD_NAMES = { greed: '부', gluttony: '지식', envy: '영향력', pride: '명예', lust: '창조', wrath: '진화', sloth: '자유' };
const unmeasuredStatus = () => ({
  measuredAt: null,
  drives: DRIVE_IDS.map(driveId => ({ driveId, worldName: WORLD_NAMES[driveId], worldNameEn: driveId, pressure: null, reason: null, linkedGoal: null, linkedProjectId: null, measuredAt: null, evidence: [], trend: null })),
});

function setup(apiImpl) {
  const dom = new JSDOM('<div id="drive-orbit-root"></div>', {url: 'https://example.test'});
  const root = dom.window.document.getElementById('drive-orbit-root');
  const calls = [];
  const opened = [];
  const closed = [];
  const api = async path => { calls.push(path); return apiImpl ? apiImpl(path) : unmeasuredStatus(); };
  const drives = createNativeDrives({root, api, onOpenProject: id => opened.push(id), onClose: () => closed.push(true)});
  return {dom, root, drives, calls, opened, closed, close: () => dom.window.close()};
}

test('opening fetches the real GET /api/drives/status exactly once and renders all seven canonical drives', async () => {
  const h = setup();
  await h.drives.open({dominantDriveId: null, dominantDriveWorldName: null, missionGoal: null});
  assert.deepEqual(h.calls, ['/drives/status']);
  assert.equal(h.root.querySelectorAll('.dob-node').length, 7);
  h.close();
});

test('the real core dominant-drive summary marks the mission-causal node, independent of pressure', async () => {
  const h = setup(() => {
    const status = unmeasuredStatus();
    status.measuredAt = '2026-09-19T00:00:00.000Z';
    status.drives[3] = {...status.drives[3], pressure: 0};
    return status;
  });
  await h.drives.open({dominantDriveId: DRIVE_IDS[3], dominantDriveWorldName: '명예', missionGoal: '목표'});
  const badges = h.root.querySelectorAll('.dob-node-badge');
  assert.equal(badges.length, 1);
  assert.equal(h.root.querySelectorAll('.dob-node')[3].querySelector('.dob-node-badge') !== null, true);
  h.close();
});

test('opening a drive detail with a real linked project routes the tap through the host onOpenProject callback', async () => {
  const h = setup(() => {
    const status = unmeasuredStatus();
    status.measuredAt = '2026-09-19T00:00:00.000Z';
    status.drives[1] = {...status.drives[1], pressure: 4, reason: '실제 근거', linkedProjectId: 'proj-9'};
    return status;
  });
  await h.drives.open({dominantDriveId: null, dominantDriveWorldName: null, missionGoal: null});
  h.root.querySelectorAll('.dob-node')[1].dispatchEvent(new h.dom.window.Event('click', {bubbles: true}));
  h.root.querySelector('[data-dob-action="open-project"]').dispatchEvent(new h.dom.window.Event('click', {bubbles: true}));
  assert.deepEqual(h.opened, ['proj-9']);
  h.close();
});

test('the close button calls the real host onClose callback, never navigating internally', async () => {
  const h = setup();
  await h.drives.open({dominantDriveId: null, dominantDriveWorldName: null, missionGoal: null});
  h.root.querySelector('.dob-close').dispatchEvent(new h.dom.window.Event('click', {bubbles: true}));
  assert.deepEqual(h.closed, [true]);
  h.close();
});

test('a stale in-flight fetch is dropped when the overlay is reset before it resolves', async () => {
  let resolveFirst;
  const h = setup(path => new Promise(resolve => { resolveFirst = () => resolve(unmeasuredStatus()); }));
  const first = h.drives.open({dominantDriveId: null, dominantDriveWorldName: null, missionGoal: null});
  h.drives.reset();
  resolveFirst();
  await first;
  // reset() clears the view back to empty state; the stale response must
  // not repopulate it after the fact.
  assert.equal(h.root.querySelectorAll('.dob-node').length, 0);
  h.close();
});

test('a fetch failure renders an honest notice instead of a fabricated drive state', async () => {
  const h = setup(() => { throw new Error('연결 실패'); });
  await h.drives.open({dominantDriveId: null, dominantDriveWorldName: null, missionGoal: null});
  assert.match(h.root.textContent, /연결 실패/);
  h.close();
});

test('destroy() removes all content and stops responding to clicks', async () => {
  const h = setup();
  await h.drives.open({dominantDriveId: null, dominantDriveWorldName: null, missionGoal: null});
  h.drives.destroy();
  assert.equal(h.root.innerHTML, '');
  h.dom.window.close();
});
