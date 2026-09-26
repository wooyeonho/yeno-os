import test from 'node:test';
import assert from 'node:assert/strict';
import {measuredDriveTint,heartbeatChanged,composeFromCore} from '../public/jarvis-scene-model.mjs';

test('only a measured positive dominant drive tints the core; no drive visualization is exposed',()=>{
  const drives=[{driveId:'greed',pressure:0},{driveId:'gluttony',pressure:25},{driveId:'envy',pressure:80}];
  assert.equal(measuredDriveTint(drives,'gluttony','#neutral'),'#3987e5');
  assert.equal(measuredDriveTint(drives,'greed','#neutral'),'#neutral');
  assert.equal(measuredDriveTint(drives,'pride','#neutral'),'#neutral');
  assert.equal(measuredDriveTint([{driveId:'envy',pressure:null}],'envy','#neutral'),'#neutral');
});

test('a heartbeat wave is triggered once per changed timestamp, not by unchanged polling or initial load',()=>{
  assert.equal(heartbeatChanged(null,'2026-09-26T00:00:00.000Z'),false);
  assert.equal(heartbeatChanged('2026-09-26T00:00:00.000Z','2026-09-26T00:00:00.000Z'),false);
  assert.equal(heartbeatChanged('2026-09-26T00:00:00.000Z','2026-09-26T00:00:01.000Z'),true);
  assert.equal(heartbeatChanged('2026-09-26T00:00:01.000Z',null),false);
});

test('core speech never reveals Seven Drive taxonomy even when the internal dominant drive is set',()=>{
  const core={activity:'executing',missionGoal:'자료를 정리해줘',dominantDriveName:'탐욕',dominantDriveWorldName:'금색 욕구'};
  assert.equal(composeFromCore(core),'자료를 정리해줘 — 그 일을 진행하고 있어.');
  assert.doesNotMatch(composeFromCore(core),/탐욕|금색 욕구/);
  assert.doesNotMatch(composeFromCore({...core,activity:'idle',missionGoal:null}),/탐욕|금색 욕구/);
});
