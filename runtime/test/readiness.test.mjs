import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {start} from '../server.mjs';
import {openStore} from '../lib/store.mjs';
import {providerReality,buildReadiness,assertNoSecrets,PROVIDER_BLOCKER} from '../lib/readiness.mjs';

const MODEL_ENV={YENO_AGENT_PROVIDER:'openai',YENO_OPENAI_API_KEY:'synthetic-openai-key',YENO_OPENAI_MODEL:'synthetic-openai',YENO_AGENT_DAILY_CALL_LIMIT:'6'};
const ok=text=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:text,tool_calls:[]}}],usage:{prompt_tokens:3,completion_tokens:1}}),{headers:{'Content-Type':'application/json'}});

async function setup(t,{env=MODEL_ENV,versioned=true}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-readiness-')),token='synthetic-readiness-owner-token';
  const modelCalls=[];
  const agentFetch=async(url,req)=>{modelCalls.push({url,body:JSON.parse(req.body)});return ok('OK');};
  let runtime=await start({host:'127.0.0.1',port:0,dataDir:dir,token,env,agentFetch});
  // Pairing token is accepted on /api; device token is required on /api/v1 -
  // enroll a device once so the mobile surface is exercised for real.
  let bearer=token,prefix='/api';
  const request=async(method,route,body,auth=bearer)=>{const r=await fetch(`http://127.0.0.1:${runtime.server.address().port}${route}`,{method,headers:{Authorization:`Bearer ${auth}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json().catch(()=>null)};};
  if(versioned){const enroll=await request('POST','/api/v1/devices/enroll',{requestId:randomUUID(),name:'test-phone',platform:'android'},token);assert.equal(enroll.status,201,JSON.stringify(enroll.body));bearer=enroll.body.device.deviceToken;assert.ok(bearer,JSON.stringify(enroll.body));prefix='/api/v1';}
  const post=(route,body={})=>request('POST',prefix+route,{requestId:randomUUID(),...body});
  const get=route=>request('GET',prefix+route);
  const until=async(check,label)=>{for(let i=0;i<300;i++){const value=await check();if(value)return value;await new Promise(r=>setTimeout(r,20));}assert.fail(label);};
  const restart=async()=>{runtime.shutdown();runtime=await start({host:'127.0.0.1',port:0,dataDir:dir,token,env,agentFetch});};
  t.after(()=>{runtime.shutdown();fs.rmSync(dir,{recursive:true,force:true});});
  return {dir,post,get,until,restart,modelCalls,request,token,state:()=>runtime.state(),disk:()=>openStore(dir).state};
}

test('provider reality matrix: key != LIVE_VERIFIED; injected transport stays CONFIGURED_UNVERIFIED; unknown call -> DEGRADED; no name inference',()=>{
  const configured={provider:'nvidia',model:'declared-model',configured:true,missing:[]};
  assert.equal(providerReality({provider:'xai',configured:false,missing:['YENO_XAI_API_KEY']}).state,'UNCONFIGURED');
  assert.equal(providerReality(configured).state,'CONFIGURED_UNVERIFIED');
  const receipt=(status,at,kind)=>({status,at,transport:{kind,provider:'nvidia',model:'declared-model',trigger:'owner',authorityCheckedAt:at}});
  const legacyJob={agentJournal:{provider:'nvidia',model:'declared-model',calls:[{status:'settled',at:'2026-09-16T00:00:00.000Z'}]}};
  assert.equal(providerReality(configured,{jobs:[legacyJob],liveTransport:true}).state,'CONFIGURED_UNVERIFIED','a settled call without per-call transport provenance is not live evidence');
  const injectedJob={agentJournal:{provider:'nvidia',model:'declared-model',calls:[receipt('settled','2026-09-16T00:00:00.000Z','injected')]}};
  assert.equal(providerReality(configured,{jobs:[injectedJob],liveTransport:false}).state,'CONFIGURED_UNVERIFIED','synthetic fetch success is not live evidence');
  const otherModelJob={agentJournal:{provider:'nvidia',model:'other-model',calls:[{...receipt('settled','2026-09-16T00:00:00.000Z','network'),transport:{kind:'network',provider:'nvidia',model:'other-model',trigger:'owner',authorityCheckedAt:'2026-09-16T00:00:00.000Z'}}]}};
  assert.equal(providerReality(configured,{jobs:[otherModelJob],liveTransport:true}).state,'CONFIGURED_UNVERIFIED','live evidence for another model of the same provider does not count');
  const settledJob={agentJournal:{provider:'nvidia',model:'declared-model',calls:[receipt('settled','2026-09-16T00:00:00.000Z','network')]}};
  assert.equal(providerReality(configured,{jobs:[settledJob],liveTransport:true}).state,'LIVE_VERIFIED');
  const unknownJob={agentJournal:{provider:'nvidia',model:'declared-model',calls:[receipt('unknown','2026-09-16T00:00:01.000Z','network')]}};
  assert.equal(providerReality(configured,{jobs:[settledJob,unknownJob],liveTransport:true}).state,'DEGRADED');
  assert.equal(providerReality({...configured,eligible:false}).state,'DISABLED');
  assert.throws(()=>assertNoSecrets({apiKey:'x'}));assert.throws(()=>assertNoSecrets({note:'sk-abcdef'}));
});

test('GET /api/v1/readiness (device surface) reports honest states, PROVIDER blocker, no secrets; POST /api/v1/self-test runs the real local path, survives restart, is idempotent per requestId, blocked under emergency stop',async t=>{
  const app=await setup(t);
  const first=await app.get('/readiness');
  assert.equal(first.status,200,JSON.stringify(first.body));
  const r=first.body;
  for(const key of ['sourceCommit','runtimeVersion','persistentStore','httpsReachable','authentication','devicePairing','emergencyStop','homunculus','closedLoop','kirbyDiscovery','capabilityRegistry','modelRouter','providers','outcomeVerification','soloLeveling','voice','androidClient','restartPersistence','blockers','overall'])assert.ok(key in r,key);
  assert.notEqual(r.overall,'READY');assert.ok(r.blockers.includes(PROVIDER_BLOCKER));
  assert.equal(r.authentication.kind,'device');assert.equal(r.authentication.versionedApi,true);
  assert.equal(r.httpsReachable.thisRequest,'http');assert.notEqual(r.httpsReachable.state,'LIVE_VERIFIED');
  assert.equal(r.providers.find(p=>p.provider==='openai').state,'CONFIGURED_UNVERIFIED','a key alone never verifies a provider');
  assert.ok(r.providers.filter(p=>p.state==='UNCONFIGURED').length>=4);
  assert.equal(r.modelRouter.authorizesCall,false);assert.equal(r.voice.liveVoice,'NOT_WIRED');assert.notEqual(r.androidClient.state,'DEVICE_VERIFIED');
  assert.equal(r.kirbyDiscovery.state,'WIRED_UNVERIFIED');assert.equal(r.soloLeveling.state,'WIRED_UNVERIFIED');
  assert.equal(JSON.stringify(r).includes('synthetic-openai-key'),false);assert.equal(JSON.stringify(r).includes(app.token),false);

  const requestId=randomUUID();
  const started=await app.post('/self-test',{requestId});
  assert.equal(started.status,201,JSON.stringify(started.body));
  const st=started.body.selfTest;
  assert.equal(st.kirby.action,'reuse');assert.equal(st.kirby.origin,'active');assert.equal(st.capabilityId,'failure-triage');
  assert.equal(st.homunculus.observed,true);assert.equal(st.homunculus.persisted,false);
  assert.equal(st.providerLive.status,'BLOCKED');assert.equal(st.providerLive.reason,PROVIDER_BLOCKER);
  assert.equal(st.outcomeVerified,false);
  const dup=await app.post('/self-test',{requestId});
  assert.equal(dup.status,201);assert.equal(dup.body.selfTest.id,st.id,'same requestId -> same self-test, no second job');

  const done=await app.until(async()=>{const g=await app.get('/self-test');return g.body.latest.status==='PASSED'?g.body.latest:null;},'self-test did not pass');
  assert.equal(done.steps.jarvis,'PASSED');assert.equal(done.steps.executionVerification,'PASSED');assert.equal(done.execution.executionVerified,true);
  assert.equal(done.steps.growth,'PASSED');assert.equal(done.growth.grade,'D');assert.equal(done.steps.durableReload,'PASSED');assert.equal(done.outcomeVerified,false);
  assert.equal(done.processRestart,'not_performed_by_self_test');
  assert.equal(app.modelCalls.length,0,'the local self-test never calls a model');
  assert.equal(app.state().jobs.filter(j=>j.selfTestId===st.id).length,1);

  const mid=await app.get('/readiness');
  assert.equal(mid.body.kirbyDiscovery.state,'SYNTHETIC_VERIFIED');assert.equal(mid.body.capabilityRegistry.state,'SYNTHETIC_VERIFIED');
  assert.equal(mid.body.soloLeveling.grades['failure-triage'],'D');assert.equal(mid.body.homunculus.state,'SYNTHETIC_VERIFIED');
  assert.equal(mid.body.restartPersistence.state,'SYNTHETIC_VERIFIED');assert.notEqual(mid.body.overall,'READY');

  await app.restart();
  const after=await app.get('/self-test');
  assert.equal(after.status,200);assert.equal(after.body.latest.id,st.id);assert.equal(after.body.latest.status,'PASSED');
  assert.equal(after.body.latest.artifactSha256,done.artifactSha256);assert.equal(after.body.latest.execution.executionVerified,true);
  assert.equal((await app.get('/readiness')).body.soloLeveling.grades['failure-triage'],'D');

  // Live-provider smoke is refused honestly with an injected transport.
  const live=await app.post('/self-test',{liveProvider:true});
  assert.equal(live.status,201);assert.equal(live.body.selfTest.providerLive.status,'BLOCKED');assert.equal(live.body.selfTest.providerLive.reason,'synthetic_transport_injected');
  assert.equal(app.modelCalls.length,0);
  await app.until(async()=>(await app.get('/self-test')).body.latest.status==='PASSED','second self-test');

  const stop=await app.request('POST','/api/control',{requestId:randomUUID(),action:'stop'},app.token);
  assert.ok([200,201].includes(stop.status),JSON.stringify(stop.body));
  const blocked=await app.post('/self-test');
  assert.equal(blocked.status,409);
  const stopped=await app.get('/readiness');
  assert.equal(stopped.body.emergencyStop.active,true);assert.equal(stopped.body.overall,'BLOCKED');
  assert.equal(app.disk().selfTests.length,2);
});

test('android release ledger cross-check: no ledger -> NOT_WIRED; serving release matches the signed ledger -> LIVE_VERIFIED; mismatch (unsigned build) -> BLOCKED',()=>{
  const facts=(over={})=>({
    state:{jobs:[],quests:[],outcomes:[],devices:{},emergencyStop:false,capabilities:{entries:[{id:'x',activeHash:'a'.repeat(64),versions:[]}],history:[]}},
    sourceCommit:{sha:'c'.repeat(40),source:'test'},runtimeVersion:'0.0.0',apiVersion:'1',
    store:{directory:'d',durable:true,recovered:false},
    request:{scheme:'https',via:'direct-tls',publicHost:'blackhole.example.test',encrypted:true,forwarded:{present:false,trusted:false,ignored:false},trustedProxyCount:0,allowedHostCount:1},
    principal:{kind:'pairing',versioned:false}, providers:[], brainPool:{declared:0,configured:0}, liveTransport:false, at:'2026-09-17T00:00:00.000Z',
    ...over
  });
  const noLedger=buildReadiness(facts());
  assert.equal(noLedger.androidClient.release.state,'NOT_WIRED');
  assert.equal(noLedger.androidClient.release.ledgerReleases,0);

  const signed={sourceCommit:'c'.repeat(40),versionName:'1.2.0',versionCode:12,apkSha256:'a'.repeat(64),aabSha256:'b'.repeat(64),signerSha256:'d'.repeat(64),builtAt:'2026-09-16T00:00:00.000Z',workflowRun:'123'};
  const currentRelease={sourceCommit:'c'.repeat(40),client:{versionName:'1.2.0',versionCode:12,apkSha256:'a'.repeat(64)}};
  const matched=buildReadiness(facts({androidLedger:{version:1,releases:[signed]},currentRelease}));
  assert.equal(matched.androidClient.release.state,'LIVE_VERIFIED');
  assert.equal(matched.androidClient.release.servingMatchesLedgerSignature,true);
  assert.deepEqual(matched.androidClient.release.latestSigned.signerSha256,'d'.repeat(64));
  assert.deepEqual(matched.androidClient.release.blockers,[]);

  // Serving an APK the ledger never signed (drift, or an unsigned/debug build) is BLOCKED, not silently accepted.
  const driftedRelease={sourceCommit:'c'.repeat(40),client:{versionName:'1.2.0',versionCode:12,apkSha256:'f'.repeat(64)}};
  const drifted=buildReadiness(facts({androidLedger:{version:1,releases:[signed]},currentRelease:driftedRelease}));
  assert.equal(drifted.androidClient.release.state,'BLOCKED');
  assert.equal(drifted.androidClient.release.servingMatchesLedgerSignature,false);
  assert.deepEqual(drifted.androidClient.release.blockers,['serving_release_not_in_signed_ledger']);
});
