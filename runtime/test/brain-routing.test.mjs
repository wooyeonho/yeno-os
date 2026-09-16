import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {start} from '../server.mjs';
import {openStore} from '../lib/store.mjs';
import {routeAgentJob,transportAuthority,settleRouting,validateRouting,RoutingError,ROUTING_KEYS} from '../lib/brain-routing.mjs';

const VERIFIED='2026-09-14T00:00:00.000Z';
const declare=(provider,model,overrides={})=>({provider,model,taskCapabilities:['text','tool-calling'],reasoningClass:'standard',codingClass:'none',realtime:false,vision:false,audioLive:false,toolCalling:true,contextLimit:128000,costTier:'medium',quotaClass:'metered',dailyBudget:{calls:20,used:0},availability:'available',lastVerifiedAt:VERIFIED,...overrides});
// The cheaper xai candidate is declared but never configured: the router must
// fail over before sending, and the configured openai candidate must be used.
const POOL=[declare('xai','grok-declared-cheap',{costTier:'low'}),declare('openai','gpt-declared',{costTier:'medium'})];
const KEY='synthetic-openai-key-not-real';
const env={YENO_AGENT_PROVIDER:'auto',YENO_AGENT_DAILY_CALL_LIMIT:'4',YENO_OPENAI_MODEL:'gpt-declared',YENO_OPENAI_API_KEY:KEY,YENO_BRAIN_POOL:JSON.stringify(POOL)};
const json=data=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
const reply=(content='라우팅된 합성 응답')=>json({choices:[{finish_reason:'stop',message:{content,tool_calls:[]}}],usage:{prompt_tokens:10,completion_tokens:5}});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function eventually(read,predicate){for(let i=0;i<200;i++){const result=read();if(predicate(result))return result;await pause(20);}assert.fail('Expected state did not arrive');}

test('routeAgentJob: declared pool skips an unconfigured cheaper candidate with recorded evidence; owner pin never fails over; decision carries no authority',()=>{
  const routed=routeAgentJob({env,taskClass:'tool-use',legacyConfig:null,at:VERIFIED});
  assert.equal(routed.routing.selectedProvider,'openai');assert.equal(routed.routing.selectedModel,'gpt-declared');
  const xai=routed.routing.candidates.find(c=>c.provider==='xai');
  assert.equal(xai.eligible,false);assert.deepEqual(xai.reasons,['configuration_missing']);assert.deepEqual(routed.routing.failover,[]);
  assert.equal(routed.routing.transportOutcome,'notSent');assert.equal(routed.decision.authorizesCall,false);
  assert.deepEqual(Object.keys(routed.routing).sort(),[...ROUTING_KEYS].sort());
  assert.equal(JSON.stringify(routed.routing).includes(KEY),false);
  assert.throws(()=>routeAgentJob({env,taskClass:'tool-use',pinnedProvider:'xai',legacyConfig:null,at:VERIFIED}),error=>error instanceof RoutingError&&['configuration_missing','no_eligible_model'].includes(error.code));
  const pinned=routeAgentJob({env,taskClass:'tool-use',pinnedProvider:'openai',legacyConfig:null,at:VERIFIED});
  assert.equal(pinned.routing.ownerOverride?.provider,'openai');assert.deepEqual(pinned.routing.failover,[]);
});

test('transportAuthority is independent of the router: emergency stop, budget, background trigger and unknown receipts block the send',()=>{
  const {routing,config}=routeAgentJob({env,taskClass:'tool-use',legacyConfig:null,at:VERIFIED});
  const base={routing,config,job:{id:'j',agentJournal:{calls:[]}},state:{emergencyStop:false},usage:{attempts:0},at:VERIFIED};
  assert.equal(transportAuthority(base).allowed,true);
  assert.deepEqual(transportAuthority({...base,state:{emergencyStop:true}}).blockers,['emergency_stop']);
  assert.deepEqual(transportAuthority({...base,usage:{attempts:4}}).blockers,['global_daily_budget_exhausted']);
  assert.deepEqual(transportAuthority({...base,routing:{...routing,trigger:'background'}}).blockers,['background_model_calls_disabled']);
  assert.deepEqual(transportAuthority({...base,job:{id:'j',agentJournal:{calls:[{status:'unknown'}]}}}).blockers,['previous_call_outcome_unknown']);
  const unknown=settleRouting(structuredClone(routing),{calls:[{status:'unknown'}]},VERIFIED);
  assert.equal(unknown.transportOutcome,'outcomeUnknown');assert.equal(unknown.ownerReviewRequired,true);
  assert.throws(()=>validateRouting({...routing,apiKey:'x'}));
});

test('core API: routed job persists routing provenance without secrets, survives restart, and a crash mid-call becomes outcomeUnknown with no duplicate send',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-routing-')),token='synthetic-routing-owner-token';let posts=0,release=null,hang=false;
  const options={dataDir:dir,token,host:'127.0.0.1',port:0,env,agentFetch:async url=>{posts++;assert.equal(url,'https://api.openai.com/v1/chat/completions');if(hang)return new Promise(resolve=>{release=resolve;});return reply();}};
  let runtime=await start(options);t.after(()=>{runtime.shutdown();fs.rmSync(dir,{recursive:true,force:true});});
  const post=async(route,body)=>{const r=await fetch(`http://127.0.0.1:${runtime.server.address().port}${route}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({...body,requestId:randomUUID()})});return {status:r.status,body:await r.json()};};
  assert.equal((await post('/api/settings',{modules:{ai:true}})).status,200);
  const created=await post('/api/commands',{text:'자율 임무: 상태를 확인해'});assert.equal(created.status,201);
  assert.equal(created.body.job.routing.selectedProvider,'openai');assert.equal(created.body.job.routing.poolDeclared,true);
  const job=await eventually(()=>runtime.state().jobs.find(j=>j.id===created.body.job.id),j=>j.status==='completed');
  assert.equal(posts,1);
  assert.equal(job.routing.transportOutcome,'settled');assert.equal(job.routing.usage.calls,1);assert.equal(job.routing.usage.promptUnits,10);assert.ok(job.routing.transportStartedAt);
  assert.equal(job.routing.selectedProvider,job.agent.provider);
  assert.equal(JSON.stringify(openStore(dir).state).includes(KEY),false);
  runtime.shutdown();runtime=await start(options);
  const restored=openStore(dir).state.jobs.find(j=>j.id===created.body.job.id);
  assert.deepEqual(restored.routing,job.routing);
  hang=true;const second=await post('/api/commands',{text:'자율 임무: 다른 상태를 확인해'});assert.equal(second.status,201);
  await eventually(()=>release,Boolean);runtime.shutdown();runtime=await start(options);
  const unknown=runtime.state().jobs.find(j=>j.id===second.body.job.id);
  assert.equal(unknown.routing.transportOutcome,'outcomeUnknown');assert.equal(unknown.routing.ownerReviewRequired,true);
  assert.equal((await post(`/api/jobs/${second.body.job.id}/action`,{action:'resume'})).status,200);
  const failed=await eventually(()=>runtime.state().jobs.find(j=>j.id===second.body.job.id),j=>j.status==='failed');
  assert.match(failed.error,/previous_call_outcome_unknown/);assert.equal(posts,2);
  assert.equal(failed.routing.transportOutcome,'outcomeUnknown');
  release(reply());await pause(50);assert.equal(posts,2);
});

test('core API: emergency stop blocks a routed send at transport time even though routing already selected a model',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-routing-stop-')),token='synthetic-routing-stop-token';let posts=0;
  const runtime=await start({dataDir:dir,token,host:'127.0.0.1',port:0,env,agentFetch:async()=>{posts++;return reply();}});
  t.after(()=>{runtime.shutdown();fs.rmSync(dir,{recursive:true,force:true});});
  const post=async(route,body)=>{const r=await fetch(`http://127.0.0.1:${runtime.server.address().port}${route}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({...body,requestId:randomUUID()})});return {status:r.status,body:await r.json()};};
  await post('/api/settings',{modules:{ai:true}});
  await post('/api/control',{action:'stop'});
  assert.equal((await post('/api/commands',{text:'자율 임무: 상태를 확인해'})).status,409);
  await pause(100);assert.equal(posts,0);
});
