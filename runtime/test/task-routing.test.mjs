import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {pickProvider, taskClassForJob, TASK_ROUTES, ROUTE_TIMEOUT_MS} from '../lib/task-routing.mjs';
import {start} from '../server.mjs';

const profiles=[{provider:'local',configured:true},{provider:'nvidia',configured:true},{provider:'gemini',configured:true}];
test('builder and verifier cannot select a local-only model', () => {
  assert.equal(pickProvider('shadowBuild', profiles.slice(0,1)),null);
  assert.equal(pickProvider('semanticVerify', profiles.slice(0,1)),null);
});
test('chat prefers local and goal prefers configured remote', () => {
  assert.equal(pickProvider('chat',profiles),'local');
  assert.equal(pickProvider('goal',profiles),'nvidia');
  assert.equal(pickProvider('goal',profiles,{exclude:['nvidia']}),'gemini');
});
test('only explicitly configured providers are selected', () => {
  assert.equal(pickProvider('goal',[{provider:'nvidia',configured:false}]),null);
  assert.equal(taskClassForJob({shadowAssignment:{role:'builder'}}),'shadowBuild');
  assert.equal(taskClassForJob({semanticVerifyRequest:{}}),'semanticVerify');
  assert.equal(ROUTE_TIMEOUT_MS.remote,90000);
  assert.ok(!TASK_ROUTES.shadowBuild.includes('local'));
});

test('a local-only runtime accepts chat but refuses a new goal without dispatch',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-local-route-'));
  const token='synthetic-local-route-owner';
  let modelCalls=0;
  const runtime=await start({host:'127.0.0.1',port:0,dataDir:dir,token,env:{YENO_AGENT_PROVIDER:'auto',YENO_AGENT_DAILY_CALL_LIMIT:'4',YENO_LOCAL_MODEL:'synthetic-local'},agentFetch:async()=>{
    modelCalls++;
    return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'대화 응답'}}],usage:{prompt_tokens:4,completion_tokens:3}}),{status:200,headers:{'content-type':'application/json'}});
  }});
  t.after(()=>{runtime.shutdown();fs.rmSync(dir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${runtime.server.address().port}`;
  const post=async(route,body)=>{
    const response=await fetch(base+route,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({requestId:randomUUID(),...body})});
    return {status:response.status,body:await response.json()};
  };
  const refused=await post('/api/commands',{text:'목표: 오늘 할 일 세 개 정리해줘'});
  assert.equal(refused.status,409);
  assert.equal(modelCalls,0);
  const saved=await post('/api/commands',{text:'목표 저장: 오늘 할 일 세 개 정리해줘'});
  assert.equal(saved.status,201);
  assert.equal(saved.body.quest.goal,'오늘 할 일 세 개 정리해줘');
  const gated=await post('/api/voice',{text:'지금 몇 시야?',chatOnly:true});
  assert.equal(gated.status,409,'The owner AI module gate stays in force');
  const enabled=await post('/api/settings',{modules:{ai:true}});
  assert.equal(enabled.status,200);
  const chat=await post('/api/voice',{text:'지금 몇 시야?',chatOnly:true});
  assert.equal(chat.status,201,JSON.stringify(chat.body));
  assert.equal(chat.body.job.provider,'local');
  assert.equal(chat.body.job.model,'synthetic-local');
  let completed;
  for(let i=0;i<100;i++){
    completed=runtime.state().jobs.find(job=>job.id===chat.body.job.id);
    if(completed?.status==='completed')break;
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  assert.equal(completed?.status,'completed');
  assert.equal(modelCalls,1);
  assert.equal(completed.artifacts.length,1);
});
