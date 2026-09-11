import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {agentConfig, agentProfiles, AGENT_ENDPOINTS} from '../lib/provider-config.mjs';
import {runAgent} from '../lib/agent.mjs';
import {initialState, openStore, digest} from '../lib/store.mjs';
import {start} from '../server.mjs';

const base={YENO_AGENT_PROVIDER:'auto',YENO_AGENT_DAILY_CALL_LIMIT:'4'};
const configured=provider=>({[`YENO_${provider.toUpperCase()}_MODEL`]:'synthetic-model', [`YENO_${provider.toUpperCase()}_API_KEY`]:`synthetic-${provider}-key`});
const reply=()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'합성 제공자 결과',tool_calls:[]}}],usage:{prompt_tokens:10,completion_tokens:5}}),{headers:{'Content-Type':'application/json'}});

test('each provider works without NVIDIA and never borrows a generic or another provider key',()=>{
  for(const provider of Object.keys(AGENT_ENDPOINTS)){
    const config=agentConfig({...base,...configured(provider),YENO_AGENT_API_KEY:'synthetic-legacy-key',YENO_AGENT_MODEL:'legacy-model'});
    assert.equal(config.ready,true);assert.equal(config.provider,provider);
    assert.equal(config.endpoint,AGENT_ENDPOINTS[provider]);assert.equal(config.key,`synthetic-${provider}-key`);
    assert.equal(JSON.stringify(config.providers).includes('synthetic-legacy-key'),false);
    assert.equal(JSON.stringify(config.providers).includes(config.key),false);
  }
  assert.equal(agentConfig({...base,YENO_OPENAI_MODEL:'synthetic',YENO_NVIDIA_API_KEY:'synthetic-nvidia',YENO_AGENT_API_KEY:'synthetic-legacy'}).ready,false);
  assert.equal(agentConfig({YENO_AGENT_PROVIDER:'openai',YENO_OPENAI_MODEL:'synthetic',YENO_AGENT_API_KEY:'synthetic-legacy',YENO_AGENT_DAILY_CALL_LIMIT:'4'}).ready,false);
});

test('auto honors allowlist/order, skips incomplete settings, and cannot unlock spending',()=>{
  const env={...base,...configured('gemini'),...configured('openai'),YENO_NVIDIA_MODEL:'synthetic-missing-key',YENO_AGENT_PROVIDER_ORDER:'nvidia,gemini,openai'};
  assert.equal(agentConfig(env).provider,'gemini');
  assert.equal(agentConfig({...env,YENO_AGENT_PROVIDER_ORDER:'moonshot'}).ready,false);
  assert.equal(agentConfig({...env,YENO_AGENT_DAILY_CALL_LIMIT:'0'}).ready,false);
  assert.equal(agentConfig({...env,YENO_AGENT_PROVIDER:'nvidia'}).ready,false);
  for(const order of ['openai,openai','openai,unknown','openai,'])assert.throws(()=>agentConfig({...env,YENO_AGENT_PROVIDER_ORDER:order}),/invalid_provider_order/);
  const invalid=agentConfig({...env,YENO_AGENT_PROVIDER_ORDER:'openai,gemini',YENO_OPENAI_MODEL:'invalid\nmodel'});
  assert.equal(invalid.provider,'gemini');assert.deepEqual(invalid.providers.find(p=>p.provider==='openai').missing,['invalidConfiguration']);
  assert.equal(agentProfiles({...base,...configured('xai'),YENO_GROK_DAILY_CALL_LIMIT:'8'}).grok.dailyCallLimit,4);
});

test('provider selection cannot replay an old checkpoint or fail over an uncertain paid call',async()=>{
  const config=agentConfig({...base,...configured('gemini'),...configured('openai')});
  const state=initialState(),job={id:randomUUID(),input:'synthetic request'};state.jobs.push(job);
  let calls=0;
  const args={job,state,config,save:()=>{},signal:new AbortController().signal,fetchImpl:async(url,options)=>{calls++;assert.equal(url,AGENT_ENDPOINTS.openai);const body=JSON.parse(options.body);assert.equal(body.max_completion_tokens,2048);assert.equal(Object.hasOwn(body,'max_tokens'),false);throw Error('synthetic timeout');}};
  await assert.rejects(runAgent(args),/request_failed_or_stopped/);
  assert.equal(job.agentJournal.calls[0].status,'unknown');
  await assert.rejects(runAgent(args),/previous_call_outcome_unknown/);
  await assert.rejects(runAgent({...args,config:agentConfig({...base,...configured('gemini')})}),/provider_changed_since_checkpoint/);
  assert.equal(calls,1);
});

test('HTTP command without NVIDIA creates a verified result, deduplicates, survives restart and stops',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-provider-')),token='synthetic-owner-provider-token';let calls=0;
  const env={...base,...configured('gemini'),YENO_NVIDIA_MODEL:'synthetic-unavailable'};
  const options={dataDir:dir,token,host:'127.0.0.1',port:0,env,agentFetch:async(url,req)=>{calls++;assert.equal(url,AGENT_ENDPOINTS.gemini);assert.equal(req.headers.Authorization,'Bearer synthetic-gemini-key');return reply();}};
  let runtime=await start(options);t.after(()=>{runtime.shutdown();fs.rmSync(dir,{recursive:true,force:true});});
  const post=async(route,body)=>{const response=await fetch(`http://127.0.0.1:${runtime.server.address().port}${route}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
  const completed=async id=>{for(let i=0;i<150;i++){const job=runtime.state().jobs.find(j=>j.id===id);if(job.status==='completed')return job;assert.notEqual(job.status,'failed',job.error);await new Promise(r=>setTimeout(r,20));}assert.fail('job did not complete');};
  assert.equal(runtime.state().agent.provider,'gemini');assert.equal(runtime.state().modules.ai,false);
  assert.equal((await post('/api/settings',{modules:{ai:true},requestId:randomUUID()})).status,200);
  const command={text:'짧은 합성 이야기 써줘',requestId:randomUUID()};
  const accepted=await post('/api/commands',command);assert.equal(accepted.status,201);
  const job=await completed(accepted.body.job.id),artifact=openStore(dir).state.artifacts[job.artifacts[0].id];
  const raw=fs.readFileSync(path.join(dir,'artifacts',artifact.filename));assert.equal(digest(raw),artifact.sha256);assert.match(raw.toString(),/합성 제공자 결과/);
  assert.equal((await post('/api/commands',command)).body.job.id,job.id);assert.equal(calls,1);
  const report=await post('/api/commands',{text:'자율 점검',requestId:randomUUID()});const reportJob=await completed(report.body.job.id);
  const reportArtifact=openStore(dir).state.artifacts[reportJob.artifacts[0].id];const reportText=fs.readFileSync(path.join(dir,'artifacts',reportArtifact.filename),'utf8');
  assert.match(reportText,/NVIDIA는 필수 조건이 아닙니다/);assert.match(reportText,/GPT \(OpenAI\)/);assert.equal(reportText.includes('synthetic-gemini-key'),false);
  runtime.shutdown();runtime=await start(options);
  assert.equal((await post('/api/commands',command)).body.job.id,job.id);assert.equal(calls,1);
  assert.equal(runtime.state().agent.usage.attempts,1);assert.equal(runtime.state().jobs.find(j=>j.id===job.id).status,'completed');
  await post('/api/control',{action:'stop',requestId:randomUUID()});
  assert.equal((await post('/api/commands',{text:'두 번째 합성 요청',requestId:randomUUID()})).status,409);assert.equal(calls,1);
  assert.equal(JSON.stringify(runtime.state()).includes('synthetic-gemini-key'),false);
});
