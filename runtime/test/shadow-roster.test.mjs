import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {initialShadowRoster,extractShadows,renameShadow,rosterOverview,validateShadowRoster,shadowRank} from '../lib/shadow-roster.mjs';
import {openStore} from '../lib/store.mjs';
import {start} from '../server.mjs';

function passedMission() {
  const missionId=randomUUID(),builderId=randomUUID(),verifierId=randomUUID(),semanticId=randomUUID(),artifactId=randomUUID();
  const at='2026-09-28T00:00:00.000Z';
  const roles=['scout','researcher','builder','verifier','semanticVerifier'];
  const jobs=roles.map(role=>({id:role==='builder'?builderId:role==='verifier'?verifierId:role==='semanticVerifier'?semanticId:randomUUID(),status:'completed',shadowAssignment:{missionId,role},artifacts:[{id:role==='builder'?artifactId:randomUUID()}],createdAt:at,updatedAt:at}));
  jobs[3].verifyResult={verified:true};
  jobs[4].semanticVerdict={version:1,missionId,builderJobId:builderId,verifierJobId:verifierId,artifactRefs:[artifactId],verdict:'pass',createdAt:at};
  // Policy v2 fixture includes an earlier failed attempt at the same goal.
  for(const job of jobs)job.shadowAssignment.goal='복구';
  const failed={id:randomUUID(),status:'failed',shadowAssignment:{missionId:randomUUID(),role:'builder',goal:'복구'},createdAt:'2026-09-27T00:00:00.000Z',updatedAt:'2026-09-27T00:00:00.000Z',artifacts:[]};
  jobs.push(failed);
  return {missionId,jobs,artifacts:{[artifactId]:{id:artifactId,jobId:builderId,sha256:'a'.repeat(64)}},at};
}

test('no_extraction_without_both_verifier_passes',()=>{
  const f=passedMission(),state={jobs:f.jobs,artifacts:f.artifacts};
  const initial=initialShadowRoster();
  const rejected=structuredClone(state);rejected.jobs[3].verifyResult.verified=false;
  assert.equal(extractShadows(initial,rejected,f.missionId,f.at).roster.entries.length,0);
  const semantic=structuredClone(state);semantic.jobs[4].semanticVerdict.verdict='uncertain';
  assert.equal(extractShadows(initial,semantic,f.missionId,f.at).roster.entries.length,0);
  assert.equal(extractShadows(initial,state,f.missionId,f.at).born.length,4);
});

test('extraction_names_are_deterministic_and_repeated_mission_is_idempotent',()=>{
  const f=passedMission(),state={jobs:f.jobs,artifacts:f.artifacts};
  const first=extractShadows(initialShadowRoster(),state,f.missionId,f.at);
  assert.deepEqual(first.born.map(e=>e.name),['복구의 정찰자','복구의 연구자','복구의 건설자','복구의 검증자']);
  assert.equal(first.roster.entries.length,4);
  assert.equal(rosterOverview(first.roster).byRank.E,4);
  const repeat=extractShadows(first.roster,state,f.missionId,f.at);
  assert.equal(repeat.born.length,0);assert.equal(repeat.grown.length,0);
  assert.deepEqual(repeat.roster,first.roster);
  validateShadowRoster(first.roster);
});

test('repeat_verified_role_grows_existing_shadow_without_duplicate',()=>{
  const a=passedMission(),b=passedMission();
  const first=extractShadows(initialShadowRoster(),{jobs:a.jobs,artifacts:a.artifacts},a.missionId,a.at);
  const second=extractShadows(first.roster,{jobs:[...a.jobs,...b.jobs],artifacts:{...a.artifacts,...b.artifacts}},b.missionId,b.at);
  assert.equal(second.roster.entries.length,4);
  assert.equal(second.grown.length,4);
  assert.ok(second.roster.entries.every(e=>e.missions.length===2));
  assert.equal(rosterOverview(second.roster).total,4);
  assert.deepEqual(rosterOverview(second.roster).members.map(member=>member.rank),['E','E','E','E']);
});

test('evidence-derived shadow grades require stored role artifacts and distinct inputs',()=>{
  const first=passedMission(),second=passedMission();
  const state={jobs:[],artifacts:{},shadowRoster:initialShadowRoster()};
  const add=(fixture,input)=>{
    for(const job of fixture.jobs.filter(j=>j.status==='completed')){
      job.type=job.shadowAssignment.role==='verifier'?'verify':'agent';
      job.input=`${job.shadowAssignment.role}:${input}`;
      const artifactId=job.artifacts[0].id;
      state.artifacts[artifactId]={id:artifactId,jobId:job.id,sha256:'b'.repeat(64)};
    }
    state.jobs.push(...fixture.jobs);
    state.shadowRoster=extractShadows(state.shadowRoster,state,fixture.missionId,fixture.at).roster;
  };
  add(first,'one');
  assert.equal(state.shadowRoster.entries.length,4);
  assert.deepEqual(rosterOverview(state.shadowRoster,state).byRank,{E:0,D:4,C:0,B:0,A:0,S:0});
  const firstFingerprint=shadowRank(state,state.shadowRoster.entries[0]).fingerprint;
  assert.equal(shadowRank(structuredClone(state),state.shadowRoster.entries[0]).fingerprint,firstFingerprint);
  add(second,'two');
  assert.deepEqual(rosterOverview(state.shadowRoster,state).byRank,{E:0,D:0,C:4,B:0,A:0,S:0});
  delete state.artifacts[first.jobs[0].artifacts[0].id];
  assert.equal(shadowRank(state,state.shadowRoster.entries[0]).grade,'D');
});

test('rename_rejects_control_chars_and_fingerprint_tampering',()=>{
  const f=passedMission(),roster=extractShadows(initialShadowRoster(),{jobs:f.jobs,artifacts:f.artifacts},f.missionId,f.at).roster;
  assert.throws(()=>renameShadow(roster,roster.entries[0].id,'나\n쁜',f.at));
  assert.throws(()=>renameShadow(roster,roster.entries[0].id,'\n나쁜',f.at));
  const renamed=renameShadow(roster,roster.entries[0].id,'  이그리트  ',f.at);
  assert.equal(renamed.entries[0].name,'이그리트');
  assert.equal(renamed.entries[0].renamedBy,'owner');
  validateShadowRoster(renamed);
  const tampered=structuredClone(renamed);tampered.entries[0].name='위조';
  assert.throws(()=>validateShadowRoster(tampered));
});

test('roster_survives_restart_same_fingerprint_and_owner_api',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-s1-roster-'));
  const owner='synthetic-s1-owner-token';
  let runtime;
  t.after(async()=>{const closed=new Promise(resolve=>runtime.server.once('close',resolve));runtime.shutdown();runtime.server.closeAllConnections();await closed;await fs.promises.rm(dir,{recursive:true,force:true});});
  const f=passedMission(),store=openStore(dir);
  store.state.shadowRoster=extractShadows(store.state.shadowRoster,{jobs:f.jobs,artifacts:f.artifacts},f.missionId,f.at).roster;
  store.save();
  const original=store.state.shadowRoster.fingerprint;
  const launch=async()=>{runtime=await start({host:'127.0.0.1',port:0,dataDir:dir,token:owner,env:{}});};
  const get=async endpoint=>fetch(`http://127.0.0.1:${runtime.server.address().port}${endpoint}`,{headers:{Authorization:`Bearer ${owner}`}});
  await launch();
  const response=await get('/api/shadow-army/roster');
  assert.equal(response.status,200);
  const rosterJson=await response.json();
  assert.equal(rosterJson.roster.fingerprint,original);
  const publicState=await (await get('/api/state')).json();
  assert.equal(publicState.shadowArmy.roster.total,4);
  assert.equal(publicState.shadowArmy.roster.byRank.E,4);
  assert.equal((await fetch(`http://127.0.0.1:${runtime.server.address().port}/api/shadow-army/roster`)).status,401);
  runtime.shutdown();await launch();
  assert.equal((await (await get('/api/shadow-army/roster')).json()).roster.fingerprint,original);
});
