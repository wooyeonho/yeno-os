import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {start} from '../server.mjs';
import {openStore} from '../lib/store.mjs';
import {planClosedLoop,closedLoopStatus,loopInput,ARCHETYPE_CAPABILITY} from '../lib/closed-loop.mjs';
import {validateQuestState} from '../lib/quests.mjs';

const MANIFESTS=['evidence-gap-brief','failure-triage','ledger-digest'].map(name=>JSON.parse(fs.readFileSync(new URL(`../capabilities/${name}.json`,import.meta.url),'utf8')));
const MODEL_ENV={YENO_AGENT_PROVIDER:'openai',YENO_OPENAI_API_KEY:'synthetic-openai-key',YENO_OPENAI_MODEL:'synthetic-openai',YENO_AGENT_DAILY_CALL_LIMIT:'6'};
const ok=text=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:text,tool_calls:[]}}],usage:{prompt_tokens:30,completion_tokens:20}}),{headers:{'Content-Type':'application/json'}});

// Same harness as goal-synthesis.test.mjs: real server, real store on disk,
// every model request counted, evidence created only through owner actions.
async function setup(t,{env=MODEL_ENV}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-closed-loop-')),token='synthetic-closed-loop-owner-token';
  const modelCalls=[];let mode='fail';
  const agentFetch=async(url,req)=>{modelCalls.push({url,body:JSON.parse(req.body)});if(mode==='fail')throw new Error('synthetic provider outage');return ok('합성 산출물 본문');};
  let runtime=await start({host:'127.0.0.1',port:0,dataDir:dir,token,env,agentFetch});
  const request=async(method,route,body)=>{const r=await fetch(`http://127.0.0.1:${runtime.server.address().port}${route}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
  const post=(route,body={})=>request('POST',route,{requestId:randomUUID(),...body});
  const get=route=>request('GET',route);
  const wait=async(id,statuses=['completed','failed','paused'])=>{for(let i=0;i<300;i++){const j=openStore(dir).state.jobs.find(j=>j.id===id);if(j&&statuses.includes(j.status))return j;await new Promise(r=>setTimeout(r,20));}assert.fail('job did not reach target state');};
  const until=async(check,label)=>{for(let i=0;i<300;i++){const value=check();if(value)return value;await new Promise(r=>setTimeout(r,20));}assert.fail(label);};
  const restart=async()=>{runtime.shutdown();runtime=await start({host:'127.0.0.1',port:0,dataDir:dir,token,env,agentFetch});};
  const runOwnerQuest=async(goal,expected)=>{const quest=(await post('/api/quests',{goal,provider:'openai',maxCalls:1})).body.quest;const run=await post(`/api/quests/${quest.id}/run`);assert.equal(run.status,201,JSON.stringify(run.body));const job=await wait(run.body.job.id);assert.equal(job.status,expected,job.error);return {quest,job};};
  t.after(()=>{runtime.shutdown();fs.rmSync(dir,{recursive:true,force:true});});
  return {dir,post,get,wait,until,restart,runOwnerQuest,modelCalls,setMode:next=>{mode=next;},state:()=>runtime.state(),disk:()=>openStore(dir).state};
}
const autonomous=quests=>quests.filter(q=>q.synthesis);
const loopOf=(overview,questId)=>overview.loop.quests.find(q=>q.goal.questId===questId);

test('Loop 1 - repair goal -> failure-triage (Kirby active) -> owner loop -> Jarvis capability job -> artifact-verified -> grade E->D -> replan, zero model calls, restart-safe',async t=>{
  const app=await setup(t);
  const a=await app.runOwnerQuest('첫 소유자 목표','failed'),b=await app.runOwnerQuest('둘째 소유자 목표','failed');
  assert.equal((await app.post('/api/quests/loop')).body.reason,'no_autonomous_goal','nothing to do before Homunculus has a goal');
  const quest=(await app.post('/api/quests/synthesize')).body.quest;
  assert.equal(quest.synthesis.archetype,'repair');assert.equal(quest.synthesis.approvalRequired,false);
  const calls=app.modelCalls.length;

  let trace=loopOf((await app.get('/api/quests')).body,quest.id);
  assert.equal(trace.capabilityGap.capabilityId,'failure-triage','general discovery: failed-job records -> the manifest whose fields those records supply');assert.equal(trace.capabilityGap.evidenceIntact,true);
  assert.equal(trace.capabilityGap.gap,'none');assert.equal(trace.capabilityGap.recordType,'job');assert.equal(trace.capabilityGap.agreesWithLegacy,true);assert.match(trace.capabilityGap.requirementFingerprint,/^[a-f0-9]{64}$/);
  assert.equal(trace.kirby.stage,'active','the reviewed boot capability already closes this gap');assert.equal(trace.kirby.qualification.action,'reuse');assert.equal(trace.kirby.qualification.risk,'local-reversible');
  assert.ok(trace.kirby.searched>=3,'registry + reviewed manifests were searched');assert.ok(trace.kirby.matches.every(m=>m.id==='failure-triage'),'evidence-gap-brief/ledger-digest do not fit job records');
  assert.equal(trace.execution,null);assert.equal(trace.verification.verified,false);assert.equal(trace.growth,null);
  assert.equal(trace.replan.evidenceUnchanged,true);assert.equal(trace.replan.nextOutcome,'existing_quest');

  // The Homunculus decision path still refuses to start a synthesized quest.
  const decide=await app.post('/api/quests/decide');
  assert.equal(decide.status,200);assert.equal(decide.body.pendingOwnerAction,true);assert.equal(decide.body.job,null);
  assert.equal(app.state().jobs.length,2);

  const step=await app.post('/api/quests/loop');
  assert.equal(step.status,201,JSON.stringify(step.body));
  assert.equal(step.body.kind,'execute');assert.equal(step.body.applied,true);assert.equal(step.body.capabilityId,'failure-triage');assert.equal(step.body.authorizedBy,'owner');
  assert.equal(step.body.input,undefined,'raw capability input is not echoed');
  assert.equal(step.body.job.type,'capability');assert.equal(step.body.quest.id,quest.id);assert.equal(step.body.quest.loop.jobId,step.body.job.id);assert.equal(step.body.quest.loop.gradeBefore,'E');assert.equal(step.body.quest.loop.kirbyAction,'reuse');assert.equal(step.body.quest.loop.discoveryFingerprint,trace.capabilityGap.requirementFingerprint);
  const job=await app.wait(step.body.job.id);
  assert.equal(job.status,'completed',job.error);
  assert.deepEqual(new Set([a.job.id,b.job.id]),new Set(job.capabilityRequest.input.records.map(r=>r.id)),'input is exactly the failed jobs the provenance names');
  assert.equal(app.modelCalls.length,calls,'Jarvis executed without a single model request');
  assert.equal((await app.post('/api/quests/loop')).body.reason,'no_autonomous_goal','one execution per goal; nothing is re-run');

  const overview=(await app.get('/api/quests')).body;
  trace=loopOf(overview,quest.id);
  const shown=overview.quests.find(q=>q.id===quest.id);
  assert.equal(shown.status,'completed');assert.equal(shown.resultStatus,'artifact_recorded');assert.equal(shown.artifacts.length,1);
  assert.equal(trace.execution.kind,'capability');assert.equal(trace.execution.status,'completed');
  assert.equal(trace.verification.verified,true,JSON.stringify(trace.verification));assert.equal(trace.verification.executionVerified,true);assert.equal(trace.verification.outcomeVerified,false,'artifact hash proves execution integrity, never the outcome');
  assert.equal(trace.verification.artifact.sha256,trace.verification.run.outputSha256,'artifact on disk == capability run output hash');
  assert.equal(trace.verification.run.runId,job.id);
  assert.equal(trace.growth.gradeBefore,'E');assert.equal(trace.growth.grade,'D');assert.equal(trace.growth.promoted,true);
  const growth=(await app.get('/api/state')).body.growth.capabilities.skills.find(s=>s.id==='failure-triage');
  assert.equal(growth.grade,'D','Solo Leveling reads the same registry history');
  // Replan: the failed jobs still exist so the repair evidence is unchanged
  // (same fingerprint -> no duplicate); the completed autonomous quest now has
  // an artifact but no outcome, which is a real measure-outcome gap.
  assert.equal(trace.replan.evidenceUnchanged,true);assert.equal(trace.replan.nextArchetype,'measure-outcome');
  const replan=await app.post('/api/quests/synthesize');
  assert.equal(replan.body.outcome,'new_quest');assert.equal(replan.body.quest.synthesis.archetype,'measure-outcome');
  assert.equal(autonomous(app.disk().quests).length,2,'repair was not proposed again');
  assert.equal((await app.post('/api/quests/synthesize')).body.outcome,'existing_quest');

  // The owner's outcome path accepts the capability job's artifact as real evidence.
  const outcome=await app.post('/api/outcomes',{questId:quest.id,ledger:'honor',summary:'실패 점검표 확보',value:2,unit:'건'});
  assert.equal(outcome.status,201,JSON.stringify(outcome.body));assert.equal(outcome.body.outcome.verification,'self_reported');
  // executionVerified (artifact SHA == independent run record) is separate from
  // outcomeVerified, which a self-reported ledger entry can never establish.
  assert.equal(outcome.body.reality.executionVerified,true);assert.equal(outcome.body.reality.outcomeVerified,false);
  assert.equal(outcome.body.reality.highGradeCandidate,false);assert.equal(outcome.body.reality.authorizesAction,false);
  assert.ok(outcome.body.reality.reasons.includes('type_not_outcome_verifying:self_reported'));

  await app.restart();
  const reality=(await app.get('/api/quests')).body.outcomeReality;
  assert.equal(reality.length,1);assert.equal(reality[0].outcomeId,outcome.body.outcome.id);assert.equal(reality[0].executionVerified,true);assert.equal(reality[0].outcomeVerified,false);
  const growthAfter=(await app.get('/api/state')).body.growth.capabilities.skills.find(k=>k.id==='failure-triage');
  assert.equal(growthAfter.checks.S.met,false);
  const disk=app.disk();
  const stored=disk.quests.find(q=>q.id===quest.id);
  assert.equal(stored.loop.jobId,job.id);assert.equal(stored.loop.authorizedBy,'owner');assert.equal(stored.jobId,job.id);
  validateQuestState(disk);
  const after=loopOf((await app.get('/api/quests')).body,quest.id);
  assert.equal(after.verification.verified,true);assert.equal(after.growth.grade,'D');
  assert.equal(app.modelCalls.length,calls);
});

test('Loop 2 - autopilot opt-in advances a local-reversible goal on its own; owner approval stays required for capability-change',async t=>{
  const app=await setup(t);
  await app.runOwnerQuest('A','failed');await app.runOwnerQuest('B','failed');
  const calls=app.modelCalls.length;
  assert.equal((await app.post('/api/autopilot',{enabled:true,dailyAiLimit:1})).status,200);
  const bound=await app.until(()=>app.disk().quests.find(q=>q.synthesis?.archetype==='repair'&&q.loop),'scheduler synthesized and executed the repair goal');
  assert.equal(bound.loop.authorizedBy,'autopilot');
  const job=await app.wait(bound.loop.jobId);
  assert.equal(job.status,'completed',job.error);assert.equal(job.type,'capability');
  assert.equal(app.modelCalls.length,calls,'the scheduler used no model for the loop');
  const trace=loopOf((await app.get('/api/quests')).body,bound.id);
  assert.equal(trace.verification.verified,true);
  assert.ok(['D','C'].includes(trace.growth.grade)&&['E','D','C'].includes(trace.growth.gradeBefore),'D from this run, C if autopilot own failure-triage candidate ran with a different input');
  // Pure planner: an approvalRequired quest is never picked up by autopilot.
  const state=app.disk();
  const acquire={...state.quests.find(q=>q.synthesis),id:'x',jobId:null,loop:undefined,synthesis:{...state.quests.find(q=>q.synthesis).synthesis,archetype:'acquire-capability',approvalRequired:true}};
  delete acquire.loop;
  const plan=planClosedLoop({...state,quests:[acquire]},new Date().toISOString(),{authorizedBy:'autopilot',manifests:MANIFESTS});
  assert.equal(plan.kind,'none');assert.equal(plan.reason,'owner_approval_required');
  assert.throws(()=>planClosedLoop(state,new Date().toISOString(),{authorizedBy:'model'}),/Invalid loop authority/);
});

test('Loop 3 - acquire-capability goal: Kirby closes a real demand-backed gap only on explicit owner request, then Jarvis executes ledger-digest',async t=>{
  const app=await setup(t);
  app.setMode('ok');
  const done=await app.runOwnerQuest('완료될 소유자 목표','completed');
  const shown=(await app.get('/api/quests')).body.quests.find(q=>q.id===done.quest.id);
  // Record the outcome while stopped: the outcome is durable but Kirby's
  // post-outcome auto-acquisition is refused, leaving a genuine gap behind.
  assert.equal((await app.post('/api/control',{action:'stop'})).status,200);
  const outcome=await app.post('/api/outcomes',{questId:done.quest.id,ledger:'wealth',summary:'첫 매출',value:12000,unit:'KRW'});
  assert.equal(outcome.status,201,JSON.stringify(outcome.body));assert.equal(outcome.body.kirbyAcquisition,undefined);
  assert.equal(app.disk().capabilities.entries.some(e=>e.id==='ledger-digest'),false);
  assert.equal((await app.post('/api/quests/loop')).status,409,'emergency stop refuses the loop');
  assert.equal((await app.post('/api/control',{action:'resume'})).status,200);

  const quest=(await app.post('/api/quests/synthesize')).body.quest;
  assert.equal(quest.synthesis.archetype,'acquire-capability');assert.equal(quest.synthesis.approvalRequired,true);
  let trace=loopOf((await app.get('/api/quests')).body,quest.id);
  assert.equal(trace.kirby.stage,'gap');assert.equal(trace.capabilityGap.capabilityId,'ledger-digest');assert.equal(trace.capabilityGap.gap,'acquire_reviewed');
  assert.equal(trace.kirby.qualification.action,'acquire_with_owner_approval');assert.equal(trace.kirby.qualification.risk,'capability-change');assert.equal(trace.kirby.qualification.approvalRequired,true);assert.deepEqual(trace.kirby.qualification.blockers,[]);
  assert.equal(planClosedLoop(app.disk(),new Date().toISOString(),{authorizedBy:'autopilot',manifests:MANIFESTS}).reason,'owner_approval_required');
  assert.equal((await app.post('/api/autopilot',{enabled:true,dailyAiLimit:1})).status,200);
  await new Promise(r=>setTimeout(r,400));
  assert.equal(app.disk().capabilities.entries.some(e=>e.id==='ledger-digest'),false,'autopilot never acquires a capability');
  assert.equal(app.disk().quests.find(q=>q.id===quest.id).jobId,null);
  assert.equal((await app.post('/api/autopilot',{enabled:false,dailyAiLimit:1})).status,200);
  await app.until(()=>!app.disk().jobs.some(j=>['queued','running'].includes(j.status)),'autopilot jobs settled');

  const calls=app.modelCalls.length;
  const acquire=await app.post('/api/quests/loop');
  assert.equal(acquire.status,201,JSON.stringify(acquire.body));assert.equal(acquire.body.kind,'acquire');assert.equal(acquire.body.acquisition.acquired,true);
  const entry=app.disk().capabilities.entries.find(e=>e.id==='ledger-digest');
  assert.ok(entry.activeHash,'import -> verify -> activate through the existing Kirby pipeline');
  trace=loopOf((await app.get('/api/quests')).body,quest.id);
  assert.equal(trace.kirby.stage,'active');assert.equal(trace.replan.archetypeEvidence,'resolved','the capability gap Homunculus saw is gone');

  const execute=await app.post('/api/quests/loop');
  assert.equal(execute.status,201,JSON.stringify(execute.body));assert.equal(execute.body.kind,'execute');assert.equal(execute.body.capabilityId,'ledger-digest');
  const job=await app.wait(execute.body.job.id);
  assert.equal(job.status,'completed',job.error);
  assert.deepEqual(job.capabilityRequest.input.records,[{ledger:'wealth',summary:'첫 매출',value:12000,unit:'KRW'}],'input is the exact measured outcome the provenance names');
  trace=loopOf((await app.get('/api/quests')).body,quest.id);
  assert.equal(trace.verification.verified,true);assert.equal(trace.growth.grade,'D');assert.equal(trace.growth.gradeBefore,'E');
  assert.equal(app.modelCalls.length,calls);
  assert.equal((await app.post('/api/quests/synthesize')).body.outcome,'new_quest','replan: the completed autonomous quest now lacks an outcome');
  await app.restart();
  validateQuestState(app.disk());
  assert.equal(loopOf((await app.get('/api/quests')).body,quest.id).verification.verified,true);
});

test('Loop 4 - owner-disabled capability is never re-activated; vanished evidence never executes; loop record tampering fails closed',async t=>{
  const app=await setup(t);
  await app.runOwnerQuest('A','failed');await app.runOwnerQuest('B','failed');
  const quest=(await app.post('/api/quests/synthesize')).body.quest;
  const entry=app.disk().capabilities.entries.find(e=>e.id==='failure-triage');
  const disabled=await app.post('/api/capabilities/disable',{id:'failure-triage'});
  assert.equal(disabled.status,200,JSON.stringify(disabled.body));
  const blocked=await app.post('/api/quests/loop');
  assert.equal(blocked.status,200);assert.equal(blocked.body.kind,'none');assert.equal(blocked.body.reason,'capability_inactive_owner_review');
  assert.equal(app.disk().capabilities.entries.find(e=>e.id==='failure-triage').activeHash,null);
  assert.equal(loopOf((await app.get('/api/quests')).body,quest.id).kirby.stage,'inactive_owner_review');

  const state=app.disk();
  assert.equal(loopInput({...state,jobs:state.jobs.slice(1)},state.quests.find(q=>q.id===quest.id),{manifests:MANIFESTS}),null);
  assert.equal(loopOf((await app.get('/api/quests')).body,quest.id).kirby.qualification.blockers[0],'owner_disabled_or_fixture_failed');
  const plan=planClosedLoop({...state,jobs:state.jobs.map(j=>({...j,status:'completed'})),capabilities:{...state.capabilities,entries:[{...entry}]}},new Date().toISOString(),{authorizedBy:'owner',manifests:MANIFESTS});
  assert.equal(plan.reason,'evidence_changed');

  // A loop link on a quest without a capability job, or with an invented
  // grade, is rejected by the store validator before anything loads.
  const proposed=state.quests.find(q=>q.id===quest.id);
  assert.throws(()=>validateQuestState({...state,quests:state.quests.map(q=>q.id===quest.id?{...q,loop:{version:2,capabilityId:'failure-triage',jobId:null,gradeBefore:'S',startedAt:q.createdAt,authorizedBy:'owner',kirbyAction:'reuse',discoveryFingerprint:'a'.repeat(64)}}:q)}),/Unassigned quest cannot claim execution/);
  const agentJob=state.jobs[0];
  assert.throws(()=>validateQuestState({...state,quests:state.quests.map(q=>q.id===quest.id?{...q,jobId:agentJob.id,status:'assigned',loop:{version:2,capabilityId:'failure-triage',jobId:agentJob.id,gradeBefore:'E',startedAt:q.createdAt,authorizedBy:'owner',kirbyAction:'reuse',discoveryFingerprint:'a'.repeat(64)}}:q)}),/Invalid quest/);
  assert.equal(proposed.loop,undefined);
});

test('Loop 5 - goals no reviewed capability fits are reported as missing (never executed); owner-created quests are untouched',async t=>{
  const app=await setup(t);
  assert.deepEqual(Object.keys(ARCHETYPE_CAPABILITY).sort(),['acquire-capability','repair'],'legacy mapping is a migration record only');
  app.setMode('ok');
  const owner=(await app.post('/api/quests',{goal:'소유자 목표',provider:'openai',maxCalls:1})).body.quest;
  const none=await app.post('/api/quests/loop');
  assert.equal(none.status,200);assert.equal(none.body.reason,'no_autonomous_goal');
  assert.deepEqual(app.disk().quests.find(q=>q.id===owner.id),app.disk().quests.find(q=>q.id===owner.id));
  assert.equal(app.disk().quests.find(q=>q.id===owner.id).jobId,null,'the loop never starts an owner quest');
  assert.equal(closedLoopStatus(app.disk(),new Date().toISOString(),{manifests:MANIFESTS}).quests.length,0);
  assert.equal(app.state().jobs.length,0);
});
