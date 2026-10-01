import test from 'node:test';
import assert from 'node:assert/strict';
import {smallOrbState, SMALL_ORB_LABELS} from '../public/small-orb-state.mjs';

test('small orb follows durable core activity and stops when evidence is absent', () => {
  const facts = {online:true, emergencyStop:false, jobs:[{status:'running'}]};
  assert.equal(smallOrbState({...facts,core:{activity:'planning'}}), 'working');
  assert.equal(smallOrbState({...facts,core:{activity:'executing'}}), 'working');
  assert.equal(smallOrbState({...facts,core:{activity:'verifying'}}), 'solving');
  assert.equal(smallOrbState({...facts,core:{activity:'waiting_owner'}}), 'listening');
  assert.equal(smallOrbState({...facts,core:{activity:'idle',pendingApprovalCount:1}}), 'still');
  assert.equal(smallOrbState({...facts,core:{activity:'executing'},jobs:[]}), 'still');
  assert.equal(smallOrbState({...facts,core:{activity:'planning'},emergencyStop:true}), 'still');
  assert.equal(smallOrbState({...facts,core:{activity:'planning'},online:false}), 'still');
  assert.equal(smallOrbState({...facts,core:null}), 'still');
  assert.equal(SMALL_ORB_LABELS.solving, '검증 중');
});
