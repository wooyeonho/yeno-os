import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {agentConfig} from '../lib/provider-config.mjs';
import {automaticMission} from '../lib/agent.mjs';
import {initialAutopilot,planAutopilot,getAutopilotStatus} from '../lib/autopilot.mjs';
import {RESEARCH_TRACKS} from '../lib/research.mjs';

const START='2026-09-13T00:00:00.000Z';
const FUTURE='2026-09-13T01:00:00.000Z';
const config=agentConfig({
  YENO_AGENT_PROVIDER:'openai',
  YENO_AGENT_DAILY_CALL_LIMIT:'4',
  YENO_OPENAI_MODEL:'synthetic-model',
  YENO_OPENAI_API_KEY:'synthetic-key',
  YENO_AGENT_AUTORUN:'true',
});
function state(documents=false){
  return {
    autopilot:{...initialAutopilot(),enabled:true,enabledAt:START},
    emergencyStop:false,
    modules:{documents,ai:true},
    jobs:[],
    projects:RESEARCH_TRACKS.map(track=>({id:track.projectId,status:'active'})),
    artifacts:{},
    discovery:{enabled:true,lastRun:{startedAt:START,status:'completed',added:1,updated:0}},
    ecosystem:{enabled:false,lastRun:null},
  };
}
function settledResearchJob(track,{calls=1,step=1}={}){
  return {
    id:randomUUID(),type:'agent',title:'저장된 연구',input:'stored',status:'paused',pauseReason:'restart',
    step,totalSteps:3,createdAt:START,updatedAt:START,error:null,version:1,artifacts:[],
    deadlineAt:FUTURE,callLimit:1,projectId:track.projectId,
    researchRequest:{version:1,question:'저장된 질문',query:track.defaultEnglishQuery,projectId:track.projectId,trackCode:track.code},
    autopilot:{version:1,kind:'research',taskKey:`research:${track.code}:0`,phase:0,trackCode:track.code},
    agentJournal:{provider:'openai',model:'synthetic-model',calls:Array.from({length:calls},()=>({id:randomUUID(),at:START,status:'settled',inputTokens:1,outputTokens:1})),history:[{role:'user',content:'저장된 질문'},...(calls?[{role:'assistant',content:'이미 받은 최종 답안',toolCalls:[]}]:[])]},
  };
}

test('configured providers stay ready for explicit calls but never authorize background model work',()=>{
  assert.equal(config.ready,true);
  assert.equal(config.auto,false);
  assert.equal(config.backgroundModelCalls,false);
  assert.equal(config.provider,'openai');
});

test('automatic source review cannot create a model mission even when legacy autorun was requested',()=>{
  const s=state(true);
  assert.equal(automaticMission(s,{...config,auto:true}),null);
});

test('autopilot keeps local OS work running and selects no new AI research',()=>{
  const withoutLocalWork=state(false);
  assert.equal(planAutopilot(withoutLocalWork,{config,at:START}),null);
  const status=getAutopilotStatus(withoutLocalWork,{config,at:START});
  assert.equal(status.modelPolicy,'explicit-only');
  assert.equal(status.backgroundModelCalls,false);
  assert.match(status.summary,/독립 운영 모드/);
  assert.ok(status.blockers.some(item=>item.id==='model-policy'));

  const withLocalWork=state(true);
  const plan=planAutopilot(withLocalWork,{config,at:START});
  assert.equal(plan.kind,'world');
  assert.equal(plan.motivation.signals.estimatedCalls,0);
});

test('restart may finish a settled local checkpoint but cannot start a new provider call',()=>{
  const track=RESEARCH_TRACKS[0];
  const settled=state(false);settled.jobs.push(settledResearchJob(track));
  assert.deepEqual(planAutopilot(settled,{config,at:'2026-09-13T00:10:00.000Z'}),{kind:'resume',jobId:settled.jobs[0].id});

  const needsCall=state(false);needsCall.jobs.push(settledResearchJob(track,{calls:0,step:0}));
  assert.equal(planAutopilot(needsCall,{config,at:'2026-09-13T00:10:00.000Z'}),null);
});
