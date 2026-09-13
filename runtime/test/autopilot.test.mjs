import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {initialAutopilot,validateAutopilot,validateAutopilotJob,planAutopilot as rawPlanAutopilot,getAutopilotStatus,AUTOPILOT_INTERVAL_MS} from '../lib/autopilot.mjs';
import {RESEARCH_TRACKS} from '../lib/research.mjs';

// Legacy assertions compare the action contract; new motivation tests check its added audit record.
function planAutopilot(...args){const value=rawPlanAutopilot(...args);if(!value)return value;const {motivation,...action}=value;return action;}

const START='2026-09-12T00:00:00.000Z';
const time=hours=>new Date(Date.parse(START)+hours*60*60*1000).toISOString();
const config={ready:true,dailyCallLimit:20};
const options=(hours=0,extra={})=>({config,at:time(hours),...extra});
function state(){return {autopilot:{...initialAutopilot(),enabled:true,enabledAt:START},emergencyStop:false,modules:{documents:true,ai:false},jobs:[],projects:RESEARCH_TRACKS.map(track=>({id:track.projectId,status:'active'})),artifacts:{}};}
function receipt(at=START,status='settled'){return {id:randomUUID(),at,status,inputTokens:10,outputTokens:20};}
function addJob(s,action,{at=START,status='completed',withAnswer=true,callStatus='settled',callCount=1}={}){
  const {kind,taskKey}=action,job={id:randomUUID(),type:kind==='research'?'agent':kind,title:'private fixture title',input:'private fixture content',createdAt:at,updatedAt:at,status,step:status==='completed'?3:0,artifacts:[],autopilot:{version:1,kind,taskKey}};
  if(kind==='research'){
    Object.assign(job.autopilot,{phase:action.phase,trackCode:action.trackCode,...(action.previousJobId?{parentJobId:action.previousJobId}:{})});
    job.projectId=action.projectId;
    job.researchRequest={version:1,question:action.question,query:action.query,projectId:action.projectId,trackCode:action.trackCode};
    job.callLimit=1;
    job.agentJournal={calls:Array.from({length:callCount},()=>receipt(at,callStatus)),history:[{role:'user',content:action.question},...(callCount?[{role:'assistant',content:'공개 근거 검토 결과입니다.',toolCalls:[]}]:[])]};
    job.deadlineAt=new Date(Date.parse(at)+30*60000).toISOString();
    if(withAnswer){
      for(const [name,field] of [[`research-answer-${job.id.slice(0,8)}.md`,null],[`research-evidence-${job.id.slice(0,8)}.json`,'researchEvidenceId']]){
        const id=randomUUID();job.artifacts.push({id,name});s.artifacts[id]={id,name,jobId:job.id,sha256:'a'.repeat(64),bytes:10};if(field)job[field]=id;
      }
    }
  }else if(action.parentJobId)job.autopilot.parentJobId=action.parentJobId;
  s.jobs.push(job);validateAutopilotJob(job,s);return job;
}
function research(s,index=0,phase=0,previousJobId){
  const track=RESEARCH_TRACKS[index];return {kind:'research',taskKey:`research:${track.code}:${phase}`,trackCode:track.code,phase,projectId:track.projectId,question:'공개 자료의 근거와 기각 기준을 비교하세요.',query:track.defaultEnglishQuery,...(previousJobId?{previousJobId}:{})};
}
function world(s,at=START,status='completed'){
  const taskKey=`world:${new Date(Math.floor(Date.parse(at)/AUTOPILOT_INTERVAL_MS)*AUTOPILOT_INTERVAL_MS).toISOString()}`;
  return addJob(s,{kind:'world',taskKey},{at,status});
}

test('initial configuration is disabled and persisted settings reject missing, extra and malformed fields',()=>{
  const initial=initialAutopilot();assert.equal(validateAutopilot(initial),true);assert.equal(initial.enabled,false);assert.equal(initial.dailyAiLimit,4);
  const changes=[{version:2},{enabled:'yes'},{enabled:true},{dailyAiLimit:0},{dailyAiLimit:5},{dailyAiLimit:21},{dailyAiLimit:1.5},{enabledAt:'2026-09-12'},{retryAt:'later'},{lastError:''},{lastError:'x\nsecret'},{lastError:'x'.repeat(301)},{arbitraryShell:true}];
  for(const change of changes)assert.throws(()=>validateAutopilot({...initial,...change}),TypeError);
  const missing={...initial};delete missing.retryAt;assert.throws(()=>validateAutopilot(missing));
  assert.equal(validateAutopilot({...initial,enabled:true,enabledAt:START,retryAt:time(1),lastError:'준비 오류'}),true);
});

test('world → research → private For-Ai audit → MP4 are selected without mutating state or using synthetic records',()=>{
  const s=state();s.studio={series:[{id:randomUUID(),title:'인수검사용 소설'}],contacts:[{id:randomUUID()}],places:[{id:randomUUID()}]};
  const snapshot=structuredClone(s);const first=planAutopilot(s,options());assert.deepEqual(s,snapshot);assert.deepEqual(first,{kind:'world',taskKey:`world:${START}`});
  const observation=addJob(s,first,{status:'running'});assert.equal(planAutopilot(s,options()),null);observation.status='completed';
  const next=planAutopilot(s,options());assert.equal(next.kind,'research');assert.equal(next.trackCode,'E01');assert.equal(next.phase,0);assert.match(next.question,/ECDC EARS-Net.*WHO GLASS.*survivor freeze/);
  const answer=addJob(s,next,{at:time(0.01)});const audit=planAutopilot(s,options(0.02));assert.deepEqual(audit,{kind:'forai',taskKey:`forai:${answer.id}`,parentJobId:answer.id});
  addJob(s,audit,{at:time(0.02)});const video=planAutopilot(s,options(0.03));assert.deepEqual(video,{kind:'video',taskKey:`video:${answer.id}`,parentJobId:answer.id});
  addJob(s,video,{at:time(0.03)});assert.equal(planAutopilot(s,options(0.04)),null);assert.equal(getAutopilotStatus(s,options(0.04)).nextAt,time(6));
  assert.equal(s.studio.series.length,1);assert.ok(s.jobs.every(job=>['world','agent','forai','video'].includes(job.type)));
});

test('global stop, disabled autopilot and persisted cooldown prevent all selection and do not silently re-enable',()=>{
  const s=state();s.emergencyStop=true;assert.equal(planAutopilot(s,options()),null);s.autopilot.enabled=false;s.emergencyStop=false;assert.equal(planAutopilot(s,options()),null);assert.equal(s.autopilot.enabled,false);
  s.autopilot.enabled=true;s.autopilot.retryAt=time(1);s.autopilot.lastError='결과 보관 공간을 확인해야 합니다.';
  assert.equal(planAutopilot(s,options()),null);assert.equal(getAutopilotStatus(s,options()).nextAt,time(1));assert.equal(planAutopilot(s,options(1)).kind,'world');
});

test('any existing queued or running manual job takes precedence on the small core',()=>{
  for(const status of ['queued','running']){const s=state();s.jobs.push({id:randomUUID(),type:'video',status,createdAt:START});assert.equal(planAutopilot(s,options()),null);assert.match(getAutopilotStatus(s,options()).summary,/먼저 접수된 작업/);}
});

test('research rotates canonical tracks before later phases and carries the previous answer identity',()=>{
  const s=state();s.modules.documents=false;const firstJobs=[];
  for(let index=0;index<9;index++){
    const action=planAutopilot(s,options(index*6));assert.equal(action.kind,'research');assert.equal(action.trackCode,RESEARCH_TRACKS[index].code);assert.equal(action.phase,0);assert.equal(Object.hasOwn(action,'previousJobId'),false);firstJobs.push(addJob(s,action,{at:time(index*6)}));
  }
  const phase1=planAutopilot(s,options(54));assert.equal(phase1.trackCode,'E01');assert.equal(phase1.phase,1);assert.equal(phase1.previousJobId,firstJobs[0].id);assert.match(phase1.question,/반박하는 근거.*기각/);
  const continued=addJob(s,phase1,{at:time(54)});assert.equal(continued.autopilot.parentJobId,firstJobs[0].id);assert.equal(validateAutopilotJob(continued,s),true);
});

test('after 27 completed stages research waits for real validation inputs instead of endlessly rewriting reports',()=>{
  const s=state();s.modules.documents=false;
  for(let index=0;index<27;index++){
    const action=planAutopilot(s,options(index*6));assert.equal(action.kind,'research');assert.ok(action.phase>=0&&action.phase<=2);assert.ok(!s.jobs.some(job=>job.autopilot?.taskKey===action.taskKey));
    if(action.phase===2)assert.match(action.question,/공개 데이터.*독립 검증 집합.*수행하지 않은/);
    addJob(s,action,{at:time(index*6)});
  }
  assert.equal(planAutopilot(s,options(162)),null);const status=getAutopilotStatus(s,options(162));assert.equal(status.nextAt,null);assert.ok(status.tracks.every(track=>track.status==='validation'));assert.match(status.summary,/실제 검증 자료/);
});

test('failed, cancelled, owner-paused and unknown attempts stay blocked while other tracks continue after six hours',()=>{
  for(const scenario of [{status:'failed'},{status:'cancelled'},{status:'paused',pauseReason:'owner'},{status:'failed',callStatus:'unknown'}]){
    const s=state();s.modules.documents=false;const blocked=addJob(s,research(s),scenario);if(scenario.pauseReason)blocked.pauseReason=scenario.pauseReason;
    assert.equal(planAutopilot(s,options(1)),null);const next=planAutopilot(s,options(6));assert.equal(next.trackCode,'E02');assert.equal(getAutopilotStatus(s,options(6)).tracks[0].status,'blocked');
    assert.equal(s.jobs.length,1);assert.equal(s.jobs[0].id,blocked.id);
  }
});

test('manual research, duplicate portfolio names and archived canonical projects do not count as automatic progress',()=>{
  const s=state();s.modules.documents=false;
  const manual=addJob(s,research(s));delete manual.autopilot;
  s.projects.find(project=>project.id===RESEARCH_TRACKS[0].projectId).status='archived';s.projects.push({id:randomUUID(),name:RESEARCH_TRACKS[0].name,status:'active'});
  const next=planAutopilot(s,options());assert.equal(next.trackCode,'E02');assert.equal(next.phase,0);assert.match(getAutopilotStatus(s,options()).tracks[0].reason,/보관/);
  s.projects=[];assert.equal(planAutopilot(s,options()),null);
});

test('daily autonomous and shared budgets include reserved and unknown calls, and reset only at UTC midnight',()=>{
  const s=state();s.modules.documents=false;
  const job=addJob(s,research(s),{at:time(0),status:'failed',callCount:3});job.agentJournal.calls[0].status='reserved';job.agentJournal.calls[1].status='unknown';
  s.autopilot.dailyAiLimit=3;assert.equal(planAutopilot(s,options(6)),null);
  let status=getAutopilotStatus(s,options(6));assert.equal(status.aiUsedToday,3);assert.equal(status.globalUsedToday,3);assert.equal(status.nextAt,time(24));
  assert.equal(planAutopilot(s,options(24)).trackCode,'E02');
  s.autopilot.dailyAiLimit=4;s.jobs.push({id:randomUUID(),status:'completed',agentJournal:{calls:Array.from({length:17},()=>receipt())}});
  assert.equal(planAutopilot(s,options(6)),null);status=getAutopilotStatus(s,options(6));assert.equal(status.aiUsedToday,3);assert.equal(status.globalUsedToday,20);assert.equal(status.globalLimit,20);
});

test('non-AI observation and derivatives remain available when the model is absent or its budget is spent',()=>{
  const s=state();assert.equal(planAutopilot(s,options(0,{config:{ready:false,dailyCallLimit:0}})).kind,'world');world(s);
  const answer=addJob(s,research(s));s.autopilot.dailyAiLimit=1;
  const next=planAutopilot(s,options(0,{config:{ready:false,dailyCallLimit:0}}));assert.equal(next.kind,'forai');assert.equal(next.parentJobId,answer.id);
});

test('documents switch blocks observation, audits and videos but assigned research can run with ai module off',()=>{
  const s=state();s.modules.documents=false;s.modules.ai=false;const next=planAutopilot(s,options());assert.equal(next.kind,'research');addJob(s,next);
  assert.equal(planAutopilot(s,options(1)),null);const status=getAutopilotStatus(s,options(1));assert.ok(status.blockers.some(item=>item.id==='documents'));
});

test('restart only resumes owned restart or shutdown checkpoints with future deadlines and no uncertain calls',()=>{
  for(const reason of ['restart','shutdown']){
    const s=state();s.modules.documents=false;const job=addJob(s,research(s),{status:'paused',callCount:0,withAnswer:false});job.pauseReason=reason;
    assert.deepEqual(planAutopilot(s,options(0.1)),{kind:'resume',jobId:job.id});
    job.agentJournal.calls=[receipt(START,'unknown')];assert.equal(planAutopilot(s,options(0.1)),null);
    job.agentJournal.calls=[];job.pauseReason='owner';assert.equal(planAutopilot(s,options(0.1)),null);
    job.pauseReason=reason;assert.equal(planAutopilot(s,options(1)),null);
  }
  const s=state();const job=world(s,START,'paused');job.pauseReason='shutdown';assert.deepEqual(planAutopilot(s,options()),{kind:'resume',jobId:job.id});s.modules.documents=false;assert.equal(planAutopilot(s,options()).kind,'research');
});

test('a settled answer checkpoint can finish without another call at the exhausted daily limit',()=>{
  const s=state();s.modules.documents=false;s.autopilot.dailyAiLimit=1;
  const job=addJob(s,research(s),{status:'paused'});job.pauseReason='restart';job.step=2;
  assert.deepEqual(planAutopilot(s,options(0.1)),{kind:'resume',jobId:job.id});
  job.agentJournal.calls=[];s.jobs.push({id:randomUUID(),status:'completed',agentJournal:{calls:Array.from({length:20},()=>receipt())}});
  assert.equal(planAutopilot(s,options(0.1)),null);
});

test('restart finishes a persisted research draft locally when the provider configuration is unavailable',()=>{
  for(const pauseReason of ['restart','shutdown']){
    const s=state();s.modules.documents=false;s.autopilot.dailyAiLimit=1;
    const job=addJob(s,research(s),{status:'paused',withAnswer:false});
    job.pauseReason=pauseReason;job.step=2;job.draft='검증한 인용과 함께 저장을 기다리는 연구 답안';
    const unavailable=options(0.1,{config:{ready:false,dailyCallLimit:0}}),before=structuredClone(s);
    assert.deepEqual(planAutopilot(s,unavailable),{kind:'resume',jobId:job.id});
    assert.equal(getAutopilotStatus(s,unavailable).nextAt,time(0.1));
    assert.deepEqual(s,before,'planning neither rewrites checkpoints nor creates another call');
    assert.equal(job.agentJournal.calls.length,1);
  }
});

test('local-only restart recovery requires the completed draft checkpoint and preserves every stop boundary',()=>{
  const unavailable=options(0.1,{config:{ready:false,dailyCallLimit:0}});
  const changes=[
    (s,job)=>{job.step=1;},
    (s,job)=>{delete job.draft;},
    (s,job)=>{job.draft='  ';},
    (s,job)=>{job.agentJournal.calls=[];},
    (s,job)=>{job.agentJournal.calls[0].status='unknown';},
    (s,job)=>{job.agentJournal.calls[0].status='reserved';},
    (s,job)=>{job.agentJournal.history.at(-1).toolCalls=[{id:'t1',name:'runtime_inspect',args:{}}];},
    (s,job)=>{job.deadlineAt=time(0.05);},
    (s,job)=>{delete job.deadlineAt;},
    (s,job)=>{job.pauseReason='owner';},
    (s,job)=>{job.pauseReason='autopilotStopped';},
    (s,job)=>{s.autopilot.enabled=false;},
    (s,job)=>{s.emergencyStop=true;},
    (s,job)=>{s.projects[0].status='archived';},
  ];
  for(const change of changes){
    const s=state();s.modules.documents=false;
    const job=addJob(s,research(s),{status:'paused',withAnswer:false});job.pauseReason='restart';job.step=2;job.draft='보관할 검증 전 답안';
    change(s,job);const before=structuredClone(s);
    assert.equal(planAutopilot(s,unavailable),null);
    assert.deepEqual(s,before);
  }
});

test('a real core restart without model credentials saves the same settled research draft without another model call',{timeout:12000},async t=>{
  const [{default:fs},{default:os},{default:path},{start},{openStore,digest}]=await Promise.all([import('node:fs'),import('node:os'),import('node:path'),import('../server.mjs'),import('../lib/store.mjs')]);
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-autopilot-local-finish-'));
  const store=openStore(root),at=new Date().toISOString(),track=RESEARCH_TRACKS[0];
  store.state.projects.push({id:track.projectId,name:track.name,repositoryUrl:'',summary:'Synthetic recovery fixture',nextAction:'Verify local completion',status:'active',version:1,createdAt:at,updatedAt:at});
  store.state.modules.documents=false;
  store.save();
  const owner='synthetic-autopilot-recovery-owner';let core,modelCalls=0,evidenceReads=0;
  t.after(()=>{core?.shutdown();fs.rmSync(root,{recursive:true,force:true});});
  const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
  const coreOptions={host:'127.0.0.1',port:0,dataDir:root,token:owner,
    researchFetch:async url=>{evidenceReads++;return new URL(url).hostname==='www.ebi.ac.uk'?json({hitCount:1,resultList:{result:[{id:'12345678',source:'MED',pmid:'12345678',title:'Synthetic recovery evidence',authorString:'Synthetic Researcher',pubYear:'2025',abstractText:'Synthetic evidence to test recovery, not a research finding.',journalInfo:{journal:{title:'Synthetic Journal'}},isRetracted:'N'}]}}):json({status:'ok','message-type':'work-list',message:{'total-results':0,items:[]}});},
    agentFetch:async()=>{modelCalls++;return json({choices:[{finish_reason:'stop',message:{content:'합성 복구 검사 답안입니다. [S1]의 한계를 독립 자료로 검증해야 합니다.',tool_calls:[]}}],usage:{prompt_tokens:25,completion_tokens:20}});},
  };
  core=await start({...coreOptions,env:{YENO_AGENT_PROVIDER:'auto',YENO_AGENT_DAILY_CALL_LIMIT:'20',YENO_OPENAI_API_KEY:'synthetic-provider-recovery-key',YENO_OPENAI_MODEL:'synthetic-recovery-model'}});
  const accepted=await fetch(`http://127.0.0.1:${core.server.address().port}/api/autopilot`,{method:'POST',headers:{Authorization:`Bearer ${owner}`,'Content-Type':'application/json'},body:JSON.stringify({requestId:randomUUID(),enabled:true,dailyAiLimit:1})});
  assert.equal(accepted.status,200);await accepted.arrayBuffer();
  const waitFor=async predicate=>{const until=Date.now()+5000;while(Date.now()<until){const value=predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail('Expected recovery checkpoint was not reached');};
  const before=await waitFor(()=>core.state().jobs.find(job=>job.autopilot?.kind==='research'&&job.step===2));
  core.shutdown();
  const saved=openStore(root).state.jobs.find(job=>job.id===before.id);
  assert.equal(saved.status,'paused');assert.equal(saved.pauseReason,'shutdown');assert.equal(saved.step,2);
  assert.equal(saved.agentJournal.calls.length,1);assert.equal(saved.agentJournal.calls[0].status,'settled');assert.match(saved.draft,/합성 복구 검사 답안/);
  const reads=evidenceReads;
  core=await start({...coreOptions,env:{}});
  assert.equal(core.state().agent.configured,false);
  const completed=await waitFor(()=>core.state().jobs.find(job=>job.id===before.id&&job.status==='completed'));
  assert.equal(core.state().jobs.filter(job=>job.autopilot?.kind==='research').length,1);
  assert.equal(modelCalls,1);assert.equal(evidenceReads,reads);
  const finalStore=openStore(root).state,answer=completed.artifacts.find(file=>file.name.startsWith('research-answer-'));
  assert.ok(answer);const metadata=finalStore.artifacts[answer.id],bytes=fs.readFileSync(path.join(root,'artifacts',metadata.filename));
  assert.equal(digest(bytes),metadata.sha256);assert.equal(bytes.toString('utf8'),saved.draft);
});

test('settlement alone cannot resume research without its one-call final answer checkpoint',()=>{
  const s=state();s.modules.documents=false;const job=addJob(s,research(s),{status:'paused'});job.pauseReason='restart';
  const original=structuredClone(job.agentJournal);
  for(const change of [()=>job.agentJournal.history.pop(),()=>job.agentJournal.history.at(-1).toolCalls=[{id:'tool1',name:'project_read',args:{}}],()=>job.agentJournal.history.at(-1).content='',()=>job.callLimit=2]){
    job.agentJournal=structuredClone(original);job.callLimit=1;change();
    assert.equal(planAutopilot(s,options(0.1)),null);assert.equal(getAutopilotStatus(s,options(0.1)).tracks[0].status,'blocked');
  }
  assert.throws(()=>validateAutopilotJob(job,s),/research identity/);
});

test('nextAt shows a pending derivative at UTC midnight before the next six-hour observation or research',()=>{
  const s=state();world(s,time(22));const first=addJob(s,research(s),{at:time(0)});
  for(const kind of ['forai','video'])addJob(s,{kind,taskKey:`${kind}:${first.id}`,parentJobId:first.id},{at:time(1)});
  const second=addJob(s,research(s,1),{at:time(22)});
  assert.equal(planAutopilot(s,options(23)),null);assert.equal(getAutopilotStatus(s,options(23)).nextAt,time(24));
  assert.deepEqual(planAutopilot(s,options(24)),{kind:'forai',taskKey:`forai:${second.id}`,parentJobId:second.id});
  s.modules.documents=false;assert.equal(getAutopilotStatus(s,options(23)).nextAt,time(28));
});

test('failed observation and failed or owner-paused derivatives have specific bounded public blockers',()=>{
  const s=state();const observation=world(s,START,'failed');const answer=addJob(s,research(s));
  const audit=addJob(s,{kind:'forai',taskKey:`forai:${answer.id}`,parentJobId:answer.id},{at:time(0.1),status:'failed'});audit.error='private fixture error';
  const video=addJob(s,{kind:'video',taskKey:`video:${answer.id}`,parentJobId:answer.id},{at:time(0.2),status:'paused'});video.pauseReason='owner';
  const status=getAutopilotStatus(s,options(1));const failures=status.blockers.filter(item=>item.id.startsWith('job-'));
  assert.equal(failures.length,3);assert.ok(failures.some(item=>item.id===`job-${observation.id}`&&/세계 관측.*실패/.test(item.title)));
  assert.ok(failures.some(item=>item.id===`job-${audit.id}`&&/연구 페이지 점검.*실패/.test(item.title)));
  assert.ok(failures.some(item=>item.id===`job-${video.id}`&&/소유자가 멈춘/.test(item.reason)));
  assert.doesNotMatch(JSON.stringify(failures),/private fixture/);assert.equal(planAutopilot(s,options(1)),null);
});

test('derivatives require completed answer/evidence references and never retry a failed parent-specific identity',()=>{
  const s=state();world(s);const answer=addJob(s,research(s),{withAnswer:false});assert.equal(planAutopilot(s,options(1)),null);
  answer.autopilot=undefined;s.jobs.pop();const valid=addJob(s,research(s));
  const audit=addJob(s,planAutopilot(s,options(1)),{at:time(1),status:'failed'});assert.equal(audit.type,'forai');
  const video=addJob(s,planAutopilot(s,options(1)),{at:time(1),status:'cancelled'});assert.equal(video.type,'video');
  s.modules.documents=false;for(const project of s.projects)project.status='archived';assert.equal(planAutopilot(s,options(24)),null);
  s.modules.documents=true;world(s,time(24));assert.equal(planAutopilot(s,options(24)),null);assert.equal(s.jobs.filter(job=>job.autopilot?.parentJobId===valid.id).length,2);
});

test('strict job metadata binds type, canonical scope, task identity, phase and immediate predecessor',()=>{
  const s=state();const parent=addJob(s,research(s));const child=addJob(s,research(s,0,1,parent.id),{at:time(6)});
  const mutations=[job=>job.autopilot.extra=true,job=>job.autopilot.taskKey='research:E02:1',job=>job.autopilot.phase=3,job=>job.projectId=RESEARCH_TRACKS[1].projectId,job=>job.researchRequest.trackCode='E02',job=>job.type='document',job=>delete job.autopilot.parentJobId,job=>job.autopilot.parentJobId=randomUUID()];
  for(const mutate of mutations){const copy=structuredClone(child);mutate(copy);assert.throws(()=>validateAutopilotJob(copy,s));}
  assert.throws(()=>validateAutopilotJob({...parent,autopilot:{...parent.autopilot,parentJobId:child.id}},s));
  const duplicate={...structuredClone(parent),id:randomUUID()};assert.throws(()=>validateAutopilotJob(duplicate,s),/Duplicate/);
  parent.status='failed';assert.throws(()=>validateAutopilotJob(child,s),/parent/);
});

test('strict world and derivative metadata reject forged time slots, wrong types and nonresearch parents',()=>{
  const s=state(),observation=world(s);
  for(const meta of [{...observation.autopilot,phase:0},{...observation.autopilot,taskKey:`world:${time(1)}`},{...observation.autopilot,taskKey:'world:anything'}])assert.throws(()=>validateAutopilotJob({...observation,autopilot:meta},s));
  const answer=addJob(s,research(s));const video=addJob(s,{kind:'video',taskKey:`video:${answer.id}`,parentJobId:answer.id});
  assert.throws(()=>validateAutopilotJob({...video,type:'forai'},s));
  assert.throws(()=>validateAutopilotJob({...video,autopilot:{...video.autopilot,parentJobId:observation.id,taskKey:`video:${observation.id}`}},s));
  assert.equal(validateAutopilotJob({id:randomUUID(),type:'document'}),true);assert.throws(()=>validateAutopilotJob({autopilot:null}));
});

test('status exposes bounded factual operation and blockers without raw owner input or pretending all products work',()=>{
  const s=state();world(s);const job=addJob(s,research(s),{status:'running'});const status=getAutopilotStatus(s,options());
  assert.equal(status.activeJobId,job.id);assert.equal(status.tracks[0].status,'active');assert.equal(status.recentJobs.length,2);assert.equal(status.tracks.length,9);
  assert.ok(status.blockers.some(item=>item.id==='developer-worker'&&/작업자가 없습니다/.test(item.reason)));assert.ok(status.blockers.some(item=>item.id==='grok-product'));
  assert.doesNotMatch(JSON.stringify(status),/private fixture|researchRequest|agentJournal/);assert.equal(Object.hasOwn(status,'question'),false);
  job.agentJournal.calls[0].status='reserved';assert.equal(getAutopilotStatus(s,options()).tracks[0].status,'active');
  job.agentJournal.calls[0].status='unknown';assert.equal(getAutopilotStatus(s,options()).tracks[0].status,'blocked');
});
