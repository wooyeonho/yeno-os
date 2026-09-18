import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { driveStatus } from '../lib/drive-status.mjs';
import { planQuest } from '../lib/quests.mjs';
import { DRIVE_IDS } from '../lib/seven-drives.mjs';

const at = '2026-09-18T00:00:00.000Z';
const state = () => ({ quests: [], outcomes: [], jobs: [], projects: [] });

test('with no proposed quests, every drive is honestly unmeasured (욕망 평가 전), never a fabricated zero', () => {
  const result = driveStatus(state(), at);
  assert.equal(result.version, 1);
  assert.equal(result.measuredAt, null);
  assert.equal(result.drives.length, 7);
  assert.deepEqual(result.drives.map(d => d.driveId).sort(), [...DRIVE_IDS].sort());
  for (const drive of result.drives) {
    assert.equal(drive.pressure, null);
    assert.equal(drive.reason, null);
    assert.equal(drive.linkedGoal, null);
    assert.equal(drive.linkedProjectId, null);
    assert.equal(drive.measuredAt, null);
    assert.deepEqual(drive.evidence, []);
    assert.equal(drive.trend, null, 'trend must never be fabricated without a second persisted measurement');
    assert.equal(typeof drive.worldName, 'string');
    assert.equal(typeof drive.worldNameEn, 'string');
  }
});

test('pressure and reason come only from the real quest-ranking engine, and a zero measurement never carries a misleading linked goal', () => {
  const s = state();
  const projectId = randomUUID();
  s.projects.push({ id: projectId, name: 'P', status: 'active' });
  const quest = planQuest({ goal: '실제 목표', drive: 'lust', projectId }, s);
  s.quests.push(quest);

  const result = driveStatus(s, at);
  assert.equal(result.measuredAt, at);
  const byId = Object.fromEntries(result.drives.map(d => [d.driveId, d]));

  // Every drive gets a real numeric pressure now that a candidate exists.
  for (const drive of result.drives) assert.equal(typeof drive.pressure, 'number');

  // A drive this quest actually contributes to carries real linked evidence.
  const contributing = result.drives.filter(d => d.pressure > 0);
  assert.ok(contributing.length > 0);
  for (const drive of contributing) {
    assert.equal(drive.linkedGoal, '실제 목표');
    assert.equal(drive.linkedProjectId, projectId);
    assert.deepEqual(drive.evidence, [{ type: 'quest', id: quest.id }]);
    assert.match(drive.reason, /실제 목표/);
    assert.equal(drive.measuredAt, at);
  }

  // A drive at zero pressure must NOT be credited with a linked goal just
  // because it trivially ties for the (zero) peak - that would misleadingly
  // imply a real contribution that does not exist.
  const zeroed = byId[DRIVE_IDS.find(id => byId[id].pressure === 0)];
  if (zeroed) {
    assert.equal(zeroed.linkedGoal, null);
    assert.equal(zeroed.linkedProjectId, null);
    assert.deepEqual(zeroed.evidence, []);
    assert.equal(zeroed.reason, '현재 이 욕망에 기여하는 제안된 목표가 없습니다.');
  }
});

test('a quest with no projectId never fabricates a linkedProjectId', () => {
  const s = state();
  const quest = planQuest({ goal: '프로젝트 없는 목표', drive: 'pride' }, s);
  s.quests.push(quest);
  const result = driveStatus(s, at);
  for (const drive of result.drives) if (drive.pressure > 0) assert.equal(drive.linkedProjectId, null);
});

test('driveStatus never mutates the input state', () => {
  const s = state();
  s.quests.push(planQuest({ goal: '변경 감지용 목표', drive: 'wrath' }, s));
  const before = structuredClone(s);
  driveStatus(s, at);
  assert.deepEqual(s, before);
});
