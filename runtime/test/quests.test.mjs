import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {QuestError,SEVEN_DRIVES,planQuest,publicQuest,questsOverview,validateQuestState,createGoalPrompt,recordQuestOutcome,questDocument} from '../lib/quests.mjs';

const state=()=>({quests:[],outcomes:[],jobs:[],projects:[],artifacts:{}});
const goal={goal:'고객에게 바로 보여줄 한끼안부 소개 문구를 완성해 줘.',drive:'lust'};
const errorCode=(code,status=400)=>error=>error instanceof QuestError&&error.code===code&&error.status===status;
function fixture(){
  const s=state(),q=planQuest(goal,s),at=q.createdAt;
  const j={id:randomUUID(),type:'agent',questId:q.id,status:'completed',updatedAt:at,artifacts:[],agentJournal:{provider:'gemini',model:'test-model',calls:[{id:randomUUID(),at,status:'settled',inputTokens:120,outputTokens:80}]}};
  const id=randomUUID(),content='한끼안부 실제 작업 산출물';
  const a={id,name:'result.md',jobId:j.id,filename:`${id}.md`,sha256:createHash('sha256').update(content).digest('hex'),bytes:Buffer.byteLength(content)};
  q.jobId=j.id;q.status='assigned';j.artifacts.push({id,name:a.name});s.jobs.push(j);s.quests.push(q);s.artifacts[id]=a;
  return {s,q,j,a};
}

test('goal planning is bounded and pure and retains all seven distinct drives',()=>{
  const s=state(),before=structuredClone(s);
  assert.deepEqual(SEVEN_DRIVES.map(d=>d.id),['greed','gluttony','envy','pride','lust','wrath','sloth']);
  for(const drive of SEVEN_DRIVES){
    const q=planQuest({...goal,drive:drive.id},s);
    assert.equal(q.driveId,drive.id);assert.equal(q.drive,drive.id);assert.equal(q.status,'proposed');assert.equal(q.jobId,null);
    assert.equal(q.maxCalls,2);assert.equal(q.durationMinutes,30);assert.equal(q.provider,'auto');assert.equal(q.costUsd,null);
    assert.match(createGoalPrompt(q),/실제 산출물 본문/);
    validateQuestState({...s,quests:[q]});
  }
  assert.deepEqual(s,before);
});

test('goal API rejects forged completion, approval, cost and skill claims',()=>{
  for(const field of ['status','jobId','costUsd','verified','externallyVerified','independent','skills','qualityScore','approvalStatus','reviewOf']){
    assert.throws(()=>planQuest({...goal,[field]:true},state()),errorCode('unsupported_field'));
  }
  for(const body of [null,[],42])assert.throws(()=>planQuest(body,state()),errorCode('invalid_quest'));
  for(const invalid of ['', ' '.repeat(8),'x'.repeat(6001),{},42,'contains\u0000control']){
    assert.throws(()=>planQuest({...goal,goal:invalid},state()),errorCode('invalid_quest'));
  }
  assert.equal(planQuest({...goal,goal:'x'.repeat(6000)},state()).goal.length,6000);
});

test('provider and integer limits reject coercion and unsupported names',()=>{
  for(const maxCalls of [0,5,1.5,'2',null,Infinity])assert.throws(()=>planQuest({...goal,maxCalls},state()),errorCode('invalid_call_limit'));
  for(const durationMinutes of [0,121,1.5,'30',Infinity])assert.throws(()=>planQuest({...goal,durationMinutes},state()),errorCode('invalid_duration'));
  for(const provider of ['grok','perplexity',true,{}])assert.throws(()=>planQuest({...goal,provider},state()),errorCode('invalid_provider'));
  for(const provider of ['auto','openai','gemini','moonshot','xai','anthropic','nvidia'])assert.equal(planQuest({...goal,provider},state()).provider,provider);
  assert.throws(()=>planQuest({...goal,driveId:'greed'},state()),errorCode('invalid_drive'));
  assert.throws(()=>planQuest({...goal,drive:'unknown'},state()),errorCode('invalid_drive'));
});

test('project snapshots preserve canonical IDs, full text and original scope after later edits',()=>{
  const s=state(),id=randomUUID();
  const p={id,name:'A03 한끼안부',summary:'가'.repeat(8000),nextAction:'나'.repeat(4000),status:'active',version:7};s.projects.push(p);
  const q=planQuest({...goal,projectId:id,goal:'가'.repeat(6000),successCriterion:'나'.repeat(2000),baseline:'다'.repeat(2000)},s);
  s.quests.push(q);validateQuestState(s);
  assert.equal(q.projectId,id);assert.equal(q.projectVersion,7);assert.equal(q.projectContext.summary.length,8000);
  const prompt=createGoalPrompt(q);assert.ok(prompt.length<20000);assert.match(prompt,/"contextTruncated":true/);
  p.summary='changed';p.version=8;p.status='archived';
  assert.equal(q.projectContext.version,7);assert.equal(q.projectContext.summary.length,8000);validateQuestState(s);
  assert.throws(()=>planQuest({...goal,projectId:id},s),errorCode('invalid_project'));
  assert.throws(()=>planQuest({...goal,projectId:randomUUID()},s),errorCode('invalid_project'));
});

test('public status, provider, usage and artifact come from durable execution after JSON reload',()=>{
  const {s,q,j,a}=fixture();q.status='failed';
  const restored=JSON.parse(JSON.stringify(s));validateQuestState(restored);
  const result=publicQuest(restored.quests[0],restored);
  assert.equal(result.status,'completed');assert.equal(result.actualProvider,'gemini');assert.equal(result.actualModel,'test-model');
  assert.deepEqual(result.artifacts,[{id:a.id,name:a.name,sha256:a.sha256,bytes:a.bytes}]);
  assert.deepEqual(result.executionUsage,{attempts:1,settled:1,unknown:0,usageMissing:0,inputTokens:120,outputTokens:80,costUsd:null});
  j.status='paused';j.pauseReason='outcomeUnknown';j.agentJournal.calls.push({id:randomUUID(),at:q.createdAt,status:'unknown',inputTokens:null,outputTokens:null});
  assert.equal(publicQuest(q,s).status,'paused');assert.equal(publicQuest(q,s).outcomeUnknown,true);assert.equal(publicQuest(q,s).executionUsage.unknown,1);
  result.artifacts[0].name='forged';assert.equal(s.artifacts[a.id].name,'result.md');
});

test('missing or foreign result metadata never becomes a linked verified artifact',()=>{
  const {s,q,j,a}=fixture();delete s.artifacts[a.id];
  assert.equal(publicQuest(q,s).resultStatus,'artifact_missing');assert.deepEqual(publicQuest(q,s).artifacts,[]);
  s.artifacts[a.id]={...a,jobId:randomUUID()};assert.deepEqual(publicQuest(q,s).artifacts,[]);
  s.artifacts[a.id]={...a,sha256:['a'.repeat(64)]};assert.deepEqual(publicQuest(q,s).artifacts,[]);
  s.jobs=[];assert.equal(publicQuest(q,s).status,'missing_job');assert.throws(()=>validateQuestState(s),/job reference/);
});

test('outcomes bind completed artifact evidence but remain owner reported',()=>{
  const {s,q,a}=fixture(),before=structuredClone(s);
  const o=recordQuestOutcome({questId:q.id,ledger:'wealth',summary:'테스트 고객 1명의 주문을 받았다고 기록',value:15000,unit:'KRW'},s);
  assert.deepEqual(s,before);assert.equal(o.verification,'self_reported');assert.equal(o.source,'owner_report');assert.equal(o.artifactSha256,a.sha256);
  s.outcomes.push(o);validateQuestState(JSON.parse(JSON.stringify(s)));
  const overview=questsOverview(s);assert.equal(overview.ledgers.wealth.selfReported,1);assert.equal(overview.ledgers.wealth.externallyVerified,0);
  assert.equal(overview.actualCostUsd,null);assert.equal(overview.externalBusinessOutcomesVerified,0);assert.equal(overview.skillActivationAvailable,false);
  assert.equal(overview.ledgers.wealth.revenue,undefined);
  assert.match(questDocument(s),/사용자 보고 1건 · 외부 검증 0건/);
});

test('owner API cannot self certify external outcomes or substitute unrelated artifacts',()=>{
  const {s,q}=fixture(),body={questId:q.id,category:'honor',summary:'고객 확인 보고'};
  for(const field of ['verified','independent','externallyVerified','artifactSha256','jobId','verification','source','skills','qualityScore'])assert.throws(()=>recordQuestOutcome({...body,[field]:true},s),errorCode('unsupported_field'));
  assert.throws(()=>recordQuestOutcome({...body,artifactId:randomUUID()},s),errorCode('outcome_requires_artifact',409));
  for(const value of ['12',NaN,Infinity,{}])assert.throws(()=>recordQuestOutcome({...body,value,unit:'명'},s),errorCode('invalid_measurement'));
  assert.throws(()=>recordQuestOutcome({...body,value:1},s),errorCode('invalid_measurement'));
  assert.throws(()=>recordQuestOutcome({...body,ledger:'wealth'},s),errorCode('invalid_ledger'));
});

test('unknown calls and incomplete executions cannot become an outcome',()=>{
  const {s,q,j}=fixture(),body={questId:q.id,ledger:'fame',summary:'기록 요청'};
  for(const status of ['queued','running','paused','failed','cancelled']){
    j.status=status;assert.throws(()=>recordQuestOutcome(body,s),errorCode('outcome_requires_completed_job',409));
  }
  j.status='completed';j.agentJournal.calls[0].status='unknown';assert.throws(()=>recordQuestOutcome(body,s),errorCode('outcome_requires_completed_job',409));
  j.agentJournal.calls[0].status='reserved';assert.throws(()=>recordQuestOutcome(body,s),errorCode('outcome_requires_completed_job',409));
});

test('restore rejects corrupt registries, duplicate links, forged measurements and altered hashes',()=>{
  validateQuestState({jobs:[],projects:[],artifacts:{}});
  for(const key of ['quests','outcomes'])assert.throws(()=>validateQuestState({...state(),[key]:{}}),/registry/);
  const {s,q}=fixture();s.outcomes.push(recordQuestOutcome({questId:q.id,ledger:'wealth',summary:'보유 자료'},s));
  const alterations=[
    t=>{t.quests[0].id=[t.quests[0].id];},
    t=>{t.quests[0].externally_verified=true;},
    t=>{t.quests.push({...t.quests[0],id:randomUUID()});},
    t=>{t.outcomes[0].verification='externally_verified';},
    t=>{t.outcomes[0].artifactSha256='0'.repeat(64);},
    t=>{t.outcomes.push({...t.outcomes[0]});},
    t=>{t.outcomes[0].verified=true;},
    t=>{t.jobs[0].status='failed';}
  ];
  for(const alter of alterations){const tampered=structuredClone(s);alter(tampered);assert.throws(()=>validateQuestState(tampered));}
});

test('capacity refusal preserves every previously accepted goal and outcome',()=>{
  const s=state();s.quests=Array.from({length:1000},(_,i)=>({id:`retained-${i}`}));
  assert.throws(()=>planQuest(goal,s),errorCode('quest_capacity',409));assert.equal(s.quests.length,1000);
  s.outcomes=Array.from({length:5000},(_,i)=>({id:`retained-${i}`}));
  assert.throws(()=>recordQuestOutcome({},s),errorCode('outcome_capacity',409));assert.equal(s.outcomes.length,5000);
});

test('restore verifies bounded job controls and both directions of quest identity',()=>{
  const {s,j}=fixture();j.selectedProvider='gemini';j.callLimit=2;j.deadlineAt=new Date(Date.now()+30000).toISOString();
  validateQuestState(s);
  for(const [key,value] of [['selectedProvider','auto'],['callLimit',0],['callLimit',5],['callLimit','2'],['deadlineAt','tomorrow'],['questId',randomUUID()]]){
    const t=structuredClone(s);t.jobs[0][key]=value;assert.throws(()=>validateQuestState(t));
  }
  const t=structuredClone(s);t.quests=[];assert.throws(()=>validateQuestState(t),/quest reference/);
});
