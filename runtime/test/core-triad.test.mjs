import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import * as cap from '../lib/capabilities.mjs';
import {initialState,openStore,digest} from '../lib/store.mjs';
import {planAutopilot} from '../lib/autopilot.mjs';
import {scoreMotivation,emptySignals,validateMotivation} from '../lib/motivation.mjs';
import {start} from '../server.mjs';
import {exportBackup,restoreBackup} from '../lib/backup.mjs';
const manifest=()=>JSON.parse(fs.readFileSync(new URL('../capabilities/failure-triage.json',import.meta.url)));
const install=m=>{let r=cap.importCapability(cap.initialCapabilities(),m).registry;r=cap.verifyCapability(r,m.id).registry;return cap.activateCapability(r,m.id).registry;};
test('Kirby acquires a new executable recipe, tests before activation, reuses distinct inputs and restores prior version',()=>{
 const m=manifest();let r=cap.initialCapabilities();assert.throws(()=>cap.executeCapability(r,m.id,m.fixtures[0].input));
 r=cap.importCapability(r,m).registry;assert.throws(()=>cap.activateCapability(r,m.id));r=cap.verifyCapability(r,m.id).registry;r=cap.activateCapability(r,m.id).registry;
 const first=cap.executeCapability(r,m.id,m.fixtures[0].input,{runId:'first'});r=first.registry;
 const second=cap.executeCapability(r,m.id,m.fixtures[1].input,{runId:'second'});r=second.registry;assert.notEqual(first.result.outputSha256,second.result.outputSha256);assert.equal(cap.getCapabilityStatus(r)[0].runCount,2);
 const newer=structuredClone(m);newer.version='1.1.0';newer.output.title='개선한 점검표';r=cap.importCapability(r,newer).registry;r=cap.verifyCapability(r,m.id).registry;r=cap.activateCapability(r,m.id).registry;assert.notEqual(cap.executeCapability(r,m.id,m.fixtures[0].input).result.outputSha256,first.result.outputSha256);
 r=cap.rollbackCapability(r,m.id).registry;assert.equal(cap.executeCapability(r,m.id,m.fixtures[0].input).result.outputSha256,first.result.outputSha256);
 r=cap.disableCapability(r,m.id).registry;assert.throws(()=>cap.executeCapability(r,m.id,m.fixtures[0].input));
});
test('failed fixtures, code injection, altered source and wrong pinned input cannot become active execution',()=>{
 const m=manifest(),bad=structuredClone(m);bad.fixtures[0].expectedRows=[];const imported=cap.importCapability(cap.initialCapabilities(),bad).registry;assert.throws(()=>cap.verifyCapability(imported,m.id));
 const code=structuredClone(m);code.steps=[{op:'eval',code:'process.env'}];assert.throws(()=>cap.importCapability(cap.initialCapabilities(),code));
 const r=install(m),request=cap.createCapabilityRequest(r,m.id,m.fixtures[0].input);request.input.records[0].title='changed';assert.throws(()=>cap.validateCapabilityRequest(request,r));
 const altered=structuredClone(r);altered.entries[0].versions[0].manifest.output.title='forged';assert.throws(()=>cap.executeCapability(altered,m.id,m.fixtures[0].input));
 assert.throws(()=>cap.capabilityInputSha256(JSON.parse('{"__proto__":{}}')));
 assert.throws(()=>cap.executeCapability(r,m.id,{records:Array(501).fill(m.fixtures[0].input.records[0])}));
});
test('seven measured motives change the selected action, and observed failure changes the next choice without raising budgets',()=>{
 const components=scoreMotivation(emptySignals({assetGap:1,knowledgeGap:1,coverageGap:1,verificationGap:1,deliveryGap:1,repairNeed:1,reuseArtifacts:1}));assert.equal(Object.values(components).filter(v=>v>0).length,7);
 const s=initialState(),at='2026-09-13T02:00:00.000Z';s.autopilot.enabled=true;s.autopilot.enabledAt=at;
 const input={records:Array.from({length:4},(_,i)=>({id:String(i)}))};
 const action={kind:'capability',taskKey:'cap:failure-triage:'+'a'.repeat(64)+':'+'b'.repeat(64),capabilityId:'failure-triage',manifestHash:'a'.repeat(64),input,focus:'wrath',goal:'실패 원인 점검',successCriterion:'입력과 결과 해시 보관'};
 assert.equal(planAutopilot(s,{at,config:{ready:false,dailyCallLimit:20}}).kind,'world');
 const chosen=planAutopilot(s,{at,config:{ready:false,dailyCallLimit:20},capabilities:[action]});assert.equal(chosen.kind,'capability');assert.ok(chosen.motivation.dominantDrives.includes('wrath'));validateMotivation(chosen.motivation);
 s.jobs.push({id:randomUUID(),status:'failed',createdAt:'2026-09-12T20:00:00.000Z',updatedAt:'2026-09-12T20:00:00.000Z',autopilot:{kind:'capability',taskKey:'previous-failed'},artifacts:[]});
 assert.equal(planAutopilot(s,{at,config:{ready:false,dailyCallLimit:20},capabilities:[action]}).kind,'capability');
 s.jobs.push({...s.jobs[0],id:randomUUID(),autopilot:{kind:'capability',taskKey:'second-failed'}});
 assert.equal(planAutopilot(s,{at,config:{ready:false,dailyCallLimit:20},capabilities:[action]}).kind,'world');
 s.emergencyStop=true;assert.equal(planAutopilot(s,{at,config:{ready:true,dailyCallLimit:20},capabilities:[action]}),null);assert.equal(s.autopilot.dailyAiLimit,4);
});
test('real HTTP capability execution is durable, idempotent, revocable and included in clean restore',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-triad-')),dataDir=path.join(dir,'data'),owner='synthetic-triad-owner-token';let core=await start({host:'127.0.0.1',port:0,dataDir,token:owner,env:{}});
 t.after(()=>{core.shutdown();fs.rmSync(dir,{recursive:true,force:true});});
 const api=async(route,body)=>{const r=await fetch(`http://127.0.0.1:${core.server.address().port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${owner}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const bytes=Buffer.from(await r.arrayBuffer());let value;try{value=JSON.parse(bytes);}catch{value=bytes.toString();}return {status:r.status,value,bytes};};
 assert.equal((await api('/api/autopilot')).value.mind.drives.length,7);const m=manifest();const body={requestId:randomUUID(),id:m.id,input:m.fixtures[0].input};
 const first=await api('/api/capabilities/run',body);assert.equal(first.status,201);assert.equal((await api('/api/capabilities/run',body)).value.jobId,first.value.jobId);
 let job;for(let i=0;i<100;i++){job=(await api('/api/state')).value.jobs.find(j=>j.id===first.value.jobId);if(job.status==='completed')break;await new Promise(r=>setTimeout(r,20));}assert.equal(job.status,'completed');assert.ok(job.capability);assert.equal(job.capabilityRequest,undefined);
 const file=await api('/api/artifacts/'+job.artifacts[0].id);assert.equal(file.status,200);assert.match(file.value,/보존된 실패/);
 core.shutdown();core=await start({host:'127.0.0.1',port:0,dataDir,token:owner,env:{}});assert.equal((await api('/api/artifacts/'+job.artifacts[0].id)).value,file.value);
 const disabled=await api('/api/capabilities/disable',{requestId:randomUUID(),id:m.id});assert.equal(disabled.status,200);assert.equal((await api('/api/capabilities/run',{...body,requestId:randomUUID()})).status,409);
 core.shutdown();const stored=openStore(dataDir);const key=randomBytes(32);const exported=exportBackup({state:stored.state,dataDir,key});const archive=exported.archive??exported;const result=restoreBackup({archive,key,targetDir:path.join(dir,'restore')});assert.equal(result.emergencyStop,true);const restored=openStore(path.join(dir,'restore')).state;assert.ok(restored.capabilities.entries.every(e=>e.activeHash===null));assert.equal(restored.jobs.length,stored.state.jobs.length);assert.equal(digest(fs.readFileSync(path.join(dir,'restore','artifacts',restored.artifacts[job.artifacts[0].id].filename))),digest(file.bytes));
});
test('autonomous motive selects an acquired capability, persists its reason, produces a real artifact and feeds the outcome back',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-motive-loop-')),owner='synthetic-loop-owner-secret',at=new Date().toISOString(),stored=openStore(dir);
 stored.state.autopilot={...stored.state.autopilot,enabled:true,enabledAt:at};
 for(let i=0;i<4;i++)stored.state.jobs.push({id:randomUUID(),title:'합성 실패 '+i,type:'diagnostics',input:'synthetic',status:'failed',step:1,totalSteps:3,createdAt:at,updatedAt:at,error:'synthetic fault',version:1,artifacts:[]});
 stored.save();const core=await start({host:'127.0.0.1',port:0,dataDir:dir,token:owner,env:{},worldFetch:async()=>{throw new Error('synthetic blocked feed');},worldHazardFetch:async()=>{throw new Error('synthetic blocked feed');}});
 t.after(()=>{core.shutdown();fs.rmSync(dir,{recursive:true,force:true});});
 const read=async route=>(await fetch(`http://127.0.0.1:${core.server.address().port}${route}`,{headers:{Authorization:`Bearer ${owner}`}})).json();
 let state,job;for(let i=0;i<150;i++){state=await read('/api/state');job=state.jobs.find(j=>j.autopilot?.kind==='capability');if(job?.status==='completed')break;await new Promise(r=>setTimeout(r,20));}
 assert.equal(job?.status,'completed');assert.ok(job.autopilot.motivation.dominantDrives.includes('wrath'));assert.equal(job.autopilot.capabilityId,'failure-triage');
 assert.equal(state.jobs.filter(j=>j.autopilot?.kind==='capability').length,1);assert.equal(state.agent.usage.attempts,0);
 const feedback=state.autopilot.mind.feedback.find(f=>f.jobId===job.id);assert.equal(feedback.criterionMet,true);assert.equal(feedback.outcome,'artifact_saved');
 const r=await fetch(`http://127.0.0.1:${core.server.address().port}/api/artifacts/${job.artifacts[0].id}`,{headers:{Authorization:`Bearer ${owner}`}});assert.equal(r.status,200);assert.match(await r.text(),/합성 실패 0/);
});
