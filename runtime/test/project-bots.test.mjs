import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {start} from '../server.mjs';
import {openStore,initialState,digest} from '../lib/store.mjs';
import {agentProfiles,agentTool,runAgent} from '../lib/agent.mjs';
import {planProjectBots,validateBotAssignment,botCanStart,botBlockReason} from '../lib/project-bots.mjs';
import {findReceipt,rememberReceipt} from '../lib/request-ledger.mjs';
import {publicJob} from '../lib/job-view.mjs';
import {exportBackup,restoreBackup} from '../lib/backup.mjs';
const KEY='synthetic-bot-model-key';
const env={YENO_AGENT_PROVIDER:'nvidia',YENO_AGENT_MODEL:'synthetic-model',YENO_AGENT_API_KEY:KEY,YENO_AGENT_DAILY_CALL_LIMIT:'8'};
const project=(i,status='active')=>({id:randomUUID(),name:`Project ${i}`,repositoryUrl:'',summary:`PRIVATE_PROJECT_${i}`,nextAction:'작은 검증 초안',status,version:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
const json=data=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
const model=(content='검증용 산출물',tools=[])=>json({choices:[{finish_reason:tools.length?'tool_calls':'stop',message:{content,tool_calls:tools.map(t=>({id:t.id,type:'function',function:{name:t.name,arguments:JSON.stringify(t.args??{})}}))}}],usage:{prompt_tokens:12,completion_tokens:8}});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function eventually(fn,pred){for(let i=0;i<200;i++){const v=fn();if(pred(v))return v;await delay(20);}assert.fail('Expected state did not arrive');}
async function runtimeFixture(t,options={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yeno-bots-')),store=openStore(dir);store.state.projects=options.projects??[project(1),project(2),project(3)];store.save();
 const token='synthetic-project-bot-owner';let runtime=await start({dataDir:dir,host:'127.0.0.1',port:0,token,env:options.env??env,agentFetch:options.agentFetch??(async()=>model())});
 t.after(()=>{runtime.shutdown();fs.rmSync(dir,{recursive:true,force:true});});
 async function request(route,body){const r=await fetch(`http://127.0.0.1:${runtime.server.address().port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify({requestId:randomUUID(),...body})}:{})});return {status:r.status,body:await r.json()};}
 return {dir,request,get runtime(){return runtime;},restart:async()=>{runtime.shutdown();runtime=await start({dataDir:dir,host:'127.0.0.1',port:0,token,env:options.env??env,agentFetch:options.agentFetch??(async()=>model())});}};
}

test('project assignment is bounded, deduplicated, immutable and missing providers remain visibly paused',()=>{
 const s=initialState();s.projects=[project(1),project(2,'paused'),project(3,'archived')];const profiles=agentProfiles({});
 const plan=planProjectBots(s,profiles);assert.equal(plan.created.length,1);assert.equal(plan.created[0].pauseReason,'providerMissing');assert.equal(s.jobs.length,0);
 s.jobs.push(...plan.created);assert.equal(planProjectBots(s,profiles).created.length,0);assert.equal(planProjectBots(s,profiles,{profile:'grok'}).created.length,0);
 s.projects[0].summary='changed';assert.notEqual(s.jobs[0].botAssignment.context.summary,'changed');
 assert.throws(()=>planProjectBots(s,profiles,{projectIds:['unknown']}));assert.throws(()=>planProjectBots(s,profiles,{profile:'arbitrary'}));
 for(const value of [null,{...s.jobs[0].botAssignment,profile:'arbitrary'},{...s.jobs[0].botAssignment,context:{...s.jobs[0].botAssignment.context,secret:'forbidden'}}])assert.throws(()=>validateBotAssignment({...s.jobs[0],botAssignment:value}));
 s.emergencyStop=true;assert.throws(()=>planProjectBots(s,profiles));
});

test('Grok profile requires its own credentials and shares the primary upper call ceiling without fallback',()=>{
 const p=agentProfiles({...env,YENO_GROK_MODEL:'grok-test',YENO_GROK_API_KEY:'synthetic-xai-key',YENO_GROK_DAILY_CALL_LIMIT:'12'});
 assert.equal(p.primary.provider,'nvidia');assert.equal(p.grok.provider,'xai');assert.equal(p.grok.ready,true);assert.equal(p.grok.dailyCallLimit,8);assert.equal(p.grok.endpoint,'https://api.x.ai/v1/chat/completions');
 assert.equal(agentProfiles(env).grok.ready,false);assert.equal(agentProfiles({...env,YENO_GROK_MODEL:'grok-test',YENO_GROK_API_KEY:'synthetic-xai-key'}).grok.ready,false);
});

test('project scope blocks other project reads and unknown tools; changed scope refuses the next model request',async()=>{
 const s=initialState();s.projects=[project(1),project(2)];s.modules.ai=true;const profiles=agentProfiles(env),job=planProjectBots(s,profiles).created[0];s.jobs.push(job);job.status='running';
 const context=await agentTool({name:'project_read',args:{}},s,()=>assert.fail('No outbound'),new AbortController().signal,job);assert.equal(context.project.id,job.projectId);assert.equal(JSON.stringify(context).includes('PRIVATE_PROJECT_2'),false);
 assert.equal((await agentTool({name:'project_read',args:{}},s,null,null)).error,'project_not_assigned');
 assert.equal((await agentTool({name:'project_read',args:{projectId:s.projects[1].id}},s,null,null,job)).error,'unsupported_tool_or_arguments');
 s.projects[0].version++;assert.equal(botBlockReason(job,s,profiles),'projectChanged');
 await assert.rejects(runAgent({job,state:s,config:profiles.primary,save:()=>{},signal:new AbortController().signal,fetchImpl:()=>assert.fail('Changed scope cannot call')}),/project_scope_changed/);
});

test('evicted and legacy cached request replies redact private agent history and assigned project context',()=>{
 const s=initialState();s.projects=[project(1)];const job=planProjectBots(s,agentProfiles({})).created[0];job.agentJournal={provider:'nvidia',model:'synthetic-model',calls:[],history:[{role:'user',content:'PRIVATE_PROMPT'},{role:'assistant',content:'PUBLIC_DRAFT',toolCalls:[],reasoningContent:'PRIVATE_REASONING'}]};s.jobs.push(job);
 const requestId=randomUUID(),hash='a'.repeat(64);rememberReceipt(s,requestId,hash,{status:201,payload:{kind:'job',job}});
 for(const cached of [true,false]){if(!cached)s.requests={};const reply=findReceipt(s,requestId,hash);const raw=JSON.stringify(reply);assert.equal(raw.includes('PRIVATE_'),false);assert.equal(raw.includes('agentJournal'),false);assert.equal(raw.includes('botAssignment'),false);assert.equal(reply.payload.job.bot.profile,'primary');assert.equal(reply.payload.job.agent.toolResults,0);}
 assert.equal(publicJob(job).input,undefined);
});

test('real core batch uses two concurrent model calls and scoped tools, yields real hash-checked artifacts, then survives restart and encrypted restore',async t=>{
 let posts=0,barrier=true;const releases=[],seen=[];
 const f=await runtimeFixture(t,{agentFetch:async(url,options)=>{
   assert.equal(url,'https://integrate.api.nvidia.com/v1/chat/completions');assert.equal(options.headers.Authorization,`Bearer ${KEY}`);posts++;
   const body=JSON.parse(options.body),tool=body.messages.find(m=>m.role==='tool');
   if(!tool){if(barrier)await new Promise(resolve=>releases.push(resolve));return model('',[{id:'project-context',name:'project_read'}]);}
   const p=JSON.parse(tool.content).project;seen.push(p.summary);assert.equal(body.messages.some(m=>String(m.content).includes('PRIVATE_PROJECT_')&&!String(m.content).includes(p.summary)),false);
   return model(`완료한 초안: ${p.name}`);
 }});
 const batch={action:'start',requestId:randomUUID()};const reply=await f.request('/api/bots',batch);assert.equal(reply.status,200);assert.equal(reply.body.createdCount,3);
 await eventually(()=>releases.length,x=>x===2);assert.equal(f.runtime.state().bots.counts.running,2);assert.equal(f.runtime.state().bots.counts.queued,1);assert.equal(posts,2);
 assert.equal((await f.request('/api/bots',batch)).body.batchId,reply.body.batchId);assert.equal(f.runtime.state().jobs.length,3);
 barrier=false;releases.forEach(r=>r());await eventually(()=>f.runtime.state().bots.counts.completed,x=>x===3);assert.equal(posts,6);assert.equal(new Set(seen).size,3);
 const state=openStore(f.dir).state;for(const item of Object.values(state.artifacts)){const bytes=fs.readFileSync(path.join(f.dir,'artifacts',item.filename));assert.equal(digest(bytes),item.sha256);}
 assert.equal(JSON.stringify(f.runtime.state().jobs).includes('PRIVATE_PROJECT_'),false);assert.equal(JSON.stringify(f.runtime.state()).includes(KEY),false);
 await f.restart();assert.equal(f.runtime.state().bots.counts.completed,3);assert.equal((await f.request('/api/bots',{action:'start'})).body.createdCount,0);
 const key=randomBytes(32),targetDir=path.join(f.dir,'restored');restoreBackup({archive:exportBackup({state:openStore(f.dir).state,dataDir:f.dir,key}),key,targetDir});
 const restored=openStore(targetDir).state;assert.equal(restored.emergencyStop,true);assert.equal(restored.modules.ai,false);assert.equal(restored.jobs.filter(j=>j.botAssignment).length,3);assert.deepEqual(restored.jobs[0].botAssignment,state.jobs[0].botAssignment);
});

test('unconfigured API persists assignments, stop and replays without any model call or fake completed work',async t=>{
 const f=await runtimeFixture(t,{env:{},agentFetch:()=>assert.fail('No API key')});
 assert.equal((await f.request('/api/commands',{text:'프로젝트 봇 시작'})).body.createdCount,3);
 assert.equal(f.runtime.state().bots.counts.paused,3);assert.equal(f.runtime.state().bots.counts.completed,0);
 assert.ok(f.runtime.state().jobs.every(j=>j.pauseReason==='providerMissing'));
 assert.equal((await f.request('/api/commands',{text:'그록 봇 시작'})).body.createdCount,0);
 await f.restart();assert.equal(f.runtime.state().bots.counts.paused,3);assert.equal((await f.request('/api/bots',{action:'resume'})).status,200);assert.equal(f.runtime.state().bots.counts.paused,3);
 const report=await f.request('/api/commands',{text:'봇 현황'});assert.equal(report.status,201);await eventually(()=>f.runtime.state().jobs.find(j=>j.id===report.body.job.id),j=>j.status==='completed');
});

test('daily exhaustion pauses pending bot work and owner stop prevents its automatic resumption',async t=>{
 let posts=0;const f=await runtimeFixture(t,{env:{...env,YENO_AGENT_DAILY_CALL_LIMIT:'1'},agentFetch:async()=>{posts++;return model();}});
 await f.request('/api/bots',{action:'start'});await eventually(()=>f.runtime.state().bots.counts,x=>x.completed===1&&x.paused===2);assert.equal(posts,1);
 assert.equal((await f.request('/api/bots',{action:'stop'})).status,200);assert.ok(f.runtime.state().jobs.filter(j=>j.status==='paused').every(j=>j.pauseReason==='owner'));
 await delay(180);assert.equal(posts,1);
});

test('in-flight drain blocks same project and extra bot admission even if a paused job is requeued',()=>{
 const s=initialState();s.projects=[project(1),project(2),project(3)];s.modules.ai=true;s.jobs=planProjectBots(s,agentProfiles(env)).created;
 const controllers=new Map([[s.jobs[0].id,{}],[s.jobs[1].id,{}]]);s.jobs[0].status='paused';s.jobs[1].status='paused';
 assert.equal(botCanStart(s.jobs[2],s,controllers),false);assert.equal(botCanStart(s.jobs[0],s,controllers),false);
 controllers.delete(s.jobs[1].id);assert.equal(botCanStart(s.jobs[2],s,controllers),true);
 const same={...s.jobs[2],id:randomUUID(),projectId:s.jobs[0].projectId};assert.equal(botCanStart(same,s,controllers),false);
});

test('changing a project aborts its pending model request, preserves unknown outcome and never replays the call',async t=>{
 let posts=0;const f=await runtimeFixture(t,{projects:[project(1)],agentFetch:async(url,{signal})=>{posts++;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('synthetic abort')),{once:true}));}});
 await f.request('/api/bots',{action:'start'});await eventually(()=>posts,n=>n===1);const p=f.runtime.state().projects[0];
 assert.equal((await f.request(`/api/projects/${p.id}/update`,{revision:p.version,nextAction:'바뀐 범위'})).status,200);
 await eventually(()=>f.runtime.state().jobs[0],j=>j.status==='paused'&&j.agent.unknownCalls===1);assert.equal(f.runtime.state().jobs[0].pauseReason,'projectChanged');
 await f.request('/api/bots',{action:'resume'});await delay(200);assert.equal(posts,1);assert.equal(f.runtime.state().jobs[0].artifacts.length,0);
});


test('explicit all-project scope includes paused projects without resuming their management state or archived projects',()=>{
 const s=initialState();s.projects=[project(1),project(2,'paused'),project(3,'archived')];s.modules.ai=true;
 const before=structuredClone(s.projects),profiles=agentProfiles(env),batch=planProjectBots(s,profiles,{includePaused:true});
 assert.equal(batch.created.length,2);assert.deepEqual(s.projects,before);assert.ok(batch.created.every(j=>j.status==='queued'));
 const paused=batch.created.find(j=>j.projectId===s.projects[1].id);validateBotAssignment(paused);assert.equal(botBlockReason(paused,s,profiles),null);
 assert.throws(()=>planProjectBots(s,profiles,{includePaused:'true'}));s.projects[1].version++;assert.equal(botBlockReason(paused,s,profiles),'projectChanged');
});
