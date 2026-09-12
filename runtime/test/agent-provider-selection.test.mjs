import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {agentConfigForProvider, AGENT_ENDPOINTS} from '../lib/provider-config.mjs';
import {runAgent, agentUsage} from '../lib/agent.mjs';
import {initialState} from '../lib/store.mjs';

const scoped=provider=>({[`YENO_${provider.toUpperCase()}_MODEL`]:'synthetic-model', [`YENO_${provider.toUpperCase()}_API_KEY`]:`synthetic-${provider}-key`});
const env={YENO_AGENT_PROVIDER:'auto',YENO_AGENT_DAILY_CALL_LIMIT:'4',...scoped('openai'),...scoped('gemini')};
const json=body=>new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
const reply=(tools=[],content='검증용 합성 결과')=>json({choices:[{finish_reason:tools.length?'tool_calls':'stop',message:{content,tool_calls:tools}}],usage:{prompt_tokens:10,completion_tokens:5}});
const inspect=id=>({id,type:'function',function:{name:'runtime_inspect',arguments:'{}'}});
const job=callLimit=>({id:randomUUID(),input:'검증용 합성 요청',...(callLimit===undefined?{}:{callLimit})});

test('explicit provider pins all six own endpoints and credentials without cross-provider fallback',()=>{
  const all={...env,YENO_AGENT_MODEL:'synthetic-legacy-model',YENO_AGENT_API_KEY:'synthetic-legacy-key',...Object.assign({},...Object.keys(AGENT_ENDPOINTS).map(scoped))};
  assert.equal(agentConfigForProvider(all).provider,'openai');
  assert.equal(agentConfigForProvider(all,'auto').provider,'openai');
  for(const provider of Object.keys(AGENT_ENDPOINTS)){
    const selected=agentConfigForProvider(all,provider);
    assert.equal(selected.provider,provider);assert.equal(selected.endpoint,AGENT_ENDPOINTS[provider]);
    assert.equal(selected.ready,true);assert.equal(selected.key,`synthetic-${provider}-key`);
    assert.equal(JSON.stringify(selected.providers).includes(selected.key),false);
  }
  const missing=agentConfigForProvider({...env,YENO_AGENT_MODEL:'synthetic-legacy-model',YENO_AGENT_API_KEY:'synthetic-legacy-key'},'nvidia');
  assert.equal(missing.provider,'nvidia');assert.equal(missing.ready,false);assert.equal(missing.key,'');
  assert.equal(agentConfigForProvider({...env,YENO_AGENT_DAILY_CALL_LIMIT:'0'},'gemini').ready,false);
  for(const provider of [null,'','other','OPENAI',{},['openai']])assert.throws(()=>agentConfigForProvider(env,provider),/invalid_provider/);
});

test('legacy credentials remain usable only for the original explicitly configured provider',()=>{
  const legacy={YENO_AGENT_PROVIDER:'openai',YENO_AGENT_MODEL:'synthetic-old-model',YENO_AGENT_API_KEY:'synthetic-old-key',YENO_AGENT_DAILY_CALL_LIMIT:'4'};
  assert.equal(agentConfigForProvider(legacy,'openai').ready,true);
  assert.equal(agentConfigForProvider(legacy,'openai').key,'synthetic-old-key');
  assert.equal(agentConfigForProvider(legacy,'gemini').ready,false);
  assert.equal(agentConfigForProvider(legacy,'gemini').key,'');
  assert.equal(agentConfigForProvider({...legacy,YENO_OPENAI_MODEL:'partial-scoped-model'},'openai').ready,false);
});

test('two explicitly selected providers share durable daily allowance and an unknown call never fails over',async()=>{
  const state=initialState(),first=job(1),second=job(1),third=job(1);state.jobs.push(first,second,third);
  const limited={...env,YENO_AGENT_DAILY_CALL_LIMIT:'2'};let calls=0;
  const common={state,save:()=>{},signal:new AbortController().signal};
  await runAgent({...common,job:first,config:agentConfigForProvider(limited,'gemini'),fetchImpl:async(url,req)=>{
    calls++;assert.equal(url,AGENT_ENDPOINTS.gemini);assert.equal(req.headers.Authorization,'Bearer synthetic-gemini-key');return reply();
  }});
  await assert.rejects(runAgent({...common,job:second,config:agentConfigForProvider(limited,'openai'),fetchImpl:async(url,req)=>{
    calls++;assert.equal(url,AGENT_ENDPOINTS.openai);assert.equal(req.headers.Authorization,'Bearer synthetic-openai-key');throw Error('synthetic lost response');
  }}),/request_failed_or_stopped/);
  const disk=JSON.parse(JSON.stringify(state));
  await assert.rejects(runAgent({...common,state:disk,job:disk.jobs[1],config:agentConfigForProvider(limited,'gemini'),fetchImpl:()=>assert.fail('No failover')}),/provider_changed_since_checkpoint/);
  await assert.rejects(runAgent({...common,state:disk,job:disk.jobs[2],config:agentConfigForProvider(limited,'gemini'),fetchImpl:()=>assert.fail('No extra daily call')}),/daily_call_limit/);
  assert.equal(calls,2);assert.equal(agentUsage(disk.jobs).attempts,2);assert.equal(agentUsage(disk.jobs).unknown,1);
});

test('per-job call limit survives disk resume and does not replace the global call allowance',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-job-call-limit-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'state.json'),state=initialState(),limitedJob=job(1),controller=new AbortController();state.jobs.push(limitedJob);
  const config=agentConfigForProvider(env,'openai');let calls=0;
  await assert.rejects(runAgent({job:limitedJob,state,config,signal:controller.signal,save:()=>{
    fs.writeFileSync(file,JSON.stringify(state));
    if(limitedJob.agentJournal?.history.some(message=>message.role==='tool'))controller.abort();
  },fetchImpl:async()=>{calls++;return reply([inspect('first-read')],'');}}),/stopped/);
  const recovered=JSON.parse(fs.readFileSync(file,'utf8'));
  await assert.rejects(runAgent({job:recovered.jobs[0],state:recovered,config,save:()=>{},signal:new AbortController().signal,fetchImpl:()=>assert.fail('No second model call')}),/mission_call_limit/);
  assert.equal(calls,1);assert.equal(recovered.jobs[0].callLimit,1);assert.equal(recovered.jobs[0].agentJournal.calls[0].status,'settled');
  const finalJob=job(1);recovered.jobs.push(finalJob);
  assert.match(await runAgent({job:finalJob,state:recovered,config,save:()=>{},signal:new AbortController().signal,fetchImpl:async()=>{calls++;return reply();}}),/검증용 합성 결과/);
  assert.equal(calls,2);
});

test('invalid per-job limits cannot reserve or call a model',async()=>{
  for(const value of [0,5,-1,1.5,'1',null,NaN,Infinity]){
    const state=initialState(),invalid=job(value);state.jobs.push(invalid);
    await assert.rejects(runAgent({job:invalid,state,config:agentConfigForProvider(env,'openai'),save:()=>assert.fail('No reservation'),signal:new AbortController().signal,fetchImpl:()=>assert.fail('No model call')}),/invalid_job_call_limit/);
    assert.equal(invalid.agentJournal,undefined);
  }
});

test('Gemini 3 bounded reasoning preserves signed tool continuation through the next call',async()=>{
  const state=initialState(),signed=job(2);state.jobs.push(signed);let calls=0;
  const config=agentConfigForProvider({...env,YENO_GEMINI_MODEL:'gemini-3.8-flash'},'gemini');
  const signature='synthetic-opaque+/signature=';
  await runAgent({job:signed,state,config,save:()=>{},signal:new AbortController().signal,fetchImpl:async(url,req)=>{
    calls++;const payload=JSON.parse(req.body);assert.equal(payload.reasoning_effort,'low');assert.equal(payload.max_tokens,2048);
    if(calls===1){const tool=inspect('signed-read');tool.extra_content={google:{thought_signature:signature}};return reply([tool],'');}
    assert.equal(payload.messages.find(message=>message.tool_calls)?.tool_calls[0].extra_content.google.thought_signature,signature);
    return reply();
  }});
  assert.equal(calls,2);assert.equal(agentUsage(state.jobs).unknown,0);
});
