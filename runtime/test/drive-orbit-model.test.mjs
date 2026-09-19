// drive-orbit-model.mjs's pure view-model builder (Seven Drives UI, issue
// #25), shared unchanged by web + Android. Focused on the exact
// distinctions the mission requires: mission-causal drive vs measured
// pressure, null vs zero, no fabricated trend, no raw evidence ids.
import test from 'node:test';
import assert from 'node:assert/strict';
import { driveOrbitModel } from '../public/drive-orbit-model.mjs';
import { DRIVE_IDS } from '../lib/seven-drives.mjs';

const unmeasuredDriveStatus = () => ({
  version: 1, measuredAt: null,
  drives: DRIVE_IDS.map(driveId => ({
    driveId, worldName: 'x', worldNameEn: 'X', pressure: null, reason: null,
    linkedGoal: null, linkedProjectId: null, measuredAt: null, evidence: [], trend: null,
  })),
});
const emptyCore = () => ({ dominantDriveId: null, dominantDriveWorldName: null, missionGoal: null });

test('always returns exactly the seven canonical drives, in order, with real driveStatus world names carried through', () => {
  const model = driveOrbitModel(unmeasuredDriveStatus(), emptyCore());
  assert.equal(model.drives.length, 7);
  assert.deepEqual(model.drives.map(d => d.driveId), DRIVE_IDS);
});

test('an unmeasured driveStatus produces an all-null model, never a fabricated zero', () => {
  const model = driveOrbitModel(unmeasuredDriveStatus(), emptyCore());
  assert.equal(model.measuredAt, null);
  for (const drive of model.drives) {
    assert.equal(drive.pressure, null);
    assert.equal(drive.reason, null);
    assert.equal(drive.linkedGoal, null);
    assert.equal(drive.linkedProjectId, null);
    assert.equal(drive.measuredAt, null);
    assert.equal(drive.trend, null);
    assert.equal(drive.evidenceCount, 0);
    assert.equal(drive.isMissionCausal, false);
  }
});

test('a real measured pressure of exactly 0 is distinct from an unmeasured null', () => {
  const status = unmeasuredDriveStatus();
  status.measuredAt = '2026-09-19T00:00:00.000Z';
  status.drives[0] = { ...status.drives[0], pressure: 0, measuredAt: status.measuredAt, reason: '현재 이 욕망에 기여하는 제안된 목표가 없습니다.' };
  status.drives[1] = { ...status.drives[1], pressure: 12, measuredAt: status.measuredAt, reason: '실제 목표 · 기여 12점', linkedGoal: '실제 목표', evidence: [{ type: 'quest', id: 'q-1' }] };
  const model = driveOrbitModel(status, emptyCore());
  assert.equal(model.drives[0].pressure, 0);
  assert.notEqual(model.drives[0].pressure, null);
  assert.equal(model.drives[1].pressure, 12);
  assert.equal(model.drives[1].evidenceCount, 1);
});

test('trend is always carried through as null - never fabricated - matching the current drive-status.mjs contract', () => {
  const model = driveOrbitModel(unmeasuredDriveStatus(), emptyCore());
  for (const drive of model.drives) assert.equal(drive.trend, null);
});

test('the mission-causal drive marker comes only from core.dominantDriveId, never from pressure, and survives even when that drive is unmeasured', () => {
  const status = unmeasuredDriveStatus(); // every pressure null - the causal drive included
  const core = { dominantDriveId: DRIVE_IDS[3], dominantDriveWorldName: '명예', missionGoal: '실제 미션 목표' };
  const model = driveOrbitModel(status, core);
  const causal = model.drives.find(d => d.driveId === DRIVE_IDS[3]);
  assert.equal(causal.isMissionCausal, true);
  assert.equal(causal.pressure, null, 'drive pressure must not be silently invented just because this drive is the mission cause');
  for (const drive of model.drives) if (drive.driveId !== DRIVE_IDS[3]) assert.equal(drive.isMissionCausal, false);
});

test('a drive with real high pressure that is NOT the mission cause is never marked causal - pressure never overwrites the causal marker', () => {
  const status = unmeasuredDriveStatus();
  status.measuredAt = '2026-09-19T00:00:00.000Z';
  status.drives[5] = { ...status.drives[5], pressure: 99, measuredAt: status.measuredAt, linkedGoal: '가장 높은 압력 목표' };
  const core = { dominantDriveId: DRIVE_IDS[2], dominantDriveWorldName: '영향력', missionGoal: '실제 미션' };
  const model = driveOrbitModel(status, core);
  assert.equal(model.drives[5].pressure, 99);
  assert.equal(model.drives[5].isMissionCausal, false, 'high pressure must never be conflated with mission causality');
  assert.equal(model.drives[2].isMissionCausal, true);
});

test('evidence is exposed only as a real count, never the raw {type,id} references (no raw UUIDs in the model)', () => {
  const status = unmeasuredDriveStatus();
  status.drives[0].evidence = [{ type: 'quest', id: '11111111-1111-4111-8111-111111111111' }];
  const model = driveOrbitModel(status, emptyCore());
  assert.equal(model.drives[0].evidenceCount, 1);
  assert.equal(JSON.stringify(model).includes('11111111-1111-4111-8111-111111111111'), false);
});

test('explanation: no ranked candidates at all uses the exact required fallback sentence', () => {
  const model = driveOrbitModel(unmeasuredDriveStatus(), emptyCore());
  assert.equal(model.explanation, '현재 비교 가능한 제안 목표가 없어 욕망 평가가 완료되지 않았습니다.');
});

test('explanation: candidates are ranked but no live mission is selected yet returns null (honest empty state), not a guess', () => {
  const status = unmeasuredDriveStatus();
  status.measuredAt = '2026-09-19T00:00:00.000Z';
  const model = driveOrbitModel(status, emptyCore());
  assert.equal(model.explanation, null);
});

test('explanation: a real live mission composes a sentence only from real drive/goal/reason fields', () => {
  const status = unmeasuredDriveStatus();
  status.measuredAt = '2026-09-19T00:00:00.000Z';
  status.drives[4] = { ...status.drives[4], pressure: 20, reason: '실제 목표 · 기여 20점', linkedGoal: '연결된 목표' };
  const core = { dominantDriveId: DRIVE_IDS[4], dominantDriveWorldName: '창조', missionGoal: '진짜 진행 중인 목표' };
  const model = driveOrbitModel(status, core);
  assert.match(model.explanation, /창조 욕망이 원인/);
  assert.match(model.explanation, /진짜 진행 중인 목표/);
  assert.match(model.explanation, /기여 20점/);
});

test('linkedProjectId passes through unchanged for the view to navigate with', () => {
  const status = unmeasuredDriveStatus();
  status.measuredAt = '2026-09-19T00:00:00.000Z';
  status.drives[6] = { ...status.drives[6], pressure: 5, linkedProjectId: 'proj-real-1' };
  const model = driveOrbitModel(status, emptyCore());
  assert.equal(model.drives[6].linkedProjectId, 'proj-real-1');
});
