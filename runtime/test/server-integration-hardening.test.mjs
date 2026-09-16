import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {start} from '../server.mjs';
import {openStore} from '../lib/store.mjs';
import {codeHash} from '../lib/code-workshop.mjs';
import {ACCEPTANCE_CHECKS} from '../lib/device-evidence.mjs';

// SERVER INTEGRATION PASS (INTEGRATION category, injected provider fetch).
// Tracks A-D wired through the real runtime/store/readiness:
//  A. every provider call carries per-call transport provenance; injected
//     transport never yields LIVE_VERIFIED.
//  B. Closed Loop executes an active, fixture-verified QuickJS capability as a
//     real type:'code' mode:'run' job; artifact SHA == run record output SHA.
//  C. owner device acceptance is durable and DEVICE_VERIFIED only for the exact
//     current release; stale release evidence stays blocked.
//  D. forwarded HTTPS headers are trusted only from the configured proxy; the
//     durable reload check is reported separately from process restart proof.
const COMMIT='c'.repeat(40),APK='a'.repeat(64);
const ENV={YENO_AGENT_PROVIDER:'openai',YENO_OPENAI_API_KEY:'synthetic-openai-key',YENO_OPENAI_MODEL:'synthetic-openai',YENO_AGENT_DAILY_CALL_LIMIT:'6',
  YENO_SOURCE_COMMIT:COMMIT,YENO_CLIENT_VERSION_NAME:'1.2.0',YENO_CLIENT_VERSION_CODE:'12',YENO_APK_SHA256:APK,YENO_ALLOWED_HOSTS:'blackhole.example.test',YENO_TRUSTED_PROXIES:'127.0.0.1'};
const CODE={schemaVersion:1,id:'status-tally',version:'1.0.0',name:'상태 집계',description:'기록 상태별 개수를 셉니다.',source:{kind:'owner',url:'',commit:'',license:'Owner',licenseText:'Owner use'},
  files:[{path:'index.mjs',content:'export default input=>{const tally={};for(const r of input.records)tally[r.status]=(tally[r.status]??0)+1;return {count:input.records.length,tally};}'}],entry:'index.mjs',
  fixtures:[{name:'one',input:{records:[{id:'a',status:'failed'}]},expected:{count:1,tally:{failed:1}}},{name:'two',input:{records:[{id:'a',status:'failed'},{id:'b',status:'paused'}]},expected:{count:2,tally:{failed:1,paused:1}}}],
  inputContract:{records:{fields:{id:'string',status:'string'}}}};

async function setup(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-server-integration-')),token='synthetic-owner-token';
  const modelCalls=[];
  const agentFetch=async(url,init)=>{modelCalls.push(url);return new Response(JSON.stringify({choices:[{message:{role:'assistant',content:'synthetic answer'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1}}),{status:200,headers:{'Content-Type':'application/json'}});};
  let runtime=await start({host:'127.0.0.1',port:0,dataDir:dir,token,env:ENV,agentFetch});
  const request=async(method,route,body,headers={})=>{const r=await fetch(`http://127.0.0.1:${runtime.server.address().port}${route}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...headers},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};};
  const post=(route,body={})=>request('POST',route,{requestId:randomUUID(),...body});
  const get=(route,headers)=>request('GET',route,undefined,headers);
  const wait=async id=>{for(let i=0;i<400;i++){const j=openStore(dir).state.jobs.find(j=>j.id===id);if(j&&['completed','failed','paused'].includes(j.status))return j;await new Promise(r=>setTimeout(r,20));}assert.fail('job did not settle');};
  const restart=async()=>{runtime.shutdown();await new Promise(r=>setTimeout(r,5));runtime=await start({host:'127.0.0.1',port:0,dataDir:dir,token,env:ENV,agentFetch});};
  t.after(()=>{runtime.shutdown();fs.rmSync(dir,{recursive:true,force:true});});
  return {dir,request,post,get,wait,restart,modelCalls,disk:()=>openStore(dir).state,state:()=>runtime.state()};
}

test('TRACK A wiring: provider call receipts carry exact provider/model transport provenance; injected transport is never LIVE_VERIFIED',async t=>{
  const app=await setup(t);
  const quest=(await app.post('/api/quests',{goal:'소유자 목표 하나',provider:'openai',maxCalls:1})).body.quest;
  const run=await app.post(`/api/quests/${quest.id}/run`);assert.equal(run.status,201);
  const job=await app.wait(run.body.job.id);
  assert.ok(app.modelCalls.length>=1);
  const call=job.agentJournal.calls.find(c=>c.status==='settled');
  assert.ok(call,'a settled receipt exists');
  assert.deepEqual({kind:call.transport.kind,provider:call.transport.provider,model:call.transport.model,trigger:call.transport.trigger},{kind:'injected',provider:'openai',model:'synthetic-openai',trigger:'owner'});
  assert.equal(typeof call.transport.authorityCheckedAt,'string');
  assert.equal(job.routing.selectedProvider,'openai');assert.equal(job.routing.selectedModel,'synthetic-openai');
  const readiness=(await app.get('/api/readiness')).body;
  const openai=readiness.providers.find(p=>p.provider==='openai');
  assert.equal(openai.state,'CONFIGURED_UNVERIFIED');assert.equal(openai.injectedCalls,1);assert.equal(openai.exactLiveCalls,0);
  assert.equal(openai.evidence,'settled_calls_via_injected_transport_only');
  assert.ok(readiness.blockers.some(b=>/PROVIDER/i.test(b)||/provider/.test(b)));
  assert.doesNotMatch(JSON.stringify(readiness),/synthetic-openai-key/);
});

test('TRACK B wiring: Closed Loop runs an active verified QuickJS capability as a real code run job; artifact SHA == run output SHA; emergency stop and restart honour the loop',async t=>{
  const app=await setup(t);
  // Two real failed jobs (fixture-failing code verification, no model) -> Homunculus repair goal.
  const broken={...CODE,id:'broken-tally',fixtures:[{name:'one',input:{records:[{id:'a',status:'failed'}]},expected:{count:99}},{name:'two',input:{records:[{id:'b',status:'paused'}]},expected:{count:98}}]};
  const imp=await app.post('/api/code/import',{manifest:broken});assert.equal(imp.status,200,JSON.stringify(imp.body));
  for(let i=0;i<2;i++){const v=await app.post('/api/code/verify',{id:'broken-tally',hash:imp.body.result.hash,activate:false});assert.equal(v.status,201,JSON.stringify(v.body));const j=await app.wait(v.body.jobId);assert.equal(j.status,'failed');}
  const synth=await app.post('/api/quests/synthesize');assert.equal(synth.status,201,JSON.stringify(synth.body));assert.equal(synth.body.quest.synthesis.archetype,'repair');
  // Take the declarative match away so Kirby must find the QuickJS capability.
  assert.equal((await app.post('/api/capabilities/disable',{id:'failure-triage'})).status,200);
  // Import + fixture-verify + activate the QuickJS capability through the owner code workshop.
  const imported=await app.post('/api/code/import',{manifest:CODE});assert.equal(imported.status,200,JSON.stringify(imported.body));
  const verify=await app.post('/api/code/verify',{id:'status-tally',hash:imported.body.result.hash,activate:true});assert.equal(verify.status,201,JSON.stringify(verify.body));
  assert.equal((await app.wait(verify.body.jobId)).status,'completed');
  assert.equal(app.disk().codeWorkshop.entries.find(e=>e.id==='status-tally').activeHash,imported.body.result.hash);

  assert.ok([200,201].includes((await app.post('/api/control',{action:'stop'})).status));
  assert.equal((await app.post('/api/quests/loop')).status,409,'emergency stop refuses the loop');
  assert.ok([200,201].includes((await app.post('/api/control',{action:'resume'})).status));

  const loop=await app.post('/api/quests/loop');
  assert.equal(loop.status,201,JSON.stringify(loop.body));
  assert.equal(loop.body.kind,'execute');assert.equal(loop.body.engine,'quickjs-v1');assert.equal(loop.body.capabilityId,'status-tally');
  assert.equal(loop.body.job.type,'code');
  const job=await app.wait(loop.body.job.id);
  assert.equal(job.status,'completed',JSON.stringify(job.error));
  assert.equal(job.codeTask.mode,'run');assert.equal(job.codeTask.request.id,'status-tally');
  assert.equal(app.modelCalls.length,0,'QuickJS execution makes no model call');
  const disk=app.disk();
  const quest=disk.quests.find(q=>q.loop);
  assert.equal(quest.loop.engine,'quickjs-v1');assert.equal(quest.loop.jobId,job.id);
  const runRecord=disk.codeWorkshop.history.find(h=>h.action==='run'&&h.runId===job.id);
  assert.ok(runRecord,'run record persisted');
  const artifactId=job.artifacts.find(a=>a.name.startsWith('code-result-')).id;
  assert.equal(disk.artifacts[artifactId].sha256,runRecord.outputSha256,'stored artifact bytes hash to the run record output SHA');
  const output=JSON.parse(fs.readFileSync(path.join(app.dir,'artifacts',disk.artifacts[artifactId].filename),'utf8'));
  assert.equal(codeHash(output),runRecord.outputSha256);
  const status=(await app.get('/api/quests')).body.loop;
  const entry=status.quests.find(q=>q.goal.questId===quest.id);
  assert.equal(entry.verification.executionVerified,true);assert.equal(entry.verification.outcomeVerified,false);
  // Restart: same loop, same job, no duplicate execution; a second loop call is 'busy'/'none', never a new job.
  const jobsBefore=disk.jobs.length;
  await app.restart();
  const after=app.disk();
  assert.equal(after.jobs.length,jobsBefore);assert.equal(after.quests.find(q=>q.id===quest.id).loop.jobId,job.id);
  const again=await app.post('/api/quests/loop');
  assert.ok([200,201].includes(again.status));assert.notEqual(again.body.kind,'execute','no duplicate execution of the same goal');
  assert.equal(app.disk().jobs.filter(j=>j.type==='code'&&j.codeTask?.mode==='run').length,1);
});

test('TRACK C/D wiring: owner device acceptance -> DEVICE_VERIFIED only for the exact current release; trusted proxy HTTPS classification; durable reload vs process restart evidence',async t=>{
  const app=await setup(t);
  const checks=Object.fromEntries(ACCEPTANCE_CHECKS.map(c=>[c,true]));
  const enrolled=(await app.post('/api/v1/devices/enroll',{name:'Pixel',platform:'android'})).body.device;
  assert.ok(enrolled?.id&&enrolled.deviceToken);const deviceId=enrolled.id;
  // A paired device credential cannot attest its own acceptance: owner pairing credential only.
  {
    const self=await app.request('POST','/api/device-acceptance',{requestId:randomUUID(),id:'acceptance-self-001',platform:'android',deviceId,release:{sourceCommit:COMMIT,clientVersionName:'1.2.0',clientVersionCode:12,apkSha256:APK},checks,observedAt:new Date().toISOString()},{Authorization:`Bearer ${enrolled.deviceToken}`});
    assert.equal(self.status,403,JSON.stringify(self.body));
  }
  let readiness=(await app.get('/api/readiness')).body;
  assert.notEqual(readiness.androidClient.state,'DEVICE_VERIFIED');
  assert.equal(readiness.androidClient.currentRelease.sourceCommit,COMMIT);
  // Stale release evidence: different APK SHA -> not verified.
  const stale=await app.post('/api/device-acceptance',{id:'acceptance-stale-001',deviceId,platform:'android',release:{sourceCommit:COMMIT,clientVersionName:'1.2.0',clientVersionCode:12,apkSha256:'b'.repeat(64)},checks,observedAt:'2026-09-16T01:00:00.000Z'});
  assert.equal(stale.status,201,JSON.stringify(stale.body));
  readiness=(await app.get('/api/readiness')).body;
  assert.notEqual(readiness.androidClient.state,'DEVICE_VERIFIED');
  // Non-owner attestation is rejected by the record contract (server always stamps owner; a device principal cannot reach this owner route).
  const incomplete=await app.post('/api/device-acceptance',{id:'acceptance-partial-01',deviceId,platform:'android',release:{sourceCommit:COMMIT,clientVersionName:'1.2.0',clientVersionCode:12,apkSha256:APK},checks:{...checks,emergency_stop:false},observedAt:'2026-09-16T01:00:00.000Z'});
  assert.equal(incomplete.status,201);
  readiness=(await app.get('/api/readiness')).body;
  assert.notEqual(readiness.androidClient.state,'DEVICE_VERIFIED');
  const current=await app.post('/api/device-acceptance',{id:'acceptance-current-01',deviceId,platform:'android',release:{sourceCommit:COMMIT,clientVersionName:'1.2.0',clientVersionCode:12,apkSha256:APK},checks,observedAt:'2026-09-16T01:00:00.000Z'});
  assert.equal(current.status,201,JSON.stringify(current.body));
  const dup=await app.post('/api/device-acceptance',{id:'acceptance-current-01',deviceId,platform:'android',release:{sourceCommit:COMMIT,clientVersionName:'1.2.0',clientVersionCode:12,apkSha256:APK},checks,observedAt:'2026-09-16T01:00:00.000Z'});
  assert.equal(dup.status,200);assert.equal(dup.body.added,false);
  readiness=(await app.get('/api/readiness')).body;
  assert.equal(readiness.androidClient.state,'DEVICE_VERIFIED',JSON.stringify(readiness.androidClient));
  assert.equal(app.disk().deviceAcceptances.length,3);

  // HTTPS: plain request from loopback with a spoofed forwarded header, proxy-trusted only when remote is the configured proxy.
  const spoofedHost=(await app.get('/api/readiness',{'x-forwarded-proto':'https','x-forwarded-host':'blackhole.example.test'})).body.httpsReachable;
  // 127.0.0.1 IS the configured trusted proxy here, so the header is honoured; the host is allowed -> LIVE_VERIFIED for this request only.
  assert.equal(spoofedHost.state,'LIVE_VERIFIED');assert.equal(spoofedHost.thisRequest,'https');assert.equal(spoofedHost.via,'trusted-proxy');
  const plain=(await app.get('/api/readiness')).body.httpsReachable;
  assert.equal(plain.thisRequest,'http');assert.notEqual(plain.state,'LIVE_VERIFIED');
  const ambiguous=(await app.get('/api/readiness',{'x-forwarded-proto':'https, http','x-forwarded-host':'blackhole.example.test'})).body.httpsReachable;
  assert.equal(ambiguous.thisRequest,'http');assert.notEqual(ambiguous.state,'LIVE_VERIFIED');

  // Restart evidence: boot records are durable; a self-test durable reload alone is SYNTHETIC; a real process restart between start and reload check is LIVE.
  const boots1=app.disk().runtimeBoots;assert.equal(boots1.length,1);
  assert.equal(readiness.restartPersistence.processRestartVerified.verified,false);
  const selfTest=await app.post('/api/self-test');assert.ok([200,201].includes(selfTest.status),JSON.stringify(selfTest.body));
  if(selfTest.body.jobId)await app.wait(selfTest.body.jobId);
  await app.restart();
  assert.equal(app.disk().runtimeBoots.length,2);
  const status=await app.get('/api/self-test');assert.equal(status.status,200);
  readiness=(await app.get('/api/readiness')).body;
  assert.equal(readiness.restartPersistence.durableStoreReload.verified,true,JSON.stringify(readiness.restartPersistence));
  assert.equal(readiness.restartPersistence.processRestartVerified.verified,true);
  assert.equal(readiness.restartPersistence.state,'LIVE_VERIFIED');
  assert.equal(readiness.restartPersistence.processRestartVerified.currentBootKnown,true);
});
