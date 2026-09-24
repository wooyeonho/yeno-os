import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {start} from '../server.mjs';
import {openStore} from '../lib/store.mjs';
import {exportBackup,restoreBackup} from '../lib/backup.mjs';
import {JEV_RECOVERY_VERSION, validateJevRecoveryLog} from '../lib/jev-recovery.mjs';

const ok = text => new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:text,tool_calls:[]}}],usage:{prompt_tokens:30,completion_tokens:20}}),{headers:{'Content-Type':'application/json'}});

async function setup(t,{env={},enableAi=false,agentResponse=()=> 'synthetic Shadow artifact'}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-jev-recovery-'));
  const token='synthetic-jev-recovery-owner-token';
  if(enableAi){const seed=openStore(dir);seed.state.modules.ai=true;seed.save();}
  const modelCalls=[];
  const agentFetch=async(url,request)=>{
    const body=JSON.parse(request.body);
    const call={url,body,headers:request.headers};
    modelCalls.push(call);
    return ok(agentResponse(call));
  };
  let runtime=await start({host:'127.0.0.1',port:0,dataDir:dir,token,env,agentFetch});
  const request=async(method,route,body)=>{
    const response=await fetch(`http://127.0.0.1:${runtime.server.address().port}${route}`,{
      method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,body:await response.json()};
  };
  const post=(route,body={})=>request('POST',route,{requestId:randomUUID(),...body});
  const get=route=>request('GET',route);
  const wait=async(id,statuses=['completed','failed','paused'])=>{
    for(let i=0;i<400;i++){
      const job=openStore(dir).state.jobs.find(item=>item.id===id);
      if(job&&statuses.includes(job.status))return job;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    const state=openStore(dir).state;
    assert.fail(`job ${id} did not reach ${statuses.join('/')}: ${JSON.stringify({job:state.jobs.find(item=>item.id===id),events:state.events.slice(0,12)})}`);
  };
  const until=async(check,label)=>{
    for(let i=0;i<400;i++){const value=check();if(value)return value;await new Promise(resolve=>setTimeout(resolve,20));}
    assert.fail(label);
  };
  const restart=async()=>{runtime.shutdown();runtime=await start({host:'127.0.0.1',port:0,dataDir:dir,token,env,agentFetch});};
  t.after(()=>{runtime.shutdown();fs.rmSync(dir,{recursive:true,force:true});});
  const disk=()=>{const store=openStore(dir);assert.equal(store.recovered,false,'test read must not silently fall back to an older backup');return store.state;};
  return {dir,post,get,wait,until,restart,modelCalls,disk};
}

async function createProject(h){
  const response=await h.post('/api/projects',{name:`JEV recovery ${randomUUID().slice(0,8)}`,status:'active'});
  assert.equal(response.status,201,JSON.stringify(response.body));
  return response.body.project;
}

test('blocked Shadow job records inconclusive JEV recovery evidence and preserves it across restart without a local verifier',async t=>{
  const h=await setup(t,{env:{}});
  const project=await createProject(h);
  const response=await h.post('/api/shadow-army/missions',{projectId:project.id,goal:'막힌 임무의 원인을 남긴다'});
  assert.equal(response.status,201,JSON.stringify(response.body));
  const missionId=response.body.missionId;
  const scoutId=response.body.mission.shadows.find(item=>item.role==='scout').jobId;
  const scout=await h.wait(scoutId,['paused']);
  assert.equal(scout.pauseReason,'providerMissing');
  const before=h.disk().jevRecoveryLog;
  validateJevRecoveryLog(before);
  const decision=before.find(item=>item.missionId===missionId&&item.blocker.evidenceRefs.some(ref=>ref.id===scoutId));
  assert.ok(decision);
  assert.equal(decision.version,JEV_RECOVERY_VERSION);
  assert.equal(decision.decisionStatus,'uncertain');
  assert.deepEqual(decision.recommendedAlternativeIds,[]);
  assert.equal(decision.authorizesDispatch,false);
  assert.equal((await h.get('/api/state')).body.jev.recoveryAuthorizesDispatch,false);
  assert.equal(h.modelCalls.length,0);
  await h.restart();
  assert.deepEqual(h.disk().jevRecoveryLog,before);
  assert.equal(h.disk().jobs.find(item=>item.id===scoutId).status,'paused');
});

test('voice-selected mission records its blocker, asks the local JEV verifier, and never dispatches the suggested alternative',async t=>{
  const env={YENO_AGENT_PROVIDER:'openai',YENO_OPENAI_MODEL:'unavailable-primary',YENO_LOCAL_MODEL:'qwen2.5:3b',YENO_LOCAL_BASE_URL:'http://127.0.0.1:11434/v1/chat/completions',YENO_AGENT_DAILY_CALL_LIMIT:'20'};
  const agentResponse=({body})=>{
    const system=body.messages.find(message=>message.role==='system')?.content??'';
    assert.match(system,/independent JEV recovery verifier/);
    const user=body.messages.find(message=>message.role==='user')?.content??'';
    const marker='검토 입력:';const start=user.indexOf(marker);assert.ok(start>=0);
    const packet=JSON.parse(user.slice(start+marker.length).trim());
    return JSON.stringify({alternatives:packet.alternatives.map(alternative=>({alternativeId:alternative.id,objectiveFit:'PASS',preconditions:'PASS',
      evidenceRefs:alternative.evidenceRefs,reason:'소유자 검토 단계이며 외부 효과나 임무 실행을 하지 않는다.'}))});
  };
  const h=await setup(t,{env,enableAi:true,agentResponse});
  const project=await createProject(h);
  const questResponse=await h.post('/api/quests',{projectId:project.id,goal:'막힌 작업의 다음 단계를 정한다',
    successCriterion:'차단 근거와 안전한 다음 단계를 기록한다',baseline:'확인 전'});
  assert.equal(questResponse.status,201,JSON.stringify(questResponse.body));
  const voice=await h.post('/api/voice',{text:'지금 가장 먼저 해야 할 일을 정해줘',history:[]});
  assert.equal(voice.status,201,JSON.stringify(voice.body));
  assert.ok(voice.body.missionId,JSON.stringify(voice.body));
  const missionId=voice.body.missionId;
  const scoutId=voice.body.mission.shadows.find(item=>item.role==='scout').jobId;
  const scout=await h.wait(scoutId,['paused']);
  assert.equal(scout.pauseReason,'providerMissing');
  const verifier=await h.until(()=>h.disk().jobs.find(job=>job.jevRecoveryVerificationRequest?.missionId===missionId),'local JEV verifier job was not queued');
  assert.equal(verifier.selectedProvider,'local');
  const blockedJobId=verifier.jevRecoveryVerificationRequest.blockedJobId;
  const blockedJob=h.disk().jobs.find(job=>job.id===blockedJobId);
  assert.equal(blockedJob?.status,'paused','JEV reviews an actually blocked job');
  assert.equal(blockedJob?.shadowAssignment?.missionId,missionId);
  const completed=await h.wait(verifier.id,['completed','failed']);
  assert.equal(completed.status,'completed',completed.error);
  assert.equal(completed.agentJournal.provider,'local');
  assert.equal(completed.agentJournal.calls.length,1);
  assert.equal(h.modelCalls.length,1);
  assert.equal(h.modelCalls[0].url,'http://127.0.0.1:11434/v1/chat/completions');
  assert.equal(h.modelCalls[0].body.tools,undefined);
  assert.equal(h.modelCalls[0].headers.authorization,undefined,'loopback Ollama uses no API credential');

  const state=h.disk();
  const decision=state.jevRecoveryLog.find(item=>item.missionId===missionId&&item.blocker.evidenceRefs.some(ref=>ref.id===blockedJobId));
  validateJevRecoveryLog(state.jevRecoveryLog);
  assert.equal(decision.decisionStatus,'ready_for_review');
  assert.equal(decision.nextStep,'owner_or_policy_gate_review');
  assert.ok(decision.recommendedAlternativeIds.includes(`owner_review:local_provider:${blockedJobId}`));
  assert.equal(decision.authorizesDispatch,false);
  assert.equal(state.jobs.find(item=>item.id===blockedJobId).status,'paused','Verifier cannot resume the blocked Shadow job');
  const result=state.jobs.find(item=>item.id===verifier.id).jevRecoveryVerificationResult;
  const artifact=state.artifacts[result.outputArtifactRef.id];
  assert.equal(artifact.jobId,verifier.id);
  assert.equal(artifact.sha256,result.outputArtifactRef.sha256);

  await h.restart();
  assert.deepEqual(h.disk().jevRecoveryLog,state.jevRecoveryLog);
  assert.deepEqual(h.disk().jobs.find(item=>item.id===verifier.id).jevRecoveryVerificationResult,result);
  assert.equal(h.disk().jobs.find(item=>item.id===blockedJobId).status,'paused');

  const backupKey=randomBytes(32),archive=exportBackup({state:h.disk(),dataDir:h.dir,key:backupKey});
  const restoredDir=path.join(h.dir,'restored');
  restoreBackup({archive,key:backupKey,targetDir:restoredDir});
  const restored=openStore(restoredDir);
  assert.equal(restored.recovered,false);
  assert.deepEqual(restored.state.jevRecoveryLog,state.jevRecoveryLog);
  assert.deepEqual(restored.state.jobs.find(item=>item.id===verifier.id).jevRecoveryVerificationResult,result);
  assert.equal(restored.state.jobs.find(item=>item.id===blockedJobId).status,'paused');
});
