import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {start} from '../server.mjs';
import {openStore} from '../lib/store.mjs';

const MODEL_ENV={YENO_AGENT_PROVIDER:'openai',YENO_OPENAI_API_KEY:'synthetic-openai-key',YENO_OPENAI_MODEL:'synthetic-openai',YENO_AGENT_DAILY_CALL_LIMIT:'20'};
const DECIDE_TEXT='지금 가장 먼저 할 일을 정해줘';
const fakeAgentFetch=async()=>Response.json({choices:[{finish_reason:'stop',message:{content:'합성 테스트 응답',tool_calls:[]}}],usage:{prompt_tokens:10,completion_tokens:10}});

async function setup(t){
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-voice-expected-quest-'));
  const token='synthetic-voice-expected-quest-owner-token';
  const seeded=openStore(dataDir);seeded.state.modules.ai=true;seeded.save();
  const runtime=await start({host:'127.0.0.1',port:0,dataDir,token,env:MODEL_ENV,agentFetch:fakeAgentFetch});
  const request=async(method,route,body)=>{
    const response=await fetch(`http://127.0.0.1:${runtime.server.address().port}${route}`,{
      method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      ...(body?{body:JSON.stringify(body)}:{}),
    });
    return {status:response.status,body:await response.json()};
  };
  const post=(route,body={})=>request('POST',route,{requestId:randomUUID(),...body});
  const get=route=>request('GET',route);
  t.after(()=>{runtime.shutdown();fs.rmSync(dataDir,{recursive:true,force:true});});
  return {post,get};
}

async function createProjectQuest(h){
  const project=(await h.post('/api/projects',{name:`Expected goal ${randomUUID().slice(0,8)}`,status:'active'})).body.project;
  const quest=(await h.post('/api/quests',{goal:'가장 우선인 프로젝트 산출물을 만든다',projectId:project.id,
    successCriterion:'산출물과 검증 근거를 남긴다',baseline:'기준값 미측정'})).body.quest;
  return {project,quest};
}

test('expectedQuestId rejects malformed IDs and cannot be attached to free conversation',async t=>{
  const h=await setup(t),{quest}=await createProjectQuest(h);
  const malformed=await h.post('/api/voice',{text:DECIDE_TEXT,history:[],expectedQuestId:'not-a-uuid'});
  assert.equal(malformed.status,400);
  const freeChat=await h.post('/api/voice',{text:'오늘 날씨가 어때?',history:[],expectedQuestId:quest.id});
  assert.equal(freeChat.status,400);
  assert.equal((await h.get('/api/state')).body.jobs.length,0,'rejected request creates no job');
});

test('a stale expectedQuestId returns 409 before creating a mission or job',async t=>{
  const h=await setup(t),{quest}=await createProjectQuest(h);
  const before=(await h.get('/api/state')).body;
  const stale=await h.post('/api/voice',{text:DECIDE_TEXT,history:[],expectedQuestId:'00000000-0000-4000-8000-000000000000'});
  assert.equal(stale.status,409,JSON.stringify(stale.body));
  const after=(await h.get('/api/state')).body;
  assert.equal(after.jobs.length,before.jobs.length,'stale selection creates no job');
  assert.equal(after.events.length,before.events.length,'stale selection adds no event');
  assert.equal(after.revision,before.revision,'stale selection does not advance durable state');
  assert.equal(after.requestTracking.retained,before.requestTracking.retained,'rejected request is not recorded as accepted');
  assert.equal((await h.get(`/api/quests/${quest.id}/shadow-missions`)).body.missions.length,0);
});

test('a matching expectedQuestId creates a Shadow mission tied to the selected quest',async t=>{
  const h=await setup(t),{quest}=await createProjectQuest(h);
  const top=(await h.get('/api/quests')).body.decision.top.questId;
  assert.equal(top,quest.id);
  const accepted=await h.post('/api/voice',{text:DECIDE_TEXT,history:[],expectedQuestId:top});
  assert.equal(accepted.status,201,JSON.stringify(accepted.body));
  assert.equal(accepted.body.kind,'shadowMission');
  assert.equal(accepted.body.plannerQuestId,quest.id);
  assert.equal(accepted.body.mission.plannerQuestId,quest.id);
  assert.equal(accepted.body.missionId,accepted.body.mission.missionId);
});
