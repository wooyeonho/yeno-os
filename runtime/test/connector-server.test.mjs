import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,randomBytes} from 'node:crypto';
import {start} from '../server.mjs';
import {openStore} from '../lib/store.mjs';

async function fixture(t,extra={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-cp1-http-')),token=randomBytes(32).toString('hex');
 const options={host:'127.0.0.1',port:0,dataDir:dir,token,env:{},...extra};
 let core=await start(options);
 const call=async(route,input,credential=token)=>{
  const r=await fetch(`http://127.0.0.1:${core.server.address().port}${route}`,{method:input?'POST':'GET',headers:{Authorization:`Bearer ${credential}`,'content-type':'application/json'},...(input?{body:JSON.stringify({requestId:randomUUID(),...input})}:{})});
  return {status:r.status,body:await r.json()};
 };
 t.after(()=>{core.shutdown();fs.rmSync(dir,{recursive:true,force:true});});
 return {dir,call,restart:async()=>{core.shutdown();core=await start(options);}};
}
const localEnv={YENO_AGENT_PROVIDER:'local',YENO_LOCAL_MODEL:'synthetic-model',YENO_LOCAL_BASE_URL:'http://127.0.0.1:11434/v1/chat/completions',YENO_AGENT_DAILY_CALL_LIMIT:'1'};
const reply=()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'OK'}}],usage:{prompt_tokens:10,completion_tokens:1}}),{headers:{'content-type':'application/json'}});

test('owner-only connectors show real library check and invalidate proof on core restart including receipt replay',async t=>{
 const f=await fixture(t);
 const noOwner=await f.call('/api/connectors',null,'invalid');assert.equal(noOwner.status,401);
 const enrolled=await f.call('/api/v1/devices/enroll',{name:'synthetic device',platform:'android'});
 assert.equal((await f.call('/api/connectors',null,enrolled.body.device.deviceToken)).status,403);
 const requestId=randomUUID();
 const checked=await f.call('/api/connectors/quantum-circuit/check',{requestId});
 assert.equal(checked.status,200);assert.equal(checked.body.connector.status,'connected');
 assert.equal(checked.body.connector.lastCheck.evidence.countsOrigin,'local_statevector_simulator');
 await f.restart();
 const rows=(await f.call('/api/connectors')).body.connectors;
 assert.equal(rows.find(row=>row.id==='quantum-circuit').status,'installed');
 const replay=await f.call('/api/connectors/quantum-circuit/check',{requestId});
 assert.equal(replay.body.connector.status,'installed','old receipt cannot resurrect connected');
});

test('local connector probe goes through durable ordinary call budget, uses eight-token limit and cannot run twice',async t=>{
 const payloads=[];
 const f=await fixture(t,{env:localEnv,connectorOptions:{cooldownMs:0},agentFetch:async(_url,request)=>{payloads.push(JSON.parse(request.body));return reply();}});
 const result=await f.call('/api/connectors/ollama/check',{});
 assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.connector.status,'connected',JSON.stringify(result.body));
 assert.equal(result.body.connector.lastCheck.evidence.class,'synthetic');
 assert.equal(payloads.length,1);assert.equal(payloads[0].max_tokens,8);assert.equal('tools' in payloads[0],false);
 const jobs=openStore(f.dir).state.jobs;
 assert.equal(jobs.length,1);assert.equal(jobs[0].agentJournal.calls.length,1);assert.equal(jobs[0].agentJournal.calls[0].status,'settled');
 assert.equal(jobs[0].status,'completed');
 const again=await f.call('/api/connectors/ollama/check',{});
 assert.equal(again.body.connector.status,'blocked');assert.equal(payloads.length,1,'daily limit preserved');
});

test('stopped core never calls model, no raw upstream error enters public connector receipt',async t=>{
 let called=0;
 const f=await fixture(t,{env:localEnv,connectorOptions:{cooldownMs:0},agentFetch:async()=>{called++;throw Error('SECRET_UPSTREAM_BODY');}});
 await f.call('/api/control',{action:'stop'});
 const result=await f.call('/api/connectors/ollama/check',{});
 assert.equal(result.body.connector.status,'blocked');assert.equal(called,0);
 assert.equal(JSON.stringify(result.body).includes('SECRET_UPSTREAM_BODY'),false);
});


test('in-flight connector request survives crash snapshot and same identity never sends again',async t=>{
 let entered,release,sends=0;const ready=new Promise(resolve=>{entered=resolve;});
 const env={...localEnv,YENO_AGENT_DAILY_CALL_LIMIT:'3'};
 const f=await fixture(t,{env,agentFetch:async()=>{sends++;entered();await new Promise(resolve=>{release=resolve;});return reply();}});
 const requestId=randomUUID(),pending=f.call('/api/connectors/ollama/check',{requestId});
 await ready;
 const replay=await f.call('/api/connectors/ollama/check',{requestId});
 assert.equal(replay.body.checkRequest.outcome,'in_progress_or_unknown');assert.equal(sends,1);
 const recovered=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-cp1-crash-'));
 fs.copyFileSync(path.join(f.dir,'state.json'),path.join(recovered,'state.json'));
 release();await pending;
 const token=randomBytes(32).toString('hex');let restartedSends=0;
 const core=await start({host:'127.0.0.1',port:0,dataDir:recovered,token,env,agentFetch:async()=>{restartedSends++;return reply();}});
 t.after(()=>{core.shutdown();fs.rmSync(recovered,{recursive:true,force:true});});
 const r=await fetch('http://127.0.0.1:'+core.server.address().port+'/api/connectors/ollama/check',{method:'POST',headers:{Authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({requestId})});
 const body=await r.json();assert.equal(r.status,200);assert.equal(body.checkRequest.outcome,'in_progress_or_unknown');
 assert.notEqual(body.connector.status,'connected');assert.equal(restartedSends,0);assert.equal(openStore(recovered).state.jobs.length,1);
});

test('tool calls returned to a connector probe never execute a tool',async t=>{
 let sends=0;
 const f=await fixture(t,{env:localEnv,agentFetch:async()=>{sends++;return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{content:'',tool_calls:[{id:'unsolicited-probe-tool',type:'function',function:{name:'runtime_inspect',arguments:'{}'}}]}}],usage:{prompt_tokens:10,completion_tokens:5}}),{headers:{'content-type':'application/json'}});}});
 const result=await f.call('/api/connectors/ollama/check',{});
 assert.equal(result.body.connector.status,'blocked');assert.equal(sends,1);
 assert.equal(openStore(f.dir).state.jobs[0].agentJournal.history.filter(m=>m.role==='tool').length,0);
});
