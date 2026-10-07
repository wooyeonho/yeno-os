import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {start} from '../server.mjs';
import {openStore} from '../lib/store.mjs';
import {sha256,PATCH_SCHEMA} from '../lib/repository-patch.mjs';

const content='export const sum = xs => 0;';
const task={baseCommit:'a'.repeat(40),goal:'Fix the bounded sum implementation',files:[{path:'projects/demo/main.mjs',content,sha256:sha256(content)}],editablePaths:['projects/demo/main.mjs'],feedback:''};
const patch={schema:PATCH_SCHEMA,baseCommit:task.baseCommit,changes:[{path:task.files[0].path,beforeSha256:task.files[0].sha256,content:'export const sum = xs => xs.reduce((a,b)=>a+b,0);'}]};
const reply=value=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}],usage:{prompt_tokens:40,completion_tokens:70}}),{headers:{'Content-Type':'application/json'}});

async function setup(t,options={}){
  const root=await fs.promises.mkdtemp(path.join(os.tmpdir(),'blackhole-repository-plan-'));
  const dataDir=path.join(root,'data'),token='synthetic-repository-owner-only';
  const store=openStore(dataDir);store.state.modules.ai=options.ai!==false;store.save();
  const env={YENO_AGENT_PROVIDER:'openai',YENO_AGENT_DAILY_CALL_LIMIT:'20',YENO_OPENAI_MODEL:'synthetic-repository-model',YENO_OPENAI_API_KEY:'synthetic-repository-api-key'};
  let core=await start({dataDir,host:'127.0.0.1',port:0,token,env,...options});
  const rawApi=async(route,authToken,body)=>{const response=await fetch(`http://127.0.0.1:${core.server.address().port}${route}`,{method:body?'POST':'GET',headers:{...(authToken?{Authorization:`Bearer ${authToken}`}:{}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const text=await response.text();let value;try{value=JSON.parse(text);}catch{value=text;}return {status:response.status,value,text};};
  const api=(route,body)=>rawApi(route,token,body);
  const wait=async id=>{for(let n=0;n<150;n++){const snapshot=(await api('/api/state')).value,job=snapshot.jobs.find(item=>item.id===id);if(['failed','completed','paused','cancelled'].includes(job?.status))return job;await new Promise(resolve=>setTimeout(resolve,25));}throw new Error('timeout');};
  t.after(async()=>{core.shutdown();await fs.promises.rm(root,{recursive:true,force:true});});
  return {root,dataDir,api,rawApi,wait,stop:()=>core.shutdown(),restart:async()=>{core.shutdown();core=await start({dataDir,host:'127.0.0.1',port:0,token,env,...options});}};
}

test('authenticated plan produces one bounded JSON artifact, deduplicates, redacts source, and survives restart',async t=>{
  let calls=0;
  const h=await setup(t,{agentFetch:async(_url,request)=>{calls++;const payload=JSON.parse(request.body);assert.equal(payload.tools,undefined);assert.match(payload.messages[0].content,/bounded repository patch author/);return reply(patch);}});
  const body={requestId:randomUUID(),task};
  const admitted=await h.api('/api/developer/plan',body);assert.equal(admitted.status,201,JSON.stringify(admitted));assert.deepEqual(admitted.value.job.execution,{schemaVersion:1,kind:'development-model-call',requiresModel:true,trigger:'development-request',reason:'job:repository-patch'});
  const duplicate=await h.api('/api/developer/plan',body);assert.equal(duplicate.value.jobId,admitted.value.jobId);assert.equal(duplicate.value.job.execution.kind,'development-model-call');assert.equal(JSON.stringify(duplicate.value).includes(content),false);
  const job=await h.wait(admitted.value.jobId);assert.equal(job.status,'completed',JSON.stringify(job));assert.equal(job.repositoryTask,undefined);assert.equal(job.repositoryPlan.executionStatus,'patch-drafted');assert.equal(job.repositoryPlan.evidence,null);assert.equal(job.repositoryPlan.requestId,body.requestId);assert.deepEqual(job.repositoryPlan.agent,{schema:1,id:'repository-developer-worker',kind:'external-developer-worker',attributes:{}});assert.equal(job.repositoryPlan.developerOrder.requestId,body.requestId);assert.equal(job.repositoryPlan.developerOrder.status,'queued');assert.equal(job.repositoryPlan.workerStatus,'no-worker');assert.equal(job.execution.kind,'development-model-call');assert.equal(JSON.stringify(job).includes(content),false);assert.equal(calls,1);assert.equal(job.artifacts.length,1);
  assert.match(job.artifacts[0].name,/^repository-patch-.*\.json$/);assert.deepEqual((await h.api(`/api/artifacts/${job.artifacts[0].id}`)).value,patch);
  assert.equal(fs.existsSync(path.join(h.root,'projects')),false,'model output must not be applied to a source tree');
  await h.restart();assert.deepEqual((await h.api(`/api/artifacts/${job.artifacts[0].id}`)).value,patch);assert.equal(calls,1);
});

test('disabled AI, invalid protected scope, and emergency stop dispatch zero model calls',async t=>{
  let calls=0;const h=await setup(t,{ai:false,agentFetch:async()=>{calls++;return reply(patch);}});
  const body=()=>({requestId:randomUUID(),task});
  assert.equal((await h.api('/api/developer/plan',body())).status,409);
  await h.api('/api/settings',{requestId:randomUUID(),modules:{ai:true}});
  assert.equal((await h.api('/api/developer/plan',{requestId:randomUUID(),task:{...task,editablePaths:['runtime/server.mjs']}})).status,400);
  await h.api('/api/control',{requestId:randomUUID(),action:'stop'});
  assert.equal((await h.api('/api/developer/plan',body())).status,409);assert.equal(calls,0);
});

test('unknown provider outcome is durably held and never automatically replayed',async t=>{
  let calls=0;const h=await setup(t,{agentFetch:async()=>{calls++;throw new Error('synthetic lost response');}});
  const body={requestId:randomUUID(),task};const admitted=await h.api('/api/developer/plan',body);const job=await h.wait(admitted.value.jobId);
  assert.equal(job.status,'paused');assert.equal(job.pauseReason,'outcomeUnknown');assert.equal(job.agent.unknownCalls,1);
  await h.restart();const duplicate=await h.api('/api/developer/plan',body);assert.equal(duplicate.value.jobId,job.id);assert.equal(calls,1);
  const restarted=(await h.api('/api/state')).value.jobs.find(item=>item.id===job.id);assert.equal(restarted.status,'paused');assert.equal(restarted.artifacts.length,0);
});

test('invalid provider patch is rejected after one call with no artifact or source write',async t=>{
  let calls=0;const invalid={...patch,command:'npm test'};const h=await setup(t,{agentFetch:async()=>{calls++;return reply(invalid);}});
  const admitted=await h.api('/api/developer/plan',{requestId:randomUUID(),task});const job=await h.wait(admitted.value.jobId);
  assert.equal(job.status,'failed');assert.equal(calls,1);assert.deepEqual(job.artifacts,[]);assert.equal(fs.existsSync(path.join(h.root,'projects')),false);
});

test('versioned phone admission requires authentication, supports device replay, and rejects changed payload identity',async t=>{
  let calls=0;const h=await setup(t,{agentFetch:async()=>{calls++;return reply(patch);}});const requestId=randomUUID(),body={requestId,task};
  const unauthenticated=await h.rawApi('/api/v1/developer/plan',null,body);assert.equal(unauthenticated.status,401);assert.equal(calls,0);
  const enrollment=await h.rawApi('/api/v1/devices/enroll','synthetic-repository-owner-only',{requestId:randomUUID(),name:'synthetic phone',platform:'android'});assert.equal(enrollment.status,201,JSON.stringify(enrollment));
  const deviceToken=enrollment.value.device.deviceToken,admitted=await h.rawApi('/api/v1/developer/plan',deviceToken,body);assert.equal(admitted.status,201,JSON.stringify(admitted));assert.equal(admitted.value.job.execution.kind,'development-model-call');assert.equal(JSON.stringify(admitted.value).includes(content),false);
  const job=await h.wait(admitted.value.jobId);assert.equal(job.status,'completed');assert.equal(job.execution.trigger,'development-request');
  const replay=await h.rawApi('/api/v1/developer/plan',deviceToken,body);assert.equal(replay.status,201);assert.equal(replay.value.jobId,job.id);assert.equal(replay.value.job.execution.kind,'development-model-call');assert.equal(JSON.stringify(replay.value).includes(content),false);
  const changed=await h.rawApi('/api/v1/developer/plan',deviceToken,{requestId,task:{...task,goal:'Different goal under the same identity'}});assert.equal(changed.status,409);assert.equal(calls,1);
});

test('cancellation during dispatch is durable and restart never replays the call',async t=>{
  let calls=0,enteredResolve;const entered=new Promise(resolve=>{enteredResolve=resolve;});
  const h=await setup(t,{agentFetch:async(_url,request)=>{calls++;enteredResolve();return new Promise((_resolve,reject)=>{const stop=()=>reject(new Error('synthetic cancelled transport'));if(request.signal.aborted)return stop();request.signal.addEventListener('abort',stop,{once:true});});}});
  const body={requestId:randomUUID(),task},admitted=await h.api('/api/developer/plan',body);await entered;
  const running=(await h.api('/api/state')).value.jobs.find(item=>item.id===admitted.value.jobId);const cancelled=await h.api(`/api/jobs/${running.id}/action`,{requestId:randomUUID(),action:'cancel',revision:running.version});assert.equal(cancelled.status,200,JSON.stringify(cancelled));assert.equal(cancelled.value.job.status,'cancelled');
  await new Promise(resolve=>setTimeout(resolve,50));await h.restart();const replay=await h.api('/api/developer/plan',body);assert.equal(replay.value.jobId,running.id);assert.equal(replay.value.job.status,'cancelled');assert.equal(calls,1);assert.equal(replay.value.job.artifacts.length,0);
});

test('artifact tampering withdraws completion, blocks download, and is quarantined across restart',async t=>{
  let calls=0;const h=await setup(t,{agentFetch:async()=>{calls++;return reply(patch);}});const admitted=await h.api('/api/developer/plan',{requestId:randomUUID(),task});const completed=await h.wait(admitted.value.jobId);assert.equal(completed.status,'completed');
  const files=await fs.promises.readdir(path.join(h.dataDir,'artifacts'));assert.equal(files.length,1);await fs.promises.writeFile(path.join(h.dataDir,'artifacts',files[0]),'{}');
  const projected=(await h.api('/api/state')).value.jobs.find(item=>item.id===completed.id);assert.equal(projected.status,'failed');assert.equal(projected.repositoryPlan.executionStatus,'artifact-invalid');assert.equal((await h.api(`/api/artifacts/${completed.artifacts[0].id}`)).status,409);
  await h.restart();const quarantined=(await h.api('/api/state')).value.jobs.find(item=>item.id===completed.id);assert.equal(quarantined.status,'failed');assert.equal(quarantined.repositoryPlan.executionStatus,'artifact-invalid');assert.match(quarantined.error,/artifact changed/i);assert.equal(calls,1);
});
