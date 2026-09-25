import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyLivingLoop} from '../../scripts/verify-living-loop-live.mjs';

const QUEST='11111111-1111-4111-8111-111111111111';
const PROJECT='22222222-2222-4222-8222-222222222222';
const MISSION='33333333-3333-4333-8333-333333333333';
const TOKEN='synthetic-live-check-owner-token';
const CHECK='test-check-0001';
const SOURCE_SHA='a'.repeat(40);
const baseEnv={YENO_TOKEN:TOKEN,YENO_ORIGIN:'http://127.0.0.1:8790',YENO_LIVING_LOOP_EXPECTED_MODEL:'qwen2.5:3b',
  YENO_LIVING_LOOP_EXPECTED_SHA:SOURCE_SHA,YENO_LIVING_LOOP_QUEST_ID:QUEST,YENO_LIVING_LOOP_CHECK_ID:CHECK};
const state=(after=false)=>({emergencyStop:false,agent:{provider:'local',model:'qwen2.5:3b',dailyCallLimit:20,usage:{attempts:0}},
  projects:[{id:PROJECT,status:'active'}],jobs:after?[
    ...['scout','researcher','builder','semanticVerifier'].map((role,index)=>({id:`job-${role}`,status:'completed',shadowAssignment:{missionId:MISSION,role},agent:{provider:'local',model:'qwen2.5:3b',calls:1,unknownCalls:0}})),
    {id:'verify-job',status:'completed',shadowAssignment:{missionId:MISSION,role:'verifier'}},
  ]:[],jev:{authorizesDispatch:false,recoveryAuthorizesDispatch:false,recentShadowDecisions:['scout','researcher','builder'].map((role,index)=>({missionId:MISSION,jobId:`job-${role}`,role}))}});
const questState={decision:{top:{questId:QUEST}},quests:[{id:QUEST,projectId:PROJECT,status:'proposed',synthesis:null}]};
const mission={missionId:MISSION,plannerQuestId:QUEST,projectId:PROJECT,phase:'completed',
  shadows:['scout','researcher','builder'].map(role=>({jobId:`job-${role}`,role,status:'completed',provider:'local',model:'qwen2.5:3b',artifacts:[{id:`artifact-${role}`}]})),
  verify:{jobId:'verify-job',status:'completed',result:{verified:true}},
  semantic:{jobId:'job-semanticVerifier',status:'completed',verdict:{verdict:'pass'}}};

function transport({voiceError=false}={}){
  const calls=[];
  const fetchImpl=async(url,options={})=>{
    const target=new URL(url);calls.push({url:target.href,method:options.method??'GET',headers:options.headers??{}});
    if(target.pathname==='/api/state')return Response.json(state(calls.some(call=>call.method==='POST')));
    if(target.pathname==='/api/quests')return Response.json(questState);
    if(target.pathname==='/api/readiness')return Response.json({sourceCommit:{sha:SOURCE_SHA,source:'git_head'},persistentStore:{durable:true}});
    if(target.pathname==='/api/requests/blackhole-p3-living-loop-v1%3Atest-check-0001')return new Response('{}',{status:404});
    if(target.pathname==='/api/voice'){
      assert.equal(options.method,'POST');
      if(voiceError)throw new Error('connection lost after write');
      const body=JSON.parse(options.body);assert.equal(body.requestId,`blackhole-p3-living-loop-v1:${CHECK}`);assert.equal(body.expectedQuestId,QUEST);
      return Response.json({kind:'shadowMission',missionId:MISSION,plannerQuestId:QUEST,mission},{status:201});
    }
    if(target.pathname===`/api/quests/${QUEST}/shadow-missions`)return Response.json({questId:QUEST,projectId:PROJECT,missions:[mission]});
    throw new Error(`unexpected route ${target.pathname}`);
  };
  return {calls,fetchImpl};
}

test('default mode is read-only and confirms the exact pre-existing local-model goal without creating a job',async()=>{
  const h=transport(),lines=[];
  const result=await verifyLivingLoop({env:baseEnv,fetchImpl:h.fetchImpl,write:line=>lines.push(line)});
  assert.equal(result.status,'PREFLIGHT_READY');
  assert.deepEqual(h.calls.map(call=>call.method),['GET','GET','GET']);
  assert.equal(lines.join('').includes(TOKEN),false);
});

test('--run submits one explicit voice request and verifies local receipts, both verifiers and same-mission JEV evidence',async()=>{
  const h=transport(),lines=[];
  const result=await verifyLivingLoop({env:baseEnv,fetchImpl:h.fetchImpl,run:true,write:line=>lines.push(line),delayImpl:async()=>{}});
  assert.equal(result.status,'VERIFIED',JSON.stringify(result));
  assert.equal(result.missionId,MISSION);
  assert.equal(result.modelReceipts.length,4);
  assert.equal(result.jev.missionDispatchRecords,3);
  assert.equal(h.calls.filter(call=>call.method==='POST').length,1,'voice acceptance is submitted once');
  assert.ok(h.calls.every(call=>call.url.startsWith('http://127.0.0.1:8790/')),'all script HTTP goes to loopback');
  assert.equal(lines.join('').includes(TOKEN),false);
});

test('live run refuses remote origin and a lost voice response stays UNKNOWN without a retry',async()=>{
  let sends=0;
  const invalid=await verifyLivingLoop({env:{...baseEnv,YENO_ORIGIN:'https://example.com'},fetchImpl:async()=>{sends++;},run:true,write:()=>{}});
  assert.equal(invalid.status,'BLOCKED');assert.equal(invalid.code,'origin_must_be_loopback_http');assert.equal(sends,0);
  const h=transport({voiceError:true});
  const unknown=await verifyLivingLoop({env:baseEnv,fetchImpl:h.fetchImpl,run:true,write:()=>{},delayImpl:async()=>{}});
  assert.equal(unknown.status,'UNKNOWN');
  assert.equal(unknown.requestId,`blackhole-p3-living-loop-v1:${CHECK}`,'the persisted identity remains visible after an ambiguous send');
  assert.equal(h.calls.filter(call=>call.method==='POST').length,1);
});

test('live run stops before mutation if the selected goal is not Homunculus top choice',async()=>{
  const h=transport();
  const fetchImpl=async(url,options)=>{
    if(new URL(url).pathname==='/api/quests')return Response.json({...questState,decision:{top:{questId:'44444444-4444-4444-8444-444444444444'}}});
    return h.fetchImpl(url,options);
  };
  const result=await verifyLivingLoop({env:baseEnv,fetchImpl,run:true,write:()=>{}});
  assert.equal(result.status,'BLOCKED');assert.equal(result.code,'requested_quest_is_not_homunculus_top_choice');
  assert.equal(h.calls.some(call=>call.method==='POST'),false);
});

test('read-only preflight requires the running server source SHA to match an explicit expectation',async()=>{
  const h=transport();
  const missing=await verifyLivingLoop({env:{...baseEnv,YENO_LIVING_LOOP_EXPECTED_SHA:''},fetchImpl:h.fetchImpl,write:()=>{}});
  assert.equal(missing.status,'BLOCKED');assert.equal(missing.code,'expected_source_sha_required');
  const mismatched=await verifyLivingLoop({env:{...baseEnv,YENO_LIVING_LOOP_EXPECTED_SHA:'b'.repeat(40)},fetchImpl:h.fetchImpl,write:()=>{}});
  assert.equal(mismatched.status,'BLOCKED');assert.equal(mismatched.code,'runtime_source_sha_mismatch');
});
