import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {initialState} from '../lib/store.mjs';
import {nightCycleDate,runNightCycle} from '../lib/night-cycle.mjs';
import {validateNightCycle} from '../lib/night-cycle-state.mjs';

const window={timeZone:'Asia/Seoul',startMinute:23*60,endMinute:7*60};
const at='2026-10-01T15:30:00.000Z'; // 2026-10-02 00:30 KST
const sha=content=>createHash('sha256').update(content).digest('hex');

test('S10 night window groups wrapped dates, is disabled by default, and records once without model calls',()=>{
  const state=initialState();
  assert.equal(runNightCycle(state,at).ran,false);
  assert.equal(state.nightCycle.reports.length,0);
  state.nightCycle.window=window;
  assert.equal(nightCycleDate(window,at),'2026-10-01');
  assert.equal(nightCycleDate(window,'2026-10-02T05:00:00.000Z'),null); // 14:00 KST
  state.jobs=[{id:'11111111-1111-4111-8111-111111111111',status:'failed',error:'empty_model_response'},
    {id:'22222222-2222-4222-8222-222222222222',status:'failed',error:'empty_model_response'},
    {id:'33333333-3333-4333-8333-333333333333',status:'failed',error:'PRIVATE:token'}];
  state.artifacts={one:{sha256:'a'.repeat(64)},two:{sha256:'a'.repeat(64)},three:{sha256:'b'.repeat(64)}};
  const first=runNightCycle(state,at);
  assert.equal(first.ran,true);
  assert.equal(first.report.cycleDate,'2026-10-01');
  assert.deepEqual(first.report.summary.failures.map(row=>[row.code,row.count]),[['empty_model_response',2],['unclassified',1]]);
  assert.deepEqual(first.report.summary.duplicateArtifactHashes,['a'.repeat(64)]);
  assert.equal(first.report.summary.modelCalls,0);
  assert.equal(first.report.sha256,sha(first.report.markdown));
  assert.equal(first.report.authorizesDispatch,false);
  assert.equal(first.report.markdown.includes('PRIVATE:token'),false);
  validateNightCycle(state.nightCycle);
  const reopened=structuredClone(state);
  assert.equal(runNightCycle(reopened,'2026-10-01T23:00:00.000Z').reason,'outside_or_unconfigured'); // 08:00 KST
  assert.equal(runNightCycle(reopened,'2026-10-01T20:00:00.000Z').reason,'already_recorded'); // 05:00 KST
  assert.equal(reopened.nightCycle.reports.length,1);
});

test('S10 emergency stop, window boundary, and report tampering fail closed',()=>{
  const state=initialState();state.nightCycle.window=window;
  state.emergencyStop=true;
  assert.equal(runNightCycle(state,at).reason,'emergency_stop');
  assert.equal(state.nightCycle.reports.length,0);
  state.emergencyStop=false;
  assert.equal(nightCycleDate(window,'2026-10-01T14:00:00.000Z'),'2026-10-01');
  assert.equal(nightCycleDate(window,'2026-10-01T22:00:00.000Z'),null);
  const report=runNightCycle(state,at).report;
  state.nightCycle.reports[0]={...report,markdown:'changed'};
  assert.throws(()=>validateNightCycle(state.nightCycle));
  state.nightCycle.reports[0]={...report,summary:{...report.summary,modelCalls:1}};
  assert.throws(()=>validateNightCycle(state.nightCycle));
  state.nightCycle.window={...window,timeZone:'invalid'};
  assert.throws(()=>validateNightCycle(state.nightCycle));
});
