import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {start} from '../server.mjs';
import {openStore} from '../lib/store.mjs';
import {validateQuestState} from '../lib/quests.mjs';
import {PROVIDER_BLOCKER} from '../lib/readiness.mjs';

// INTEGRATION category (real runtime, real server, real store on disk, real
// process-level restart of the runtime, mock provider). This is NOT a live
// provider, HTTPS staging or device test and must never be reported as one.
const MODEL_ENV={YENO_AGENT_PROVIDER:'openai',YENO_OPENAI_API_KEY:'synthetic-openai-key',YENO_OPENAI_MODEL:'synthetic-openai',YENO_AGENT_DAILY_CALL_LIMIT:'6'};
const COMMAND='블랙홀, 지금 가장 중요한 거 알아서 진행해.';

async function setup(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-real-use-')),token='synthetic-real-use-owner-token';
  const modelCalls=[];
  const agentFetch=async(url,req)=>{modelCalls.push({url,body:JSON.parse(req.body)});throw new Error('synthetic provider outage');};
  let runtime=await start({host:'127.0.0.1',port:0,dataDir:dir,token,env:MODEL_ENV,agentFetch});
  let bearer=token;
  const request=async(method,route,body,auth=bearer)=>{const r=await fetch(`http://127.0.0.1:${runtime.server.address().port}${route}`,{method,headers:{Authorization:`Bearer ${auth}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
  // The Android client speaks /api/v1 with a device token: enroll one for real.
  const enroll=await request('POST','/api/v1/devices/enroll',{requestId:randomUUID(),name:'acceptance-phone',platform:'android'},token);
  assert.equal(enroll.status,201,JSON.stringify(enroll.body));bearer=enroll.body.device.deviceToken;
  const v1=route=>route.replace(/^\/api/,'/api/v1');
  const post=(route,body={})=>request('POST',v1(route),{requestId:randomUUID(),...body});
  const get=route=>request('GET',v1(route));
  const wait=async(id,statuses=['completed','failed','paused'])=>{for(let i=0;i<300;i++){const j=openStore(dir).state.jobs.find(j=>j.id===id);if(j&&statuses.includes(j.status))return j;await new Promise(r=>setTimeout(r,20));}assert.fail('job did not reach target state');};
  const restart=async()=>{runtime.shutdown();runtime=await start({host:'127.0.0.1',port:0,dataDir:dir,token,env:MODEL_ENV,agentFetch});};
  t.after(()=>{runtime.shutdown();fs.rmSync(dir,{recursive:true,force:true});});
  return {dir,post,get,request,wait,restart,modelCalls,disk:()=>openStore(dir).state};
}

test('Real-use scenario (INTEGRATION): device /api/v1 command -> Homunculus -> Kirby reuse -> Jarvis local capability -> persisted artifact -> executionVerified (outcome unverified) -> growth D -> restart -> replan; same requestId never duplicates; emergency stop freezes mutations',async t=>{
  const app=await setup(t);
  // Real evidence only: two owner jobs that actually failed against the (mock) provider.
  const failed=[];
  for(const goal of ['첫 소유자 목표','둘째 소유자 목표']){
    const created=await app.post('/api/quests',{goal,provider:'openai',maxCalls:1});assert.equal(created.status,201,JSON.stringify(created.body));const quest=created.body.quest;
    const run=await app.post(`/api/quests/${quest.id}/run`);assert.equal(run.status,201,JSON.stringify(run.body));
    const job=await app.wait(run.body.job.id);assert.equal(job.status,'failed');failed.push(job);
    assert.equal(job.routing.selectedProvider,'openai','router provenance persisted on a real job');assert.equal(job.routing.transportOutcome,'outcomeUnknown','a thrown fetch after send is ambiguous: no failover, owner review');assert.match(job.routing.routingFingerprint,/^[a-f0-9]{64}$/);
  }
  const modelCallsBefore=app.modelCalls.length;

  // 1. Homunculus decides a goal from stored evidence (no owner text, zero model calls).
  const synth=await app.post('/api/quests/synthesize');
  assert.equal(synth.status,201,JSON.stringify(synth.body));
  const quest=synth.body.quest;assert.equal(quest.synthesis.archetype,'repair');

  // 2. The natural-language command over the mobile surface reaches Homunculus,
  //    which ranks the real proposed goal but never starts a synthesized quest by itself.
  assert.equal((await app.post('/api/settings',{modules:{ai:true}})).status,200);
  const voice=await app.post('/api/voice',{text:COMMAND});
  assert.equal(voice.status,200,JSON.stringify(voice.body));
  assert.equal(voice.body.pendingOwnerAction,true);assert.equal(voice.body.job,null);assert.equal(voice.body.quest.id,quest.id);
  assert.equal(app.modelCalls.length,modelCallsBefore,'the command did not become a free-text model call');

  // 3. Kirby discovery/reuse is visible before execution.
  let trace=(await app.get('/api/quests')).body.loop.quests.find(q=>q.goal.questId===quest.id);
  assert.equal(trace.kirby.stage,'active');assert.equal(trace.kirby.qualification.action,'reuse');assert.equal(trace.capabilityGap.capabilityId,'failure-triage');

  // 4. Owner authorizes the single bounded step; the same requestId is replayed
  //    and must not create a second job (request ledger idempotency).
  const stepId=randomUUID();
  const step=await app.request('POST','/api/v1/quests/loop',{requestId:stepId});
  assert.equal(step.status,201,JSON.stringify(step.body));assert.equal(step.body.kind,'execute');assert.equal(step.body.capabilityId,'failure-triage');
  const replay=await app.request('POST','/api/v1/quests/loop',{requestId:stepId});
  assert.equal(replay.status,201);assert.equal(replay.body.job.id,step.body.job.id,'replayed requestId returns the same job');
  const job=await app.wait(step.body.job.id);
  assert.equal(job.status,'completed',job.error);assert.equal(job.type,'capability');
  assert.equal(app.disk().jobs.filter(j=>j.type==='capability').length,1,'exactly one Jarvis execution');
  assert.equal(app.modelCalls.length,modelCallsBefore,'local capability: zero provider requests');
  assert.equal((await app.post('/api/quests/loop')).body.reason,'no_autonomous_goal','one execution per goal');

  // 5. Result is a real persisted artifact; execution is verified, outcome is not.
  const shown=(await app.get('/api/quests')).body.quests.find(q=>q.id===quest.id);
  assert.equal(shown.status,'completed');assert.equal(shown.artifacts.length,1);
  trace=(await app.get('/api/quests')).body.loop.quests.find(q=>q.goal.questId===quest.id);
  assert.equal(trace.verification.executionVerified,true);assert.equal(trace.verification.outcomeVerified,false);
  assert.equal(trace.growth.grade,'D');assert.equal(trace.growth.promoted,true);
  assert.equal(trace.replan.nextArchetype,'measure-outcome','next tick replans from the new evidence');

  // 6. Readiness on the same surface tells the truth about this run.
  const ready=(await app.get('/api/readiness')).body;
  assert.notEqual(ready.overall,'READY');assert.ok(ready.blockers.includes(PROVIDER_BLOCKER));
  assert.equal(ready.providers.find(p=>p.provider==='openai').state,'DEGRADED','two ambiguous post-send outcomes are on record; a key alone is never LIVE_VERIFIED');
  assert.equal(ready.closedLoop.state,'LIVE_VERIFIED','in-store evidence from the owner path of THIS instance (not a self-test); the instance cannot know it runs under a test harness');
  assert.equal(JSON.stringify(ready).includes('synthetic-openai-key'),false);

  // 7. Process restart: same job, artifact, evidence, growth; no re-execution.
  await app.restart();
  const disk=app.disk();validateQuestState(disk);
  assert.equal(disk.jobs.find(j=>j.id===job.id).status,'completed');
  assert.equal(disk.quests.find(q=>q.id===quest.id).loop.jobId,job.id);
  const after=(await app.get('/api/quests')).body.loop.quests.find(q=>q.goal.questId===quest.id);
  assert.equal(after.verification.executionVerified,true);assert.equal(after.growth.grade,'D');
  assert.equal((await app.get('/api/state')).body.growth.capabilities.skills.find(k=>k.id==='failure-triage').grade,'D');
  assert.equal(app.disk().jobs.filter(j=>j.type==='capability').length,1,'restart did not re-run the step');
  const replayAfterRestart=await app.request('POST','/api/v1/quests/loop',{requestId:stepId});
  assert.equal(replayAfterRestart.body.job.id,job.id,'request ledger survives restart');

  // 8. Replan on the next tick produces the next goal, not a duplicate.
  const replan=await app.post('/api/quests/synthesize');
  assert.equal(replan.body.outcome,'new_quest');assert.equal(replan.body.quest.synthesis.archetype,'measure-outcome');
  assert.equal((await app.post('/api/quests/synthesize')).body.outcome,'existing_quest');

  // 9. Emergency stop: no new mutation/execution; observation still works; resume restores.
  assert.equal((await app.post('/api/control',{action:'stop'})).status,200);
  const jobsFrozen=app.disk().jobs.length,questsFrozen=app.disk().quests.length;
  assert.equal((await app.post('/api/quests/loop')).status,409);
  assert.equal((await app.post('/api/quests/synthesize')).body.persisted,false);
  assert.equal((await app.post('/api/self-test')).status,409);
  assert.equal((await app.get('/api/quests')).status,200);
  assert.equal((await app.get('/api/readiness')).body.emergencyStop.active,true);assert.equal((await app.get('/api/readiness')).body.emergencyStop.state,'LIVE_VERIFIED');
  assert.equal(app.disk().jobs.length,jobsFrozen);assert.equal(app.disk().quests.length,questsFrozen);
  assert.equal((await app.post('/api/control',{action:'resume'})).status,200);
  assert.equal((await app.get('/api/readiness')).body.emergencyStop.active,false);
  assert.equal(app.modelCalls.length,modelCallsBefore);
});
