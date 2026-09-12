import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {start} from '../server.mjs';
import {openStore} from '../lib/store.mjs';

test('one owner-started goal preserves disabled global AI and cannot activate pending automatic review',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-quest-autorun-'));
  const seed=openStore(dir),at=new Date().toISOString();
  seed.state.modules.ai=false;
  seed.state.discovery={enabled:true,nextRunAt:new Date(Date.now()+86400000).toISOString(),lastRun:{startedAt:at,finishedAt:at,status:'completed',added:1,feeds:[]}};
  seed.save();
  const token='synthetic-quest-autorun-owner-token';let calls=0;
  const runtime=await start({host:'127.0.0.1',port:0,dataDir:dir,token,
    env:{YENO_AGENT_PROVIDER:'openai',YENO_OPENAI_MODEL:'synthetic-model',YENO_OPENAI_API_KEY:'synthetic-key',YENO_AGENT_DAILY_CALL_LIMIT:'4',YENO_AGENT_AUTORUN:'true'},
    agentFetch:async()=>{calls++;return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'명시적으로 요청한 목표의 합성 결과',tool_calls:[]}}],usage:{prompt_tokens:10,completion_tokens:5}}),{headers:{'Content-Type':'application/json'}});}});
  t.after(()=>{runtime.shutdown();fs.rmSync(dir,{recursive:true,force:true});});
  const post=async(route,body)=>{
    const response=await fetch(`http://127.0.0.1:${runtime.server.address().port}${route}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({requestId:randomUUID(),...body})});
    return {status:response.status,body:await response.json()};
  };
  const saved=await post('/api/quests',{goal:'사용자가 직접 요청한 산출물 하나',maxCalls:1});assert.equal(saved.status,201);
  const run=await post(`/api/quests/${saved.body.quest.id}/run`,{});assert.equal(run.status,201);
  for(let i=0;i<150;i++){
    const current=runtime.state().jobs.find(job=>job.id===run.body.job.id);
    assert.notEqual(current.status,'failed',current.error);
    if(current.status==='completed')break;
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  assert.equal(runtime.state().jobs.find(job=>job.id===run.body.job.id).status,'completed');
  // Let the scheduler re-check the still-unreviewed discovery after completion.
  await new Promise(resolve=>setTimeout(resolve,320));
  assert.equal(runtime.state().modules.ai,false,'individual authorization cannot enable the global module');
  assert.equal(runtime.state().agent.automaticReviews,false);
  assert.equal(calls,1,'the request must not create a second automatic paid-path call');
  assert.equal(runtime.state().jobs.length,1);
  const disk=openStore(dir).state;
  assert.equal(disk.modules.ai,false);
  assert.equal(disk.jobs.some(job=>job.agentJournal?.automaticKey),false);
  assert.equal(disk.discovery.enabled,true,'existing source-discovery settings are preserved');
});

test('unrelated settings preserve an authorized running goal while explicit AI disable stops it',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-quest-settings-'));
  const token='synthetic-quest-settings-owner-token';let calls=0,aborted=false;
  const runtime=await start({host:'127.0.0.1',port:0,dataDir:dir,token,
    env:{YENO_AGENT_PROVIDER:'openai',YENO_OPENAI_MODEL:'synthetic-model',YENO_OPENAI_API_KEY:'synthetic-key',YENO_AGENT_DAILY_CALL_LIMIT:'4'},
    agentFetch:async(url,request)=>{calls++;return new Promise((resolve,reject)=>request.signal.addEventListener('abort',()=>{aborted=true;reject(new Error('synthetic owner stop'));},{once:true}));}});
  t.after(()=>{runtime.shutdown();fs.rmSync(dir,{recursive:true,force:true});});
  const post=async(route,body)=>{
    const response=await fetch(`http://127.0.0.1:${runtime.server.address().port}${route}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({requestId:randomUUID(),...body})});
    return {status:response.status,body:await response.json()};
  };
  const saved=await post('/api/quests',{goal:'진행 중 설정 변경을 확인할 합성 작업',maxCalls:1});assert.equal(saved.status,201);
  const run=await post(`/api/quests/${saved.body.quest.id}/run`,{});assert.equal(run.status,201);
  for(let i=0;i<100&&calls===0;i++)await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(calls,1);assert.equal(runtime.state().modules.ai,false);
  assert.equal((await post('/api/settings',{concurrency:2})).status,200);
  assert.equal((await post('/api/settings',{modules:{memory:true}})).status,200);
  assert.equal(runtime.state().jobs.find(job=>job.id===run.body.job.id).status,'running','unrelated settings must not cancel an in-flight provider request');
  assert.equal(aborted,false);
  assert.equal((await post('/api/settings',{modules:{ai:false}})).status,200);
  for(let i=0;i<100&&!aborted;i++)await new Promise(resolve=>setTimeout(resolve,10));
  const paused=runtime.state().jobs.find(job=>job.id===run.body.job.id);
  assert.equal(aborted,true);assert.equal(paused.status,'paused');assert.equal(paused.pauseReason,'moduleDisabled');
  assert.equal((await post(`/api/jobs/${paused.id}/action`,{action:'resume'})).status,409,'owner disable cannot make an uncertain model request replayable');
  assert.equal(calls,1);
});
