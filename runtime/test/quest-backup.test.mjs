import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {initialState, openStore, digest} from '../lib/store.mjs';
import {exportBackup, decryptBackup, restoreBackup} from '../lib/backup.mjs';
import {planQuest, publicQuest, recordQuestOutcome} from '../lib/quests.mjs';
import {rememberReceipt, findReceipt, lookupRequest, REQUEST_CACHE_MAX_ENTRIES} from '../lib/request-ledger.mjs';

const at='2026-01-01T00:00:00.000Z';
function temporary(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'yeno-quest-backup-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  return root;
}
function writeState(directory,state){
  fs.mkdirSync(directory,{recursive:true});
  const payload=JSON.stringify(state);
  fs.writeFileSync(path.join(directory,'state.json'),JSON.stringify({format:1,sha256:digest(payload),payload}));
}
function encrypt(payload,key){
  const magic=Buffer.from('YENOBK1\n'),iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(magic);
  const content=Buffer.concat([cipher.update(JSON.stringify(payload)),cipher.final()]);
  return Buffer.concat([magic,iv,cipher.getAuthTag(),content]);
}
function fixture(t){
  const root=temporary(t),dataDir=path.join(root,'source');
  fs.mkdirSync(path.join(dataDir,'artifacts'),{recursive:true});
  const state=initialState(),key=crypto.randomBytes(32);
  state.modules.ai=true;
  const project={id:crypto.randomUUID(),name:'A03 한끼안부',repositoryUrl:'https://github.com/wooyeonho/yeno-os',summary:'기존 프로젝트 보존',nextAction:'인수인계 문서 작성',status:'active',version:2,createdAt:at,updatedAt:at};
  state.projects.push(project);
  const make=(provider,status)=>{
    const quest=planQuest({goal:'바로 사용할 인수인계 문서 작성',provider,projectId:project.id,driveId:'sloth',maxCalls:2,durationMinutes:30},state);
    const job={id:crypto.randomUUID(),title:'목표 실행',type:'agent',input:'인수인계 문서',normalized:'인수인계 문서',inputSha256:digest('인수인계 문서'),status,step:status==='completed'?3:1,totalSteps:3,createdAt:at,updatedAt:at,error:null,version:3,artifacts:[],projectId:project.id,questId:quest.id,selectedProvider:provider,callLimit:2,deadlineAt:'2026-01-01T00:30:00.000Z',agentJournal:{provider,model:provider==='openai'?'gpt-4.1-mini':'gemini-test-model',calls:[{id:crypto.randomUUID(),at,status:status==='completed'?'settled':'reserved',inputTokens:status==='completed'?12:null,outputTokens:status==='completed'?8:null}],history:[{role:'user',content:'인수인계 문서'}]}};
    if(status==='completed')job.agentJournal.history.push({role:'assistant',content:'완성 문서 본문',toolCalls:[]});
    quest.jobId=job.id;quest.status='assigned';state.quests.push(quest);state.jobs.push(job);
    return {quest,job};
  };
  const completed=make('openai','completed'),running=make('gemini','running');
  const artifactId=crypto.randomUUID(),content=Buffer.from('# 인수인계 문서\n\n확인된 결과를 보존합니다.\n');
  state.artifacts[artifactId]={id:artifactId,name:'handoff.md',filename:`${artifactId}.md`,sha256:digest(content),bytes:content.length,jobId:completed.job.id};
  completed.job.artifacts.push({id:artifactId,name:'handoff.md'});
  fs.writeFileSync(path.join(dataDir,'artifacts',`${artifactId}.md`),content);
  const outcome=recordQuestOutcome({questId:completed.quest.id,ledger:'honor',summary:'사용자가 문서의 활용을 보고함',artifactId},state);
  state.outcomes.push(outcome);
  const deviceId=crypto.randomUUID();
  state.devices[deviceId]={id:deviceId,name:'Phone',platform:'android',tokenHash:digest('synthetic-device-token'),createdAt:at,lastSeenAt:at,revokedAt:null};
  state.snapshots.push({id:crypto.randomUUID(),label:'기존 기억과 설정',createdAt:at,data:{memories:[],settings:{concurrency:1,modules:structuredClone(state.modules)}}});
  return {root,dataDir,state,key,completed,running,outcome,artifactId,content,deviceId};
}

test('goal execution evidence and provider reservations survive encrypted export and clean stopped restore',t=>{
  const f=fixture(t),before=structuredClone(f.state),archive=exportBackup(f);
  const decoded=decryptBackup(archive,f.key);
  assert.deepEqual(decoded.state,before);
  const targetDir=path.join(f.root,'restored'),summary=restoreBackup({archive,key:f.key,targetDir});
  const recovered=openStore(targetDir).state;
  assert.equal(summary.pausedJobCount,1);assert.equal(summary.revokedDeviceCount,1);
  assert.equal(recovered.emergencyStop,true);assert.equal(recovered.modules.ai,false);
  assert.equal(recovered.devices[f.deviceId].revokedAt,summary.restoredAt);
  assert.deepEqual(recovered.quests,before.quests);assert.deepEqual(recovered.outcomes,before.outcomes);
  assert.deepEqual(recovered.snapshots,before.snapshots);
  assert.deepEqual(recovered.jobs.find(j=>j.id===f.completed.job.id),f.completed.job);
  const paused=recovered.jobs.find(j=>j.id===f.running.job.id);
  assert.equal(paused.status,'paused');assert.equal(paused.pauseReason,'backupRestore');
  assert.equal(paused.agentJournal.calls[0].status,'unknown');
  assert.equal(paused.callLimit,2);assert.equal(paused.selectedProvider,'gemini');assert.equal(paused.deadlineAt,f.running.job.deadlineAt);
  const view=publicQuest(recovered.quests.find(q=>q.id===f.running.quest.id),recovered);
  assert.equal(view.status,'paused');assert.equal(view.outcomeUnknown,true);
  const finished=publicQuest(recovered.quests.find(q=>q.id===f.completed.quest.id),recovered);
  assert.equal(finished.executionUsage.inputTokens,12);assert.equal(finished.executionUsage.outputTokens,8);
  assert.equal(finished.outcomeRecords[0].verification,'self_reported');
  assert.equal(finished.artifacts[0].sha256,digest(f.content));
  assert.deepEqual(fs.readFileSync(path.join(targetDir,'artifacts',`${f.artifactId}.md`)),f.content);
  assert.deepEqual(f.state,before,'backup and restore do not mutate the running source state');
});

test('legacy stores and backups add missing goal collections without replacing existing data',t=>{
  const root=temporary(t),directory=path.join(root,'legacy'),state=initialState();
  delete state.quests;delete state.outcomes;
  state.memories.push({id:crypto.randomUUID(),text:'기존 기억 유지',createdAt:at});
  writeState(directory,state);
  const store=openStore(directory);
  assert.deepEqual(store.state.quests,[]);assert.deepEqual(store.state.outcomes,[]);
  assert.deepEqual(store.state.memories,state.memories);
  const key=crypto.randomBytes(32),archive=exportBackup({state,dataDir:directory,key});
  const migrated=decryptBackup(archive,key).state;
  assert.deepEqual(migrated.quests,[]);assert.deepEqual(migrated.outcomes,[]);
  assert.equal(Object.hasOwn(state,'quests'),false,'export migration happens on its own snapshot');
  store.save();assert.deepEqual(openStore(directory).state.memories,state.memories);
});

test('corrupt goal evidence and invalid execution limits are refused by store and authenticated backup before restore writes',t=>{
  const f=fixture(t),pristine=decryptBackup(exportBackup(f),f.key);
  const changes=[
    s=>{s.quests=null;},s=>{s.outcomes={};},
    s=>{s.quests[0].jobId=crypto.randomUUID();},
    s=>{s.quests[0].costUsd=0;},
    s=>{s.outcomes[0].verification='independent_verified';},
    s=>{s.outcomes[0].artifactSha256=digest('different bytes');},
    s=>{s.jobs[0].selectedProvider='auto';},
    s=>{s.jobs[0].callLimit=0;},s=>{s.jobs[0].callLimit=5;},s=>{s.jobs[0].callLimit=1.5;},
    s=>{s.jobs[0].deadlineAt='2026-01-01';},
    s=>{s.jobs[0].questId=crypto.randomUUID();}
  ];
  for(const [index,change] of changes.entries()){
    const payload=structuredClone(pristine);change(payload.state);
    const targetDir=path.join(f.root,`invalid-${index}`);
    assert.throws(()=>restoreBackup({archive:encrypt(payload,f.key),key:f.key,targetDir}),`invalid case ${index} must fail backup validation`);
    assert.equal(fs.existsSync(targetDir),false);
    const corruptDir=path.join(f.root,`corrupt-${index}`);writeState(corruptDir,payload.state);
    assert.throws(()=>openStore(corruptDir),/unreadable/,`invalid case ${index}: malformed present data must never be replaced by empty arrays`);
  }
});

test('evicted goal and outcome receipts recover current durable evidence without accepting duplicate mutations',t=>{
  const f=fixture(t),questHash=digest('quest request'),outcomeHash=digest('outcome request');
  rememberReceipt(f.state,'goal-only',questHash,{status:201,payload:{kind:'quest',quest:publicQuest(f.completed.quest,f.state)}});
  rememberReceipt(f.state,'outcome-only',outcomeHash,{status:201,payload:{outcome:f.outcome}});
  rememberReceipt(f.state,'goal-and-job',digest('combined request'),{status:201,payload:{quest:publicQuest(f.running.quest,f.state),job:{id:f.running.job.id,status:'running'}}});
  for(let index=0;index<REQUEST_CACHE_MAX_ENTRIES;index++)rememberReceipt(f.state,`fill-${index}`,digest(`filler-${index}`),{status:200,payload:{accepted:true}});
  assert.equal(lookupRequest(f.state,'goal-only').cached,false);assert.equal(lookupRequest(f.state,'outcome-only').cached,false);
  assert.equal(lookupRequest(f.state,'goal-and-job').reference.collection,'jobs','existing job-first reference ordering is preserved');
  const directory=path.join(f.root,'receipt-store');writeState(directory,f.state);
  const recovered=openStore(directory).state;
  assert.deepEqual(findReceipt(recovered,'goal-only',questHash).payload.quest,publicQuest(f.completed.quest,recovered));
  assert.deepEqual(findReceipt(recovered,'outcome-only',outcomeHash).payload.outcome,f.outcome);
  assert.throws(()=>findReceipt(recovered,'goal-only',digest('changed request')),/different request/);
  assert.equal(recovered.quests.length,2);assert.equal(recovered.outcomes.length,1);
});
