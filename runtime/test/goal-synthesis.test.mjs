import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {start} from '../server.mjs';
import {openStore,initialState} from '../lib/store.mjs';
import {observeEvidenceGaps,previewAutonomousGoals,synthesizeAutonomousGoal,SYNTHESIS_ARCHETYPES,ENABLED_ARCHETYPES,MAX_AUTONOMOUS_PROPOSED} from '../lib/goal-synthesis.mjs';
import {validateQuestState,synthesisFingerprint,synthesisQuestId} from '../lib/quests.mjs';
import {detectLedgerDigestGap} from '../lib/kirby.mjs';
import {validateMotivation,DRIVE_IDS} from '../lib/motivation.mjs';

const LEDGER_DIGEST_MANIFEST=JSON.parse(fs.readFileSync(new URL('../capabilities/ledger-digest.json',import.meta.url),'utf8'));
const DECIDE='지금 가장 먼저 해야 할 일을 정해줘';

// Zero model credentials: the only env is the provider selector. Every model
// request is counted so a hidden call fails these tests.
const ZERO_MODEL_ENV={YENO_AGENT_PROVIDER:'auto'};
const MODEL_ENV={YENO_AGENT_PROVIDER:'openai',YENO_OPENAI_API_KEY:'synthetic-openai-key',YENO_OPENAI_MODEL:'synthetic-openai',YENO_AGENT_DAILY_CALL_LIMIT:'4'};
const ok=text=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:text,tool_calls:[]}}],usage:{prompt_tokens:30,completion_tokens:20}}),{headers:{'Content-Type':'application/json'}});

async function setup(t,{env=ZERO_MODEL_ENV,seed}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-goal-synthesis-')),token='synthetic-goal-synthesis-owner-token';
  if(seed){const store=openStore(dir);seed(store.state);store.save();}
  const modelCalls=[];let mode='fail';
  const agentFetch=async(url,req)=>{modelCalls.push({url,body:JSON.parse(req.body)});if(mode==='fail')throw new Error('synthetic provider outage');return ok('합성 산출물 본문');};
  let runtime=await start({host:'127.0.0.1',port:0,dataDir:dir,token,env,agentFetch});
  const request=async(method,route,body)=>{const r=await fetch(`http://127.0.0.1:${runtime.server.address().port}${route}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
  const post=(route,body={})=>request('POST',route,{requestId:randomUUID(),...body});
  const get=route=>request('GET',route);
  const wait=async(id,statuses=['completed','failed','paused'])=>{for(let i=0;i<300;i++){const j=runtime.state().jobs.find(j=>j.id===id);if(j&&statuses.includes(j.status))return j;await new Promise(r=>setTimeout(r,20));}assert.fail('job did not reach target state');};
  const restart=async()=>{runtime.shutdown();runtime=await start({host:'127.0.0.1',port:0,dataDir:dir,token,env,agentFetch});};
  // Real evidence through the normal owner path: save a goal, press Run, let
  // the provider genuinely fail (or succeed) - never a hand-written job record.
  const runOwnerQuest=async(goal,expected)=>{const quest=(await post('/api/quests',{goal,provider:'openai',maxCalls:1})).body.quest;const run=await post(`/api/quests/${quest.id}/run`);assert.equal(run.status,201,JSON.stringify(run.body));const job=await wait(run.body.job.id);assert.equal(job.status,expected,job.error);return {quest,job};};
  t.after(()=>{runtime.shutdown();fs.rmSync(dir,{recursive:true,force:true});});
  return {dir,post,get,wait,restart,runOwnerQuest,modelCalls,setMode:next=>{mode=next;},state:()=>runtime.state(),quests:()=>openStore(dir).state.quests};
}
const autonomous=quests=>quests.filter(q=>q.synthesis);

test('Test 1+5 - two real failed jobs -> exactly one autonomous proposed quest, evidence-backed, zero model credentials, no auto-run',async t=>{
  const app=await setup(t,{env:MODEL_ENV});
  assert.equal((await app.post('/api/quests/synthesize')).body.outcome,'no_actionable_evidence','a fresh runtime must not invent work');
  const a=await app.runOwnerQuest('첫 소유자 목표','failed'),b=await app.runOwnerQuest('둘째 소유자 목표','failed');
  assert.equal(app.modelCalls.length,2,'the two owner runs are the only model requests');
  const before=app.state().revision;
  const result=await app.post('/api/quests/synthesize');
  assert.equal(result.status,201);assert.equal(result.body.outcome,'new_quest');assert.equal(result.body.persisted,true);
  const quest=result.body.quest;
  assert.equal(quest.status,'proposed');assert.equal(quest.jobId,null,'synthesis grants no execution');
  assert.equal(quest.synthesis.archetype,'repair');assert.equal(quest.synthesis.riskClass,'local-reversible');assert.equal(quest.synthesis.approvalRequired,false);
  assert.deepEqual(quest.synthesis.evidence[0].references.map(r=>r.id).sort(),[a.job.id,b.job.id].sort(),'provenance names the exact failed jobs');
  assert.deepEqual(quest.synthesis.evidence[0].values,{failedJobs:2});
  assert.equal(quest.synthesis.sourceEvidenceFingerprint,synthesisFingerprint('repair',quest.synthesis.evidence));
  assert.equal(quest.id,synthesisQuestId(quest.synthesis.sourceEvidenceFingerprint));assert.equal(quest.synthesis.autonomousGoalId,quest.id);
  validateMotivation(quest.synthesis.motivation);
  assert.deepEqual(quest.synthesis.motivation.dominantDrives.slice(0,1),['wrath'],'repeated failure is argued by wrath');
  assert.equal(quest.driveId,quest.synthesis.motivation.dominantDrives[0]);
  assert.ok(quest.synthesis.motivation.signals.repairNeed>0);
  assert.equal(app.modelCalls.length,2,'synthesis itself made no model request');
  assert.equal(app.state().jobs.length,2,'no job was started for the autonomous quest');
  assert.ok(app.state().revision>before);
  const disk=app.quests();assert.equal(autonomous(disk).length,1);assert.equal(disk.filter(q=>q.status==='proposed').length,1);
  const overview=(await app.get('/api/quests')).body;
  assert.equal(overview.decision.top.questId,quest.id,'the existing Homunculus ranking now has a real candidate');
  assert.equal(overview.autonomous.candidates[0].existingQuestId,quest.id);
});

test('Test 5 - synthesis functions with no provider credentials at all',async t=>{
  const app=await setup(t,{seed:s=>{s.jobs.push(job('a'),job('b'));}});
  const result=await app.post('/api/quests/synthesize');
  assert.equal(result.status,201,JSON.stringify(result.body));assert.equal(result.body.quest.synthesis.archetype,'repair');
  assert.equal(app.modelCalls.length,0);assert.equal(app.state().agent.configured,false);
  assert.equal((await app.get('/api/quests')).body.autonomous.candidates.length,1);
});

test('Test 2+11 - repeated observation and polling return the same quest with no growth',async t=>{
  const app=await setup(t,{env:MODEL_ENV});
  await app.runOwnerQuest('A','failed');await app.runOwnerQuest('B','failed');
  const first=(await app.post('/api/quests/synthesize')).body;assert.equal(first.outcome,'new_quest');
  for(let i=0;i<25;i++){
    const again=await app.post('/api/quests/synthesize');
    assert.equal(again.status,200);assert.equal(again.body.outcome,'existing_quest');assert.equal(again.body.quest.id,first.quest.id);
    assert.equal((await app.get('/api/quests')).body.total,3);
  }
  assert.equal(autonomous(app.quests()).length,1);
});

test('Test 3+11 - real restart preserves quest, provenance and identity; re-synthesis after restart adds nothing',async t=>{
  const app=await setup(t,{env:MODEL_ENV});
  await app.runOwnerQuest('A','failed');await app.runOwnerQuest('B','failed');
  const created=(await app.post('/api/quests/synthesize')).body.quest;
  for(let round=0;round<3;round++){
    await app.restart();
    const stored=app.quests().find(q=>q.id===created.id);
    assert.ok(stored,'autonomous quest survives restart');
    assert.deepEqual(stored.synthesis,created.synthesis);assert.equal(stored.status,'proposed');
    const again=await app.post('/api/quests/synthesize');assert.equal(again.body.outcome,'existing_quest');assert.equal(again.body.quest.id,created.id);
    await app.post('/api/quests/synthesize');
    assert.equal(autonomous(app.quests()).length,1);assert.equal(app.quests().length,3);
  }
  assert.equal(app.modelCalls.length,2);
});

test('Test 4 - material evidence change may add one different justified goal; time and revision alone add nothing',async t=>{
  const app=await setup(t,{env:MODEL_ENV});
  await app.runOwnerQuest('A','failed');await app.runOwnerQuest('B','failed');
  const repair=(await app.post('/api/quests/synthesize')).body.quest;assert.equal(repair.synthesis.archetype,'repair');
  // Revision churn without evidence change: memories are unrelated durable state.
  for(let i=0;i<3;i++)assert.equal((await app.post('/api/memory',{text:`무관한 기록 ${i}`})).status,201);
  assert.equal((await app.post('/api/quests/synthesize')).body.outcome,'existing_quest');
  // Pure module check: a later clock and a different revision never change the fingerprint.
  const later=synthesizeAutonomousGoal({...openStore(app.dir).state,revision:999999},'2036-01-01T00:00:00.000Z');
  assert.equal(later.outcome,'existing_quest');assert.equal(later.quest.id,repair.id);
  // Material change: a completed goal with a verified artifact but no outcome measurement.
  app.setMode('ok');const done=await app.runOwnerQuest('C','completed');
  const measure=(await app.post('/api/quests/synthesize')).body;
  assert.equal(measure.outcome,'new_quest');assert.equal(measure.quest.synthesis.archetype,'measure-outcome');
  assert.deepEqual(measure.quest.synthesis.evidence[0].references,[{type:'quest',id:done.quest.id}]);
  assert.notEqual(measure.quest.id,repair.id);
  assert.equal((await app.post('/api/quests/synthesize')).body.outcome,'existing_quest');
  assert.equal(autonomous(app.quests()).length,2);
  // A third failure changes the repair evidence, but the still-proposed repair quest bounds the archetype.
  app.setMode('fail');await app.runOwnerQuest('D','failed');
  const bounded=await app.post('/api/quests/synthesize');
  assert.notEqual(bounded.body.outcome,'new_quest');assert.equal(autonomous(app.quests()).length,2);
  assert.ok(app.quests().find(q=>q.id===repair.id),'the earlier repair quest is untouched');
});

test('Test 6 - owner quests are preserved byte-for-byte and never confused with autonomous provenance',async t=>{
  const app=await setup(t,{env:MODEL_ENV});
  await app.runOwnerQuest('A','failed');await app.runOwnerQuest('B','failed');
  const owner=(await app.post('/api/quests',{goal:'소유자가 직접 쓴 목표 문장',drive:'lust',maxCalls:2})).body.quest;
  // BLOCKER 1: while the owner's own quest is still proposed, evidence is
  // previewed but nothing autonomous is persisted - an explicit gate, not a score.
  let before=app.quests();
  for(let i=0;i<3;i++){
    const blocked=await app.post('/api/quests/synthesize');
    assert.equal(blocked.status,200);assert.equal(blocked.body.outcome,'owner_quest_pending');assert.equal(blocked.body.persisted,false);assert.equal(blocked.body.quest,null);
    assert.equal(blocked.body.candidates.length,1,'the repair evidence is still observed and shown');
    assert.deepEqual(blocked.body.ownerProposedQuestIds,[owner.id]);
  }
  assert.deepEqual(app.quests(),before,'the store is byte-for-byte unchanged while the owner quest is pending');
  assert.equal(autonomous(app.quests()).length,0);
  assert.equal((await app.get('/api/quests')).body.autonomous.ownerProposedQuestIds.length,1);
  await app.restart();
  assert.equal((await app.post('/api/quests/synthesize')).body.outcome,'owner_quest_pending');
  // Once the owner has dealt with their quest (here: run it), synthesis resumes.
  const run=await app.post(`/api/quests/${owner.id}/run`);assert.equal(run.status,201);await app.wait(run.body.job.id);
  assert.notEqual(app.quests().find(q=>q.id===owner.id).status,'proposed');
  before=app.quests();
  const result=(await app.post('/api/quests/synthesize')).body;assert.equal(result.outcome,'new_quest');
  const after=app.quests();
  for(const q of before)assert.deepEqual(after.find(item=>item.id===q.id),q,'every pre-existing quest is unchanged');
  assert.equal(after.length,before.length+1);
  const stored=after.find(q=>q.id===owner.id);
  assert.equal(stored.synthesis,undefined);assert.equal(stored.goal,'소유자가 직접 쓴 목표 문장');assert.equal(stored.driveId,'lust');
  assert.equal(autonomous(after).length,1);
  // A caller can never smuggle provenance through the owner Quest contract.
  const smuggled=await app.post('/api/quests',{goal:'가짜 자율 목표',synthesis:{archetype:'repair'}});
  assert.equal(smuggled.status,400);
  // A new owner quest again takes absolute priority; the existing autonomous
  // quest is kept, ranked alongside, but no second one is added.
  const second=(await app.post('/api/quests',{goal:'또 하나의 소유자 목표'})).body.quest;
  assert.equal((await app.post('/api/quests/synthesize')).body.outcome,'owner_quest_pending');
  const overview=(await app.get('/api/quests')).body;
  assert.equal(overview.decision.candidates.length,2,'Homunculus ranks the owner quest and the autonomous quest together');
  assert.ok(overview.quests.some(q=>q.id===second.id&&q.status==='proposed'));
});

test('BLOCKER 2 - a synthesized quest never auto-runs through Homunculus decision, even with a configured provider; explicit owner run still works',async t=>{
  const app=await setup(t,{env:MODEL_ENV,seed:s=>{s.modules.ai=true;}});
  await app.runOwnerQuest('A','failed');await app.runOwnerQuest('B','failed');
  assert.equal(app.state().agent.configured,true,'provider is configured - absence cannot be what blocks execution');
  const synthesized=(await app.post('/api/quests/synthesize')).body;assert.equal(synthesized.outcome,'new_quest');
  const quest=synthesized.quest;const calls=app.modelCalls.length,jobs=app.state().jobs.length;
  app.setMode('ok');
  const overview=(await app.get('/api/quests')).body;
  assert.equal(overview.decision.top.questId,quest.id,'the autonomous quest is the only proposed quest and wins the ranking');
  for(let i=0;i<2;i++){
    const decided=await app.post('/api/quests/decide');
    assert.equal(decided.status,200,JSON.stringify(decided.body));
    assert.equal(decided.body.pendingOwnerAction,true);assert.equal(decided.body.job,null);assert.equal(decided.body.quest.id,quest.id);assert.equal(decided.body.quest.status,'proposed');
    assert.equal(decided.body.decision.top.questId,quest.id,'the decision itself is still reported');
  }
  const voice=await app.post('/api/voice',{text:DECIDE,history:[]});
  assert.equal(voice.status,200,JSON.stringify(voice.body));assert.equal(voice.body.pendingOwnerAction,true);assert.equal(voice.body.jobId,null);assert.equal(voice.body.job,null);
  assert.equal(voice.body.decision.goal,quest.goal);assert.ok(voice.body.decision.announcement);
  assert.equal(app.state().jobs.length,jobs,'no job was created');assert.equal(app.modelCalls.length,calls,'no model call');
  assert.equal(app.quests().find(q=>q.id===quest.id).status,'proposed');assert.equal(app.quests().find(q=>q.id===quest.id).jobId,null);
  await app.restart();
  assert.equal((await app.post('/api/quests/decide')).body.pendingOwnerAction,true);
  assert.equal(app.state().jobs.length,jobs);
  // The owner's explicit Run is the one and only authorization path.
  const run=await app.post(`/api/quests/${quest.id}/run`);
  assert.equal(run.status,201,JSON.stringify(run.body));assert.ok(run.body.job.id);
  const finished=await app.wait(run.body.job.id);assert.equal(finished.status,'completed',finished.error);
  assert.equal(app.modelCalls.length,calls+1);
  assert.equal(app.quests().find(q=>q.id===quest.id).jobId,run.body.job.id,'the owner-started job is bound to the autonomous quest');
  assert.notEqual(app.quests().find(q=>q.id===quest.id).status,'proposed');
  // An owner-written proposed quest is still decided AND run exactly as before.
  const owner=(await app.post('/api/quests',{goal:'소유자 이어서 할 일',provider:'openai',maxCalls:1})).body.quest;
  const decided=await app.post('/api/quests/decide');
  assert.equal(decided.status,201,JSON.stringify(decided.body));assert.equal(decided.body.pendingOwnerAction,undefined);assert.ok(decided.body.job.id);
  assert.equal((await app.wait(decided.body.job.id)).status,'completed');assert.equal(app.quests().find(q=>q.id===owner.id).jobId,decided.body.job.id);
});

test('HIGH - acquire-capability needs Kirby demand evidence; inactive-but-not-demanded capability, owner pauses and ordinary active projects create no goal',async t=>{
  const at='2026-09-15T00:00:00.000Z';const manifests=[LEDGER_DIGEST_MANIFEST];
  // Inactive ledger-digest with stored versions but zero measured outcomes: no demand, no goal.
  const idle=initialState();
  idle.capabilities.entries.push({id:LEDGER_DIGEST_MANIFEST.id,name:LEDGER_DIGEST_MANIFEST.name,activeHash:null,versions:[{hash:'a'.repeat(64),manifest:LEDGER_DIGEST_MANIFEST,importedAt:at,verification:{passed:false}}],history:[]});
  assert.equal(detectLedgerDigestGap(idle,LEDGER_DIGEST_MANIFEST),null);
  assert.deepEqual(observeEvidenceGaps(idle,{manifests}),[]);
  assert.equal(synthesizeAutonomousGoal(idle,at,{manifests}).outcome,'no_actionable_evidence');
  // Two unrelated owner-paused jobs: observer disabled, no goal.
  const paused=initialState();paused.jobs.push({...job('c'),status:'paused',pauseReason:'owner'},{...job('d'),status:'paused',pauseReason:'owner'});
  assert.deepEqual(observeEvidenceGaps(paused,{manifests}),[]);
  assert.equal(synthesizeAutonomousGoal(paused,at,{manifests}).outcome,'no_actionable_evidence');
  // An ordinary active project with no jobs yet: no premature refresh goal.
  const active=initialState();active.projects.push(project('p'),project('q'));
  assert.deepEqual(observeEvidenceGaps(active,{manifests}),[]);
  assert.equal(synthesizeAutonomousGoal(active,at,{manifests}).outcome,'no_actionable_evidence');
  assert.deepEqual([...ENABLED_ARCHETYPES],['repair','verify','acquire-capability','measure-outcome']);
  // Real demand comes only from a real persisted measured outcome, produced through the normal owner path.
  const app=await setup(t,{env:MODEL_ENV});
  app.setMode('ok');const done=await app.runOwnerQuest('측정 대상 작업','completed');
  assert.equal((await app.post('/api/outcomes',{questId:done.quest.id,ledger:'fame',summary:'측정',value:3,unit:'건'})).status,201);
  const real=openStore(app.dir).state;const outcomeId=real.outcomes[0].id;
  // The runtime's Kirby already acquired ledger-digest here; model the not-yet-acquired / disabled case from that real state.
  const demanded=structuredClone(real);demanded.capabilities.entries=demanded.capabilities.entries.filter(e=>e.id!==LEDGER_DIGEST_MANIFEST.id);
  assert.ok(detectLedgerDigestGap(demanded,LEDGER_DIGEST_MANIFEST));
  const gaps=observeEvidenceGaps(demanded,{manifests});
  assert.deepEqual(gaps.map(g=>g.archetype),['acquire-capability']);
  assert.deepEqual(gaps[0].evidence[0].values,{capabilities:[LEDGER_DIGEST_MANIFEST.id],measuredOutcomes:1});
  assert.deepEqual(gaps[0].evidence[0].references,[{type:'capability',id:LEDGER_DIGEST_MANIFEST.id},{type:'outcome',id:outcomeId}]);
  const plan=synthesizeAutonomousGoal(demanded,at,{manifests});
  assert.equal(plan.outcome,'new_quest');assert.equal(plan.quest.synthesis.riskClass,'capability-change');assert.equal(plan.quest.synthesis.approvalRequired,true);
  assert.equal(plan.quest.status,'proposed');assert.equal(plan.quest.jobId,null);
  assert.equal(plan.candidates[0].approvalRequired,true);
  // The stored provenance must carry exactly that risk/approval pair; both false and mismatched are refused.
  const check=mutate=>{const q=structuredClone(plan.quest);mutate(q);assert.throws(()=>validateQuestState({...demanded,quests:[q,...demanded.quests]}));};
  check(q=>{q.synthesis.approvalRequired=false;});check(q=>{q.synthesis.riskClass='local-reversible';});
  validateQuestState({...demanded,quests:[plan.quest,...demanded.quests]});
  // Same demand, but the capability is present yet deliberately inactive: Kirby still reports the gap, identity is unchanged.
  const disabled=structuredClone(real);disabled.capabilities.entries.find(e=>e.id===LEDGER_DIGEST_MANIFEST.id).activeHash=null;
  assert.equal(synthesizeAutonomousGoal(disabled,at,{manifests}).quest.id,plan.quest.id);
  // Without the manifest list (nothing reviewed to acquire) there is no candidate at all.
  assert.deepEqual(observeEvidenceGaps(demanded),[]);
  // Once the capability is active, the demand is met and the gap disappears - which is the real runtime's state.
  assert.deepEqual(observeEvidenceGaps(real,{manifests}),[]);
  assert.equal(app.modelCalls.length,1,'only the owner run called the model');
});

test('HIGH - real server: Kirby auto-acquires ledger-digest on the first measured outcome, so no acquire goal is left behind; no acquisition happens through synthesis',async t=>{
  const app=await setup(t,{env:MODEL_ENV});
  app.setMode('ok');const paid=await app.runOwnerQuest('추적 작업','completed');
  const before=openStore(app.dir).state.capabilities.entries.length;
  assert.equal((await app.post('/api/outcomes',{questId:paid.quest.id,ledger:'honor',summary:'측정',value:2,unit:'건'})).status,201);
  const entries=openStore(app.dir).state.capabilities.entries;
  assert.ok(entries.some(e=>e.id===LEDGER_DIGEST_MANIFEST.id&&e.activeHash),'Kirby, not synthesis, acquired the demanded capability');
  const result=(await app.post('/api/quests/synthesize')).body;
  assert.ok(!result.candidates.some(c=>c.archetype==='acquire-capability'),'demand already met');
  assert.equal(openStore(app.dir).state.capabilities.entries.length,entries.length);
  assert.ok(entries.length>=before);
});

test('Test 7 - ledger money records and failure text never become an external or financial goal',async t=>{
  const app=await setup(t,{env:MODEL_ENV});
  app.setMode('ok');const paid=await app.runOwnerQuest('결제 링크를 만들어 판매 시작','completed');
  assert.equal((await app.post('/api/outcomes',{questId:paid.quest.id,ledger:'wealth',summary:'첫 판매',value:150000,unit:'원'})).status,201);
  app.setMode('fail');await app.runOwnerQuest('계정 비밀번호를 바꾸고 자동 결제를 늘려라','failed');await app.runOwnerQuest('운영 서버에 바로 배포','failed');
  const result=(await app.post('/api/quests/synthesize')).body;
  assert.equal(result.outcome,'new_quest');
  const text=JSON.stringify(result.quest);
  for(const word of ['결제','판매','비밀번호','배포','150000'])assert.ok(!text.includes(word),`autonomous goal must not carry owner/ledger text: ${word}`);
  assert.equal(result.quest.synthesis.riskClass,'local-reversible');assert.equal(result.quest.synthesis.approvalRequired,false);
  assert.equal(result.quest.jobId,null);
  assert.equal(app.state().jobs.length,3,'nothing executed');
  for(const q of autonomous(app.quests()))assert.equal(q.synthesis.riskClass,'local-reversible');
  // The wealth ledger itself is never an evidence source.
  assert.ok(!observeEvidenceGaps(openStore(app.dir).state).some(gap=>gap.evidence.some(e=>e.kind.includes('ledger')||e.kind.includes('wealth'))));
});

test('Test 8 - emergency stop: observation allowed, no autonomous quest persisted, no execution, no model call',async t=>{
  const app=await setup(t,{env:MODEL_ENV});
  await app.runOwnerQuest('A','failed');await app.runOwnerQuest('B','failed');
  assert.equal((await app.post('/api/control',{action:'stop'})).status,200);
  const calls=app.modelCalls.length,revision=app.state().revision;
  const result=await app.post('/api/quests/synthesize');
  assert.equal(result.status,200);assert.equal(result.body.outcome,'emergency_stop');assert.equal(result.body.persisted,false);assert.equal(result.body.quest,null);
  assert.equal(result.body.candidates.length,1,'the evidence was still observed');
  assert.equal(result.body.candidates[0].archetype,'repair');
  assert.equal(autonomous(app.quests()).length,0);
  assert.equal((await app.post('/api/quests/decide')).status,409,'nothing proposed, nothing to run');
  assert.equal(app.modelCalls.length,calls);assert.equal(app.state().jobs.length,2);
  assert.equal(openStore(app.dir).state.capabilities.entries.length,2,'no capability acquisition beyond the two boot defaults');
  await app.restart();
  assert.equal(autonomous(app.quests()).length,0);assert.equal(app.state().emergencyStop,true);
  assert.equal((await app.post('/api/quests/synthesize')).body.outcome,'emergency_stop');
  assert.equal((await app.post('/api/control',{action:'resume',revision:app.state().revision})).status,200);
  assert.equal((await app.post('/api/quests/synthesize')).body.outcome,'new_quest');
  assert.equal(app.modelCalls.length,calls);
});

test('Test 9 - corrupt provenance or invalid state fails closed',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-goal-synthesis-corrupt-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=openStore(dir);const s=store.state;
  s.jobs.push(job('a'),job('b'));
  const plan=synthesizeAutonomousGoal(s,'2026-09-15T00:00:00.000Z');assert.equal(plan.outcome,'new_quest');
  const tamper=(mutate)=>{const copy=structuredClone(s);const q=structuredClone(plan.quest);mutate(q);copy.quests=[q];assert.throws(()=>validateQuestState(copy));};
  tamper(q=>{q.synthesis.evidence[0].values.failedJobs=99;});
  tamper(q=>{q.synthesis.evidence[0].references.pop();});
  tamper(q=>{q.synthesis.archetype='verify';});
  tamper(q=>{q.synthesis.sourceEvidenceFingerprint='0'.repeat(64);});
  tamper(q=>{q.id=randomUUID();});
  tamper(q=>{q.synthesis.approvalRequired=true;});
  tamper(q=>{q.synthesis.riskClass='external';});
  tamper(q=>{q.synthesis.riskClass='capability-change';});
  tamper(q=>{q.synthesis.riskClass='capability-change';q.synthesis.approvalRequired=true;});
  tamper(q=>{q.synthesis.motivation.score+=1;});
  tamper(q=>{q.goal='바꿔 쓴 목표';});
  tamper(q=>{q.synthesis.createdAt='2030-01-01T00:00:00.000Z';});
  tamper(q=>{delete q.synthesis.reason;});
  tamper(q=>{q.synthesis.extra=true;});
  // Malformed state is not evidence: nothing is observed or built.
  assert.throws(()=>observeEvidenceGaps({quests:'nope'}));
  assert.throws(()=>synthesizeAutonomousGoal({...s,quests:[{id:'x'}]},'2026-09-15T00:00:00.000Z'));
  // A store carrying a tampered autonomous quest refuses to load at all.
  s.quests.unshift(plan.quest);store.save();
  assert.equal(openStore(dir).state.quests.length,1);
  const raw=JSON.parse(fs.readFileSync(path.join(dir,'state.json'),'utf8'));const payload=JSON.parse(raw.payload);
  payload.quests[0].synthesis.evidence[0].values.failedJobs=5;
  const {digest}=await import('../lib/store.mjs');const text=JSON.stringify(payload);
  fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({format:1,sha256:digest(text),payload:text}));
  assert.throws(()=>openStore(dir),/unreadable/,'the tampered store is refused rather than loaded with a fabricated goal');
});

test('Test 10 - a fresh valid system with no evidence gap synthesizes nothing',async t=>{
  const app=await setup(t);
  for(let i=0;i<5;i++){const r=await app.post('/api/quests/synthesize');assert.equal(r.status,200);assert.equal(r.body.outcome,'no_actionable_evidence');assert.equal(r.body.candidates.length,0);}
  await app.restart();
  assert.equal((await app.post('/api/quests/synthesize')).body.outcome,'no_actionable_evidence');
  assert.equal(app.quests().length,0);assert.equal(app.modelCalls.length,0);
  assert.deepEqual(observeEvidenceGaps(initialState()),[]);
});

test('archetype set is fixed, one failure is not a pattern, and accumulation is bounded',()=>{
  assert.deepEqual([...SYNTHESIS_ARCHETYPES],['repair','verify','acquire-capability','refresh-evidence','measure-outcome','reduce-owner-intervention']);
  assert.equal(MAX_AUTONOMOUS_PROPOSED,6);
  const s=initialState();s.jobs.push(job('a'));
  assert.equal(synthesizeAutonomousGoal(s,'2026-09-15T00:00:00.000Z').outcome,'no_actionable_evidence');
  s.jobs.push(job('b'));s.projects.push(project('p'));
  s.jobs.push({...job('c'),status:'paused',pauseReason:'owner'},{...job('d'),status:'paused',pauseReason:'owner'});
  const manifests=[LEDGER_DIGEST_MANIFEST];
  const preview=previewAutonomousGoals(s,'2026-09-15T00:00:00.000Z',{manifests});
  assert.deepEqual(preview.candidates.map(c=>c.archetype),['repair'],'paused jobs and idle projects produce nothing');
  for(const c of preview.candidates){validateMotivation(c.motivation);assert.ok(c.motivation.dominantDrives.every(id=>DRIVE_IDS.includes(id)));}
  // Every archetype at once still yields exactly one quest per synthesis call, and at most one proposed quest per archetype.
  let state=s,created=0;
  for(let i=0;i<20;i++){const plan=synthesizeAutonomousGoal(state,'2026-09-15T00:00:00.000Z',{manifests});if(plan.outcome!=='new_quest')break;created++;state={...state,quests:[plan.quest,...state.quests]};}
  assert.equal(created,1);
  assert.equal(synthesizeAutonomousGoal(state,'2026-09-15T00:00:00.000Z',{manifests}).outcome,'existing_quest');
});

function job(seed){const at='2026-09-15T00:00:00.000Z';return {id:`0000000${seed.charCodeAt(0)%10}-${seed.charCodeAt(0).toString(16).padStart(4,'0')}-4000-8000-000000000000`,type:'agent',title:`job ${seed}`,text:'x',status:'failed',error:'synthetic',createdAt:at,updatedAt:at,version:1,step:0,artifacts:[]};}
function project(seed){const at='2026-09-15T00:00:00.000Z';return {id:`1000000${seed.charCodeAt(0)%10}-${seed.charCodeAt(0).toString(16).padStart(4,'0')}-4000-8000-000000000000`,name:`프로젝트 ${seed}`,repositoryUrl:'',summary:'요약',nextAction:'다음',status:'active',version:1,createdAt:at,updatedAt:at};}
