import test from 'node:test';
import assert from 'node:assert/strict';
import {rankMotivatedCandidates,validateMotivation} from '../lib/motivation.mjs';
import {DRIVE_IDS,DRIVE_CANON} from '../lib/seven-drives.mjs';
import {initialDriveState,validateDriveState,advanceHunger,debateFor,driveVoice,recordDriveDecision} from '../lib/drive-state.mjs';
import {start} from '../server.mjs';
import {openStore} from '../lib/store.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const at = '2026-09-28T00:00:00.000Z';
const candidate = rankMotivatedCandidates({jobs:[]}, [{action:{kind:'quest',taskKey:'quest:one'},goal:'근거가 있는 문서를 만든다',successCriterion:'검증된 결과 파일을 저장한다',signals:{reuseArtifacts:2,assetGap:1,knowledgeGap:3,verificationGap:1,estimatedCalls:0,ownFailures:1,unknownCalls:0}}], at)[0];
const decision = {at,top:candidate,candidates:[candidate]};

test('hunger_starts_at_50', () => {
  const state=initialDriveState();
  assert.deepEqual(Object.values(state.hunger),Array(7).fill(50));
  assert.equal(validateDriveState(state),true);
});
test('dominant_drives_are_satiated', () => {
  const next=advanceHunger(initialDriveState(),decision,at);
  // E1 intentionally replaces the uniform v1 -30 with greed -12 and lust -40.
  for(const id of candidate.motivation.dominantDrives)assert.equal(next.hunger[id],id==='greed'?46:id==='lust'?37:40);
});
test('starved_drive_grows_bounded_0_100', () => {
  let state=initialDriveState();
  for(let i=0;i<80;i++)state=advanceHunger(state,decision,new Date(Date.parse(at)+i*1000).toISOString());
  for(const id of DRIVE_IDS)assert.ok(state.hunger[id]>=0&&state.hunger[id]<=100);
  assert.ok(DRIVE_IDS.some(id=>!candidate.motivation.dominantDrives.includes(id)&&state.hunger[id]===100));
});
test('fingerprint_roundtrip_after_restart', () => {
  const state=advanceHunger(initialDriveState(),decision,at);
  assert.equal(validateDriveState(JSON.parse(JSON.stringify(state))),true);
  assert.throws(()=>validateDriveState({...state,hunger:{...state.hunger,greed:99}}),TypeError);
});
test('debate_has_at_least_three_voices', () => {
  const voices=debateFor(decision.candidates,initialDriveState().hunger,at);
  assert.equal(voices.length,3);
  assert.equal(new Set(voices.map(v=>v.driveId)).size,3);
  assert.ok(voices.every(v=>v.text.length<=120&&Number.isFinite(v.weightedScore)));
});
test('voice_uses_real_signal_numbers_only', () => {
  for(const id of DRIVE_IDS){
    const voice=driveVoice(id,candidate,50);
    // E2 moves hunger to its numeric display and gives the voice its own evidence-backed register.
    assert.ok(voice.startsWith(`${DRIVE_CANON.find(drive=>drive.id===id).legacyName}:`));
    assert.match(voice,/\d/);
    assert.ok(voice.length<=120);
  }
  assert.match(driveVoice('gluttony',candidate,50),/3건/);
});

test('hungriest_of_all_seven_has_a_persisted_evidence_voice',()=>{
  const state={driveState:initialDriveState(),driveDebates:[]};
  const recorded=recordDriveDecision(state,decision,{at,source:'owner'});
  const topId=DRIVE_IDS.reduce((best,id)=>recorded.driveState.hunger[id]>recorded.driveState.hunger[best]?id:best);
  assert.equal(recorded.debate.hungryVoice.driveId,topId);
  assert.equal(recorded.debate.hungryVoice.text,driveVoice(topId,candidate,recorded.driveState.hunger[topId]));
});
test('validate_motivation_unchanged', () => {
  assert.equal(validateMotivation(candidate.motivation),true);
  assert.throws(()=>validateMotivation({...candidate.motivation,debate:[]}),TypeError);
});

test('three_real_decisions_record_hunger_and_voices_and_restart_keeps_fingerprint', async t => {
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-drive-h1-'));
  const token='synthetic-drive-owner';
  let app=await start({host:'127.0.0.1',port:0,dataDir,token,env:{}});
  t.after(()=>{app.shutdown();fs.rmSync(dataDir,{recursive:true,force:true});});
  const request=async(method,route,body)=>{
    const response=await fetch(`http://127.0.0.1:${app.server.address().port}${route}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    return {status:response.status,body:await response.json()};
  };
  const post=(route,body={})=>request('POST',route,{requestId:randomUUID(),...body});
  const project=await post('/api/projects',{name:'욕망 회의 프로젝트',status:'active',summary:'합성 인수',nextAction:'순차 결정'});
  assert.equal(project.status,201,JSON.stringify(project.body));
  const snapshots=[];
  for(let i=0;i<3;i++){
    const quest=await post('/api/quests',{goal:`근거 작업 ${i+1}`,projectId:project.body.project.id,successCriterion:'파일과 검증 근거',baseline:'기준값 미측정'});
    assert.equal(quest.status,201,JSON.stringify(quest.body));
    const decided=await post('/api/quests/decide');
    assert.equal(decided.status,201,JSON.stringify(decided.body));
    const disk=openStore(dataDir).state;
    snapshots.push({hunger:disk.driveState.hunger,fingerprint:disk.driveState.fingerprint,debate:disk.driveDebates.at(-1)});
  }
  assert.equal(new Set(snapshots.map(x=>x.fingerprint)).size,3);
  assert.ok(snapshots.every(x=>x.debate?.voices.length===3&&x.debate.hungryVoice?.text));
  const stopped=await post('/api/control',{action:'stop'});
  assert.equal(stopped.status,200,JSON.stringify(stopped.body));
  const blocked=await post('/api/quests/decide');
  assert.equal(blocked.status,409,JSON.stringify(blocked.body));
  assert.equal(openStore(dataDir).state.driveDebates.length,3);
  const before=snapshots.at(-1).fingerprint;
  const status=await request('GET','/api/drives/status');
  assert.equal(status.body.lastDebate.length,3);
  if(process.env.BLACKHOLE_H1_EVIDENCE_DIR){
    fs.mkdirSync(process.env.BLACKHOLE_H1_EVIDENCE_DIR,{recursive:true});
    fs.writeFileSync(path.join(process.env.BLACKHOLE_H1_EVIDENCE_DIR,'h1-hunger.json'),JSON.stringify({scope:'isolated-core',decisions:snapshots.map((item,index)=>({number:index+1,hunger:item.hunger,fingerprint:item.fingerprint})),blockedDecisionRecorded:false,restartFingerprint:before},null,2)+'\n');
    fs.writeFileSync(path.join(process.env.BLACKHOLE_H1_EVIDENCE_DIR,'h1-debate.json'),JSON.stringify({scope:'isolated-core',debates:snapshots.map(item=>item.debate)},null,2)+'\n');
  }
  app.shutdown();app=await start({host:'127.0.0.1',port:0,dataDir,token,env:{}});
  assert.equal(openStore(dataDir).state.driveState.fingerprint,before);
});
