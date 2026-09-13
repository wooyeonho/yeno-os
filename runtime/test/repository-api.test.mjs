import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomUUID,randomBytes} from 'node:crypto';
import {start} from '../server.mjs';import {openStore} from '../lib/store.mjs';import {exportBackup,restoreBackup} from '../lib/backup.mjs';import {sha256,PATCH_SCHEMA} from '../lib/repository-patch.mjs';
const content='export const sum = xs => 0;';const task={baseCommit:'a'.repeat(40),goal:'숫자 합계 수정',files:[{path:'projects/demo/main.mjs',content,sha256:sha256(content)}],editablePaths:['projects/demo/main.mjs'],feedback:''};
const patch={schema:PATCH_SCHEMA,baseCommit:task.baseCommit,changes:[{path:task.files[0].path,beforeSha256:task.files[0].sha256,content:'export const sum = xs => xs.reduce((a,b)=>a+b,0);'}]};
async function setup(t,options={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-repository-api-')),dataDir=path.join(root,'data'),token='synthetic-repository-owner-only';const st=openStore(dataDir);st.state.modules.ai=options.ai!==false;st.save();
 const env={YENO_AGENT_PROVIDER:'openai',YENO_AGENT_DAILY_CALL_LIMIT:'20',YENO_OPENAI_MODEL:'synthetic-repository-model',YENO_OPENAI_API_KEY:'synthetic-repository-api-key'};
 let core=await start({dataDir,host:'127.0.0.1',port:0,token,env,...options});
 const api=async(route,body)=>{const r=await fetch(`http://127.0.0.1:${core.server.address().port}`+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const text=await r.text();let value;try{value=JSON.parse(text);}catch{value=text;}return {status:r.status,value,text};};
 const wait=async id=>{for(let n=0;n<150;n++){const s=(await api('/api/state')).value,j=s.jobs.find(j=>j.id===id);if(['failed','completed','paused','cancelled'].includes(j?.status))return j;await new Promise(r=>setTimeout(r,25));}throw Error('timeout');};
 t.after(()=>{core.shutdown();fs.rmSync(root,{recursive:true,force:true});});return {root,dataDir,api,wait,stop:()=>core.shutdown(),restart:async()=>{core.shutdown();core=await start({dataDir,host:'127.0.0.1',port:0,token,env,...options});}};
}
const reply=x=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(x)}}],usage:{prompt_tokens:40,completion_tokens:70}}),{headers:{'Content-Type':'application/json'}});
test('core drafts a one-call bounded patch, redacts source from state, deduplicates and restores backup',async t=>{
 let calls=0;const h=await setup(t,{agentFetch:async(url,request)=>{calls++;const p=JSON.parse(request.body);assert.equal(p.tools,undefined);assert.match(p.messages[0].content,/bounded repository patch author/);return reply(patch);}});
 const b={requestId:randomUUID(),task};const r=await h.api('/api/developer/plan',b);assert.equal(r.status,201,JSON.stringify(r));assert.equal((await h.api('/api/developer/plan',b)).value.jobId,r.value.jobId);
 const j=await h.wait(r.value.jobId);assert.equal(j.status,'completed',JSON.stringify(j));assert.equal(j.repositoryTask,undefined);assert.equal(j.repositoryPlan.executionStatus,'patch-only');assert.equal(calls,1);assert.equal(j.artifacts.length,1);
 assert.deepEqual((await h.api('/api/artifacts/'+j.artifacts[0].id)).value,patch);assert.equal((await h.api('/api/state')).value.repositoryDevelopment.runnerConnected,false);
 await h.restart();assert.deepEqual((await h.api('/api/artifacts/'+j.artifacts[0].id)).value,patch);assert.equal(calls,1);
 h.stop();const state=openStore(h.dataDir).state,key=randomBytes(32),archive=exportBackup({state,dataDir:h.dataDir,key});const dest=path.join(h.root,'restored');restoreBackup({archive,key,targetDir:dest});const restored=openStore(dest).state;assert.equal(restored.jobs[0].repositoryTask.baseCommit,task.baseCommit);assert.equal(restored.emergencyStop,true);assert.equal(restored.modules.ai,false);
});
test('no spending when disabled, invalid scope, or stopped',async t=>{
 let calls=0;const h=await setup(t,{ai:false,agentFetch:async()=>{calls++;return reply(patch);}});const body=()=>({requestId:randomUUID(),task});
 assert.equal((await h.api('/api/developer/plan',body())).status,409);await h.api('/api/settings',{requestId:randomUUID(),modules:{ai:true}});
 assert.equal((await h.api('/api/developer/plan',{requestId:randomUUID(),task:{...task,editablePaths:['runtime/server.mjs']}})).status,400);
 await h.api('/api/control',{requestId:randomUUID(),action:'stop'});assert.equal((await h.api('/api/developer/plan',body())).status,409);assert.equal(calls,0);
});
test('unknown provider outcome is held across restart, never retried for same request',async t=>{
 let calls=0;const h=await setup(t,{agentFetch:async()=>{calls++;throw Error('synthetic lost response');}});const b={requestId:randomUUID(),task};const r=await h.api('/api/developer/plan',b);const j=await h.wait(r.value.jobId);assert.equal(j.status,'failed');assert.equal(j.agent.unknownCalls,1);await h.restart();assert.equal((await h.api('/api/developer/plan',b)).value.jobId,j.id);assert.equal(calls,1);
});
