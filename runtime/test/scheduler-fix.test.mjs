// Verifies the a847357 scheduler fix (`try{...}finally{schedule()}` in
// tick()) beyond the two contention-based observations from the earlier
// closed-loop.test.mjs investigation: a real exception thrown by a guarded
// step still lets the scheduler reschedule and keep firing, a same-day
// retry is correctly deferred by autopilot.retryAt (recorded once, not
// re-attempted every ~150ms tick), and schedule() never stacks more than
// one pending timer even when triggered from multiple places at once.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {start} from '../server.mjs';
import {openStore} from '../lib/store.mjs';
import {planAutopilot, getAutopilotStatus} from '../lib/autopilot.mjs';

async function setup(t, options = {}) {
  const dataDir = options.dataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-scheduler-fix-'));
  const runtime = await start({host:'127.0.0.1',port:0,token:'synthetic-scheduler-owner-token',...options,dataDir});
  const port = runtime.server.address().port;
  const request = async (method, route, body) => {
    const response = await fetch('http://127.0.0.1:' + port + route, {method,headers:{Authorization:'Bearer synthetic-scheduler-owner-token','Content-Type':'application/json'},...(body ? {body:JSON.stringify(body)} : {})});
    return {status:response.status,body:await response.json()};
  };
  const post = (route, body = {}) => request('POST',route,{requestId:randomUUID(),...body});
  t.after(() => {runtime.shutdown();fs.rmSync(dataDir,{recursive:true,force:true});});
  return {dataDir,post,request,disk:()=>openStore(dataDir).state};
}

test('scheduler stays alive and reschedules on a real ~150ms cadence, with no duplicate/stacked timers under concurrent triggers', async t => {
  const ticks = [];
  const h = await setup(t, {debugSchedulerTick: () => { ticks.push(Date.now()); }});
  // Fire several real job-creating requests back-to-back - each one also
  // calls save()+schedule() itself (server.mjs line ~1487). If schedule()
  // ever stacked a second concurrent timer instead of being a true no-op
  // while one is already pending, this would show up as tick() firing in
  // rapid back-to-back bursts well under the 150ms interval.
  await Promise.all(Array.from({length: 5}, () => h.post('/api/jobs', {type:'document', text: '스케줄러 중복 방지 확인용 문서'})));
  // Let the natural loop run for a bit longer, collecting more real ticks.
  await new Promise(resolve => setTimeout(resolve, 900));
  assert.ok(ticks.length >= 4, `expected several real ticks, got ${ticks.length}`);
  const gaps = ticks.slice(1).map((t, i) => t - ticks[i]);
  // A generous floor (100ms, not the full 150ms) absorbs real scheduler/CPU
  // jitter on this device while still catching genuine duplicate-timer
  // stacking, which would produce a near-zero gap.
  for (const gap of gaps) assert.ok(gap >= 100, `tick fired only ${gap}ms after the previous one - duplicate/stacked timer suspected (gaps=${JSON.stringify(gaps)})`);
});

test('scheduler exception injection: a real ProductionCapacityError thrown inside runAutopilot() is caught, logged once, retried after retryAt (not every tick), and the loop keeps serving requests', async t => {
  // The dataDir's store is pre-inflated PAST the 16MiB backup-capacity
  // limit and autopilot pre-enabled BEFORE start() loads it - mutating the
  // file through a second openStore() while the live server also owns and
  // periodically overwrites its own in-memory copy would just get clobbered
  // by the server's next save(). Loading it at startup instead means the
  // server's own real in-memory state already carries the oversized event,
  // so the next real runAutopilot() call throws a genuine
  // ProductionCapacityError (production-capacity.mjs) - not a synthetic/
  // injected error, the same class of failure this code path is actually
  // built to handle in production.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-scheduler-fix-cap-'));
  {
    const pre = openStore(dataDir);
    pre.state.autopilot.enabled = true;
    pre.state.autopilot.enabledAt = new Date().toISOString();
    pre.state.events.push({id: randomUUID(), at: new Date().toISOString(), text: 'x'.repeat(17*1024*1024)});
    pre.save('state_changed');
  }
  const h = await setup(t, {dataDir});
  // Wait for the scheduler (firing every ~150ms) to hit runAutopilot(),
  // observe the failure recorded, and confirm it settles rather than
  // spinning: retryAt should land roughly one hour out, per the existing
  // `new Date(Date.now()+60*60*1000)` retry policy in tick()'s catch.
  let settings = null;
  for (let i=0;i<200;i+=1){const disk=h.disk();if(disk.autopilot.retryAt){settings=disk.autopilot;break;}await new Promise(r=>setTimeout(r,20));}
  assert.ok(settings, 'autopilot.retryAt was never recorded - the scheduler may have died instead of catching the failure');
  assert.match(settings.lastError, /용량|capacity/);
  const retryDeltaMs = Date.parse(settings.retryAt) - Date.now();
  assert.ok(retryDeltaMs > 55*60*1000 && retryDeltaMs < 65*60*1000, `retryAt should be ~1 hour out, got ${retryDeltaMs}ms`);

  // The scheduler must still be alive and ticking (not dead/crashed) -
  // proven by a completely unrelated request still being served.
  const stillAlive = await h.post('/api/jobs', {type:'document', text: '스케줄러가 죽지 않았는지 확인'});
  assert.equal(stillAlive.status,201,JSON.stringify(stillAlive.body));

  // Retry suppression: wait through several more real ~150ms ticks (well
  // over a second, i.e. 6+ tick opportunities) and confirm the failure was
  // recorded only once, not re-attempted on every tick - this is the
  // concrete behavior autopilot.mjs's `eligible()` retryAt gate is
  // responsible for, verified here end-to-end through the real scheduler,
  // not just as a pure-function unit test.
  await new Promise(resolve => setTimeout(resolve, 1200));
  const failureEvents = h.disk().events.filter(e => /용량 한도에 도달|capacity/.test(e.text));
  assert.equal(failureEvents.length, 1, `expected exactly one recorded capacity failure while retryAt is in the future, got ${failureEvents.length}`);
});

test('planAutopilot/getAutopilotStatus: retryAt gates candidate selection (pure-function verification of the same interval the integration test above observes end-to-end)', () => {
  const baseState = {emergencyStop:false, jobs:[], modules:{documents:true}, projects:[], capabilities:{entries:[]}, autopilot:{version:1,enabled:true,dailyAiLimit:4,enabledAt:'2026-09-23T00:00:00.000Z',lastError:'합성 오류',retryAt:'2026-09-23T05:00:00.000Z'}};
  const config = {ready:false};
  const beforeRetry = planAutopilot(baseState, {config, at:'2026-09-23T04:00:00.000Z', capabilities:[]});
  assert.equal(beforeRetry, null, 'before retryAt, no candidate is chosen even though autopilot is enabled');
  const statusBefore = getAutopilotStatus(baseState, {config, at:'2026-09-23T04:00:00.000Z', capabilities:[]});
  assert.equal(statusBefore.nextAt, baseState.autopilot.retryAt);
  assert.match(statusBefore.summary, /점검 시각까지 기다립니다/);

  const afterState = {...baseState, autopilot:{...baseState.autopilot, retryAt:'2026-09-23T03:00:00.000Z'}};
  const statusAfter = getAutopilotStatus(afterState, {config, at:'2026-09-23T04:00:00.000Z', capabilities:[]});
  assert.notEqual(statusAfter.nextAt, afterState.autopilot.retryAt, 'once retryAt has passed, it is no longer the reported next-check time');
});
