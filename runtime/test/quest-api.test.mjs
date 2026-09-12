import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {start} from '../server.mjs';
import {openStore,digest} from '../lib/store.mjs';

const env={YENO_AGENT_PROVIDER:'auto',YENO_AGENT_DAILY_CALL_LIMIT:'4',YENO_OPENAI_API_KEY:'synthetic-openai-key',YENO_OPENAI_MODEL:'synthetic-openai',YENO_GEMINI_API_KEY:'synthetic-gemini-key',YENO_GEMINI_MODEL:'gemini-3.8-flash'};
const response=text=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:text,tool_calls:[]}}],usage:{prompt_tokens:30,completion_tokens:20}}),{headers:{'Content-Type':'application/json'}});
async function setup(t,options={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-quest-api-')),token='synthetic-quest-owner-token';
  let runtime=await start({host:'127.0.0.1',port:0,dataDir:dir,token,env,...options});
  const request=async(method,route,body)=>{const r=await fetch(`http://127.0.0.1:${runtime.server.address().port}${route}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const text=await r.text();return {status:r.status,body:r.headers.get('content-type')?.includes('json')?JSON.parse(text):text,headers:r.headers};};
  const post=(route,body)=>request('POST',route,{requestId:randomUUID(),...body});
  const get=route=>request('GET',route);
  const wait=async(id,statuses=['completed','failed','paused'])=>{for(let i=0;i<200;i++){const j=runtime.state().jobs.find(j=>j.id===id);if(j&&statuses.includes(j.status))return j;await new Promise(r=>setTimeout(r,20));}assert.fail('job did not reach target state');};
  const restart=async()=>{runtime.shutdown();runtime=await start({host:'127.0.0.1',port:0,dataDir:dir,token,env,...options});};
  t.after(()=>{runtime.shutdown();fs.rmSync(dir,{recursive:true,force:true});});
  return {dir,post,get,wait,restart,state:()=>runtime.state()};
}

test('goal executes through two providers, verifies artifacts, deduplicates and survives restart',async t=>{
  const calls=[];const app=await setup(t,{agentFetch:async(url,req)=>{calls.push({url,body:JSON.parse(req.body)});return response(url.includes('google')?'검토된 합성 결과':'첫 합성 결과');}});
  const create={requestId:randomUUID(),goal:'새 서비스 안내문 완성',drive:'lust',provider:'openai',maxCalls:1};
  const saved=await app.post('/api/quests',create);assert.equal(saved.status,201);assert.equal(saved.body.quest.status,'proposed');assert.equal(calls.length,0);
  assert.equal((await app.post('/api/quests',create)).body.quest.id,saved.body.quest.id);
  const id=saved.body.quest.id,runBody={requestId:randomUUID()};
  const run=await app.post(`/api/quests/${id}/run`,runBody);assert.equal(run.status,201);
  const first=await app.wait(run.body.job.id);assert.equal(first.status,'completed',first.error);assert.equal(calls.length,1);
  assert.equal((await app.post(`/api/quests/${id}/run`,runBody)).body.job.id,first.id);
  assert.equal((await app.post(`/api/quests/${id}/run`,{})).body.job.id,first.id,'distinct Run request still cannot duplicate a goal');
  const artifact=await app.get(`/api/artifacts/${first.artifacts[0].id}`);assert.equal(artifact.status,200);assert.equal(digest(artifact.body),artifact.headers.get('x-content-sha256'));
  assert.equal((await app.post(`/api/quests/${id}/review`,{provider:'openai'})).status,400);
  const reviewBody={requestId:randomUUID(),provider:'gemini',maxCalls:1};
  const review=await app.post(`/api/quests/${id}/review`,reviewBody);assert.equal(review.status,201);assert.equal(review.body.quest.reviewOf,id);
  const reviewed=await app.wait(review.body.job.id);assert.equal(reviewed.status,'completed',reviewed.error);assert.equal(calls.length,2);assert.match(calls[1].body.messages[1].content,/첫 합성 결과/);
  assert.equal((await app.post(`/api/quests/${id}/review`,reviewBody)).body.job.id,reviewed.id);
  const outcome=await app.post('/api/outcomes',{questId:id,ledger:'fame',summary:'독자가 직접 추천했다고 보고',value:1,unit:'명'});assert.equal(outcome.status,201);assert.equal(outcome.body.outcome.verification,'self_reported');
  assert.equal((await app.post('/api/outcomes',{questId:id,ledger:'wealth',summary:'자동 검증 주장',verified:true})).status,400);
  await app.restart();const state=(await app.get('/api/quests')).body;assert.equal(state.total,2);assert.equal(state.ledgers.fame.selfReported,1);assert.equal(state.externalBusinessOutcomesVerified,0);
  assert.equal(state.providers.find(p=>p.provider==='openai').successfulCalls,1);assert.equal(state.providers.find(p=>p.provider==='gemini').successfulCalls,1);
  assert.equal((await app.post(`/api/quests/${id}/run`,runBody)).body.job.id,first.id);assert.equal(calls.length,2);
  assert.ok(!JSON.stringify(state).includes('synthetic-openai-key'));
});

test('missing provider preserves a goal, never calls or silently selects another provider',async t=>{
  let calls=0;const app=await setup(t,{agentFetch:async()=>{calls++;return response('unwanted');}});
  const quest=(await app.post('/api/quests',{goal:'Kimi로 작성',provider:'moonshot'})).body.quest;
  assert.equal((await app.post(`/api/quests/${quest.id}/run`,{})).status,409);
  await app.restart();assert.equal((await app.get('/api/quests')).body.quests[0].status,'proposed');assert.equal(calls,0);assert.equal(app.state().modules.ai,false);
});

test('global stop aborts an active goal and releasing latch cannot retry an uncertain paid call',async t=>{
  let started,aborted=false,calls=0;const began=new Promise(r=>{started=r;});
  const app=await setup(t,{agentFetch:async(url,req)=>{calls++;started();return new Promise((resolve,reject)=>req.signal.addEventListener('abort',()=>{aborted=true;reject(new Error('synthetic interrupted call'));},{once:true}));}});
  const quest=(await app.post('/api/quests',{goal:'중단할 합성 작업',provider:'openai'})).body.quest;
  const run=await app.post(`/api/quests/${quest.id}/run`,{});await began;
  assert.equal((await app.post('/api/control',{action:'stop'})).status,200);await app.wait(run.body.job.id,['paused']);
  for(let i=0;i<50&&!aborted;i++)await new Promise(r=>setTimeout(r,10));assert.equal(aborted,true);
  assert.equal((await app.post('/api/control',{action:'resume'})).status,200);assert.equal(app.state().jobs.find(j=>j.id===run.body.job.id).status,'paused');
  assert.equal((await app.post(`/api/jobs/${run.body.job.id}/action`,{action:'resume'})).status,409);assert.equal(calls,1);
  await app.restart();assert.equal((await app.get('/api/quests')).body.quests[0].outcomeUnknown,true);assert.equal(calls,1);
});

test('corrupted completed artifact cannot become a review or outcome',async t=>{
  const app=await setup(t,{agentFetch:async()=>response('합성 완료 결과')});
  const quest=(await app.post('/api/quests',{goal:'검증할 결과'})).body.quest;
  const run=await app.post(`/api/quests/${quest.id}/run`,{});const job=await app.wait(run.body.job.id);assert.equal(job.status,'completed');
  const item=openStore(app.dir).state.artifacts[job.artifacts[0].id];fs.writeFileSync(path.join(app.dir,'artifacts',item.filename),'tampered');
  assert.equal((await app.post(`/api/quests/${quest.id}/review`,{provider:'gemini'})).status,409);
  assert.equal((await app.post('/api/outcomes',{questId:quest.id,ledger:'wealth',summary:'성과 주장'})).status,409);
});
