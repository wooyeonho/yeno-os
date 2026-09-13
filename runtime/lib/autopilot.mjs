import {rankMotivatedCandidates,motivationStatus,validateMotivation} from './motivation.mjs';
import {agentUsage} from './agent.mjs';
import {RESEARCH_TRACKS, validateResearchRequest} from './research.mjs';

// This planner is deliberately pure. The runtime must persist the selected job
// and its identity together, and verify artifact bytes before a derived action.
export const AUTOPILOT_INTERVAL_MS=6*60*60*1000;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const ACTIVE=new Set(['queued','running']);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const exact=(value,keys)=>object(value)&&Object.keys(value).sort().join() === [...keys].sort().join();
const timestamp=value=>{const result=value instanceof Date?value.toISOString():value??new Date().toISOString();if(!iso(result))throw new TypeError('Invalid autopilot time');return result;};
const created=job=>iso(job.createdAt)?Date.parse(job.createdAt):0;
const ownJobs=state=>(state.jobs??[]).filter(job=>job.autopilot);
const calls=job=>job.agentJournal?.calls??[];
const uncertain=job=>calls(job).some(call=>call.status!=='settled');
const finalResearchCheckpoint=job=>{const assistant=job.agentJournal?.history?.findLast(message=>message.role==='assistant');return job.callLimit===1&&calls(job).length===1&&!uncertain(job)&&typeof assistant?.content==='string'&&assistant.content.trim().length>0&&Array.isArray(assistant.toolCalls)&&assistant.toolCalls.length===0;};
const projectAvailable=(state,track)=>(state.projects??[]).some(project=>project.id===track.projectId&&project.status!=='archived');
const keyFor=(code,phase)=>`research:${code}:${phase}`;
const worldKey=at=>`world:${new Date(Math.floor(Date.parse(at)/AUTOPILOT_INTERVAL_MS)*AUTOPILOT_INTERVAL_MS).toISOString()}`;
const latest=jobs=>jobs.reduce((result,job)=>!result||created(job)>created(result)?job:result,null);

export function initialAutopilot(){
  return {version:1,enabled:false,dailyAiLimit:4,enabledAt:null,lastError:null,retryAt:null};
}

export function validateAutopilot(value){
  if(!exact(value,['version','enabled','dailyAiLimit','enabledAt','lastError','retryAt'])||value.version!==1||typeof value.enabled!=='boolean'||!Number.isSafeInteger(value.dailyAiLimit)||value.dailyAiLimit<1||value.dailyAiLimit>4||!(value.enabledAt===null||iso(value.enabledAt))||(value.enabled&&value.enabledAt===null)||!(value.retryAt===null||iso(value.retryAt))||!(value.lastError===null||(typeof value.lastError==='string'&&value.lastError.length>0&&value.lastError.length<=300&&value.lastError===value.lastError.trim()&&!/[\u0000-\u001f\u007f]/u.test(value.lastError))))throw new TypeError('Invalid persisted autopilot settings');
  return true;
}

export function validateAutopilotJob(job,state){
  if(!Object.hasOwn(job,'autopilot'))return true;
  const {motivation,...meta}=job.autopilot;
  if(motivation!==undefined)validateMotivation(motivation);
  if(!object(meta)||meta.version!==1||!['world','research','forai','video','capability'].includes(meta.kind)||typeof meta.taskKey!=='string')throw new TypeError('Invalid autopilot job identity');
  if(meta.kind==='capability'){
    const request=job.capabilityRequest;
    if(!exact(meta,['version','kind','taskKey','capabilityId','manifestHash'])||job.type!=='capability'||!request||request.id!==meta.capabilityId||request.hash!==meta.manifestHash||!HASH.test(request.hash??'')||!HASH.test(request.inputSha256??'')||meta.taskKey!==`cap:${request.id}:${request.hash}:${request.inputSha256}`)throw new TypeError('Invalid capability decision identity');
  }else if(meta.kind==='world'){
    const at=meta.taskKey.slice(6);
    if(!exact(meta,['version','kind','taskKey'])||job.type!=='world'||!meta.taskKey.startsWith('world:')||!iso(at)||worldKey(at)!==meta.taskKey)throw new TypeError('Invalid autopilot world identity');
  }else if(meta.kind==='research'){
    const track=RESEARCH_TRACKS.find(item=>item.code===meta.trackCode);
    if(!exact(meta,['version','kind','taskKey','phase','trackCode',...(meta.phase>0?['parentJobId']:[])])||job.type!=='agent'||job.callLimit!==1||!track||!Number.isSafeInteger(meta.phase)||meta.phase<0||meta.phase>2||meta.taskKey!==keyFor(track.code,meta.phase)||job.projectId!==track.projectId||job.researchRequest?.projectId!==track.projectId||job.researchRequest?.trackCode!==track.code||(meta.phase>0&&!UUID.test(meta.parentJobId??'')))throw new TypeError('Invalid autopilot research identity');
    validateResearchRequest(job.researchRequest);
    if(state&&meta.phase>0){const parent=(state.jobs??[]).find(item=>item.id===meta.parentJobId);if(!parent||parent.status!=='completed'||parent.autopilot?.kind!=='research'||parent.autopilot.trackCode!==meta.trackCode||parent.autopilot.phase!==meta.phase-1||parent.projectId!==job.projectId)throw new TypeError('Invalid autopilot research parent');validateAutopilotJob(parent,state);}
  }else{
    if(!exact(meta,['version','kind','taskKey','parentJobId'])||job.type!==meta.kind||!UUID.test(meta.parentJobId??'')||meta.taskKey!==`${meta.kind}:${meta.parentJobId}`)throw new TypeError('Invalid autopilot derivative identity');
    if(state){const parent=(state.jobs??[]).find(item=>item.id===meta.parentJobId);if(!parent||parent.status!=='completed'||parent.autopilot?.kind!=='research'||parent.type!=='agent')throw new TypeError('Invalid autopilot derivative parent');validateAutopilotJob(parent,state);}
  }
  if(state&&(state.jobs??[]).some(other=>other.id!==job.id&&other.autopilot?.taskKey===meta.taskKey))throw new TypeError('Duplicate autopilot task identity');
  return true;
}

function verifiedAnswerMetadata(state,job){
  if(job.status!=='completed'||uncertain(job))return false;
  const name=`research-answer-${job.id.slice(0,8)}.md`;
  const answer=(job.artifacts??[]).find(item=>item.name===name);
  const stored=state.artifacts?.[answer?.id];
  const evidence=state.artifacts?.[job.researchEvidenceId];
  return !!(stored&&stored.jobId===job.id&&stored.name===name&&HASH.test(stored.sha256??'')&&stored.bytes>0&&evidence&&evidence.jobId===job.id&&evidence.name===`research-evidence-${job.id.slice(0,8)}.json`&&HASH.test(evidence.sha256??'')&&evidence.bytes>0);
}

function holdReason(job,at,state){
  if(uncertain(job)&&!(ACTIVE.has(job.status)&&calls(job).every(call=>call.status!=='unknown')))return '이전 모델 응답이 미확인 상태입니다. 같은 작업을 자동 재전송하지 않습니다.';
  if(job.status==='failed')return '실패 기록을 보존했습니다. 같은 단계를 자동 재전송하지 않습니다.';
  if(job.status==='cancelled')return '소유자가 취소한 단계입니다.';
  if(job.status==='paused'){
    if(job.pauseReason==='owner')return '소유자가 이 단계의 작업을 멈췄습니다.';
    if(job.deadlineAt&&Date.parse(job.deadlineAt)<=Date.parse(at))return '실행 시간이 만료되어 결과와 호출 기록을 보존했습니다.';
    if(!['restart','shutdown'].includes(job.pauseReason))return '중지 사유를 보존했습니다. 전체 재개로 이 작업을 다시 보내지 않습니다.';
    if(calls(job).length>0&&!finalResearchCheckpoint(job))return '정산된 호출의 최종 답안 체크포인트를 확인할 수 없어 재개하지 않습니다.';
  }
  if(job.status==='completed'&&!verifiedAnswerMetadata(state,job))return '저장된 답안과 근거의 확인 가능한 결과 참조가 없습니다.';
  return null;
}

function trackProgress(state,at){
  const jobs=ownJobs(state);
  return RESEARCH_TRACKS.map(track=>{
    const own=jobs.filter(job=>job.autopilot.kind==='research'&&job.autopilot.trackCode===track.code);
    const last=latest(own);
    if(!projectAvailable(state,track))return {...track,phase:0,status:'blocked',reason:'원본 프로젝트가 등록되지 않았거나 보관 처리되었습니다.',lastJobId:last?.id??null,previousJob:null};
    let previousJob=null;
    for(let phase=0;phase<3;phase++){
      const job=own.find(item=>item.autopilot.phase===phase);
      if(!job)return {...track,phase,status:'ready',reason:null,lastJobId:last?.id??null,previousJob};
      const reason=holdReason(job,at,state);
      if(reason)return {...track,phase,status:'blocked',reason,lastJobId:job.id,previousJob};
      if(job.status!=='completed')return {...track,phase,status:ACTIVE.has(job.status)?'active':'waiting',reason:job.status==='paused'?'서버 재시작 뒤 안전한 체크포인트에서 이어갑니다.':null,lastJobId:job.id,previousJob};
      previousJob=job;
    }
    return {...track,phase:2,status:'validation',reason:'근거·반증·재현 계획을 저장했습니다. 실제 원자료와 독립 검증 결과가 있어야 다음 연구로 진행합니다.',lastJobId:last?.id??null,previousJob};
  });
}

function context(state,options={}){
  const at=timestamp(options.at),config=options.config??{},settings=state.autopilot??initialAutopilot();
  validateAutopilot(settings);
  const jobs=ownJobs(state),globalUsedToday=agentUsage(state.jobs??[],at).attempts,aiUsedToday=agentUsage(jobs,at).attempts;
  return {at,time:Date.parse(at),config,settings,jobs,globalUsedToday,aiUsedToday,capabilities:Array.isArray(options.capabilities)?options.capabilities:[],globalLimit:Number.isSafeInteger(config.dailyCallLimit)?config.dailyCallLimit:0,tracks:trackProgress(state,at)};
}

function aiAvailable(ctx){return !!ctx.config.ready&&ctx.aiUsedToday<ctx.settings.dailyAiLimit&&ctx.globalUsedToday<ctx.globalLimit;}
function resumeAllowed(job,state,ctx){
  if(job.status!=='paused'||!['restart','shutdown'].includes(job.pauseReason)||uncertain(job)||(job.deadlineAt&&Date.parse(job.deadlineAt)<=ctx.time))return false;
  if(job.autopilot.kind==='research'){
    const track=RESEARCH_TRACKS.find(item=>item.code===job.autopilot.trackCode);
    if(!projectAvailable(state,track)||!iso(job.deadlineAt)||Date.parse(job.deadlineAt)<=ctx.time||job.callLimit!==1)return false;
    // At step 2 the server only saves the already verified draft. A provider
    // outage/configuration change must not strand this local completion; all
    // earlier checkpoints still need their provider and existing call budget.
    const finalAnswer=finalResearchCheckpoint(job);
    if(job.step===2&&finalAnswer&&typeof job.draft==='string'&&job.draft.trim().length>0)return true;
    return !!ctx.config.ready&&(calls(job).length===0?aiAvailable(ctx):finalAnswer);
  }
  if(job.type==='capability'&&job.step<2&&!state.capabilities?.entries?.some(e=>e.id===job.capabilityRequest?.id&&e.activeHash===job.capabilityRequest?.hash))return false;
  return state.modules?.documents===true;
}

function researchQuestion(track){
  const tasks=[
    '현재 공개 근거에서 이 난제의 좁은 질문 하나를 정하고, 관측된 사실·서로 충돌하는 결과·부족한 데이터를 표로 정리해 가장 먼저 확인할 반증 가능한 가설 하나를 제시하세요.',
    '이전 저장 답안을 출발점으로 핵심 가설을 반박하는 근거와 대안 설명을 찾으세요. 지지 자료만 반복하지 말고 교란·표본 독립성·일반화 실패를 구분하며 어떤 관측이면 가설을 기각할지 수치·단위·대조 조건으로 명시하세요.',
    '이전 근거와 반증 검토에서 살아남은 좁은 질문에 대해 재현 가능한 검증 계획을 만드세요. 필요한 공개 데이터·변수·단위·제외 기준·누수 방지·독립 검증 집합·기각 기준·예상 산출물 형식을 명시하고 데이터가 없으면 그 지점을 표시하세요. 수행하지 않은 분석·실험 결과를 만들지 마세요.'
  ];
  return `${track.name}. ${tasks[track.phase]} 원본 범위: ${track.scopeConstraints} 이번 결과는 검증 전 연구 초안이며 난제를 해결했다거나 임상·현장 효과가 입증됐다고 하지 마세요.`;
}

function derivativeParent(state,ctx,kind){
  return [...ctx.jobs].sort((a,b)=>created(b)-created(a)).find(job=>job.autopilot.kind==='research'&&projectAvailable(state,RESEARCH_TRACKS.find(track=>track.code===job.autopilot.trackCode))&&verifiedAnswerMetadata(state,job)&&!ctx.jobs.some(child=>child.autopilot.taskKey===`${kind}:${job.id}`));
}
const derivativeToday=(ctx,kind)=>ctx.jobs.some(job=>job.autopilot.kind===kind&&job.createdAt?.slice(0,10)===ctx.at.slice(0,10));
function eligible(state,ctx){
  return ctx.settings.enabled&&!state.emergencyStop&&!(ctx.settings.retryAt&&Date.parse(ctx.settings.retryAt)>ctx.time)&&!(state.jobs??[]).some(job=>ACTIVE.has(job.status));
}
function rankedCandidates(state,ctx){
  if(!eligible(state,ctx))return [];
  const candidates=[];
  const add=(action,goal,signals,successCriterion='실제 근거와 결과 파일을 저장하고 호출·실패 기록을 보존한다.')=>candidates.push({action,goal,signals,successCriterion});
  const lastWorld=latest(ctx.jobs.filter(job=>job.autopilot.kind==='world')),worldTaskKey=worldKey(ctx.at);
  if(state.modules?.documents===true&&(!lastWorld||created(lastWorld)+AUTOPILOT_INTERVAL_MS<=ctx.time)&&!ctx.jobs.some(job=>job.autopilot.taskKey===worldTaskKey))add({kind:'world',taskKey:worldTaskKey},'오래되었거나 없는 공개 관측을 새 자료로 갱신한다.',{knowledgeGap:3,verificationGap:1,estimatedCalls:0});
  const lastResearch=latest(ctx.jobs.filter(job=>job.autopilot.kind==='research'));
  if(aiAvailable(ctx)&&(!lastResearch||created(lastResearch)+AUTOPILOT_INTERVAL_MS<=ctx.time))for(const next of ctx.tracks.filter(track=>track.status==='ready')){
    const coverageGap=Math.max(0,ctx.tracks.reduce((sum,t)=>sum+t.phase,0)/Math.max(1,ctx.tracks.length)-next.phase);
    const phaseGoal=['공개 근거가 없는 질문의 첫 근거표와 검증 가설을 만든다.','이전 가설의 반대 근거와 대안 설명을 검토한다.','검증을 수행하지 못한 가설의 재현 계획을 구체화한다.'][next.phase];
    const action={kind:'research',taskKey:keyFor(next.code,next.phase),trackCode:next.code,phase:next.phase,projectId:next.projectId,question:researchQuestion(next),query:next.defaultEnglishQuery,...(next.previousJob?{previousJobId:next.previousJob.id}:{})};
    add(action,`${next.code} · ${phaseGoal}`,{knowledgeGap:next.phase===0?3:1,coverageGap,verificationGap:next.phase+1,estimatedCalls:1});
  }
  if(state.modules?.documents===true)for(const kind of ['forai','video']){
    if(derivativeToday(ctx,kind))continue;const parent=derivativeParent(state,ctx,kind);if(!parent)continue;
    add({kind,taskKey:`${kind}:${parent.id}`,parentJobId:parent.id},kind==='forai'?'저장된 연구를 다시 읽을 수 있는 개인 페이지와 점검 결과로 만든다.':'저장된 연구의 출처·한계를 확인할 수 있는 영상으로 만든다.',{assetGap:1,reuseArtifacts:1,deliveryGap:kind==='video'?2:1,verificationGap:kind==='forai'?2:0,estimatedCalls:0});
  }
  if(state.modules?.documents===true&&!derivativeToday(ctx,'capability'))for(const candidate of ctx.capabilities){
    if(candidate.kind!=='capability'||!['failure-triage','evidence-gap-brief'].includes(candidate.capabilityId)||!HASH.test(candidate.manifestHash??'')||!candidate.input||typeof candidate.taskKey!=='string'||ctx.jobs.some(job=>job.autopilot.taskKey===candidate.taskKey))continue;
    add(candidate,candidate.goal,{repairNeed:candidate.focus==='wrath'?Math.min(4,candidate.input.records?.length??0):0,verificationGap:candidate.focus==='pride'?3:0,assetGap:1,reuseArtifacts:1,estimatedCalls:0},candidate.successCriterion);
  }
  return rankMotivatedCandidates(state,candidates,ctx.at);
}
function choose(state,ctx){
  if(!eligible(state,ctx))return null;
  for(const job of [...ctx.jobs].sort((a,b)=>created(a)-created(b)))if(resumeAllowed(job,state,ctx))return {kind:'resume',jobId:job.id};
  return rankedCandidates(state,ctx)[0]?.action??null;
}

export function planAutopilot(state,options={}){return choose(state,context(state,options));}

export function getAutopilotStatus(state,options={}){
  const ctx=context(state,options),active=ctx.jobs.find(job=>ACTIVE.has(job.status));
  const blockers=[
    {id:'developer-worker',title:'자동 기능 수정',reason:'코드 흡수·자동 개발에서 맡긴 JavaScript 기능은 작성·시험·수정할 수 있습니다. 코어 저장소의 자동 수정·배포 작업자가 없습니다. 지정하지 않은 기능의 반복 개발도 연결하지 않았습니다.'},
    {id:'grok-product',title:'Grok Bot 제품',reason:'제품 계정과 실행 연결이 완료되지 않았습니다. 모델 API 연결만으로 제품을 운영했다고 표시하지 않습니다.'},
    {id:'external-publishing',title:'게시·발송',reason:'외부 게시·메시지 발송 연결이 없습니다. 결과 파일은 개인 운영실에 저장합니다.'},
    {id:'god-eye-coverage',title:'God Eye 관측 범위',reason:'USGS·NASA 공개 재난 관측을 실행합니다. 항공·선박 실시간 추적과 3D 지구는 미구현입니다.'},
    {id:'novel-canon',title:'자동 소설 연재',reason:'원본 세계관을 보존한 연속 집필과 게시 자동화가 미완료입니다. 인수검사용 작품·안부·장소 기록을 실제 운영 입력으로 선택하지 않습니다.'}
  ];
  if(!ctx.config.ready)blockers.unshift({id:'model',title:'연구 모델 연결',reason:'선택한 제공자의 키·모델·호출 한도 연결이 필요합니다.'});
  if(ctx.aiUsedToday>=ctx.settings.dailyAiLimit||ctx.globalUsedToday>=ctx.globalLimit)blockers.unshift({id:'budget',title:'오늘 모델 호출 한도',reason:'자율 실행 또는 전체 호출 한도에 도달했습니다. 미확인·예약 호출도 포함하며 UTC 날짜가 바뀐 뒤 다시 확인합니다.'});
  if(state.modules?.documents!==true)blockers.unshift({id:'documents',title:'관측·페이지·영상 실행 중지',reason:'문서 모듈이 꺼져 있어 관측·페이지 점검·영상을 새로 실행하지 않습니다.'});
  const labels={world:'세계 관측',forai:'연구 페이지 점검',video:'연구 영상',capability:'흡수 기능 실행'};
  blockers.unshift(...ctx.jobs.filter(job=>job.autopilot.kind!=='research'&&['failed','cancelled','paused'].includes(job.status)&&!resumeAllowed(job,state,ctx)).sort((a,b)=>created(b)-created(a)).slice(0,8).map(job=>({id:`job-${job.id}`,title:`${labels[job.autopilot.kind]} · ${job.status==='failed'?'실패':job.status==='cancelled'?'취소':'중지'} (${job.id.slice(0,8)})`,reason:job.status==='failed'?'실패한 작업과 입력을 보존했습니다. 같은 작업을 새 ID로 자동 재전송하지 않습니다.':job.status==='cancelled'?'취소 기록을 보존하며 이 작업은 자동으로 다시 만들지 않습니다.':job.pauseReason==='owner'?'소유자가 멈춘 작업입니다. 자동 재개하지 않습니다.':`중지 기록을 보존했습니다. ${state.modules?.documents!==true?'문서 모듈이 꺼져 있습니다.':'자동 재개 조건을 충족하지 않습니다.'}`})));
  for(const track of ctx.tracks.filter(item=>item.status==='blocked'))blockers.push({id:`track-${track.code}`,title:track.name,reason:track.reason});
  const decision=choose(state,ctx);
  let nextAt=null,summary;
  if(!ctx.settings.enabled)summary='자동 실행이 꺼져 있습니다.';
  else if(state.emergencyStop)summary='전체 멈춤 상태입니다. 전체 재개만으로 자동 실행을 켜지 않습니다.';
  else if(ctx.settings.retryAt&&Date.parse(ctx.settings.retryAt)>ctx.time){nextAt=ctx.settings.retryAt;summary='실행 준비 오류를 보존하고 다음 점검 시각까지 기다립니다.';}
  else if(active)summary='앱을 닫아도 현재 자동 작업을 계속하고 결과를 저장합니다.';
  else if((state.jobs??[]).some(job=>ACTIVE.has(job.status)))summary='먼저 접수된 작업이 끝나면 자동 작업을 선택합니다.';
  else if(decision){nextAt=ctx.at;summary=decision.motivation?decision.motivation.goal:decision.kind==='resume'?'저장된 자동 작업을 안전하게 이어갑니다.':decision.kind==='world'?'공개 재난 자료를 새로 수집합니다.':decision.kind==='research'?'다음 연구 단계를 선택했습니다. 근거와 답안을 저장합니다.':decision.kind==='forai'?'완료된 연구 기록으로 개인 연구 페이지를 만들고 구조를 점검합니다.':'완료된 연구 기록으로 출처와 한계를 표시한 영상을 만듭니다.';}
  else{
    const due=[];
    if(state.modules?.documents===true){
      const last=latest(ctx.jobs.filter(job=>job.autopilot.kind==='world'));due.push(last?created(last)+AUTOPILOT_INTERVAL_MS:ctx.time);
      for(const kind of ['forai','video'])if(derivativeParent(state,ctx,kind))due.push(derivativeToday(ctx,kind)?Date.parse(`${ctx.at.slice(0,10)}T00:00:00.000Z`)+24*60*60*1000:ctx.time);
    }
    if(ctx.config.ready&&ctx.tracks.some(track=>track.status==='ready')){
      const last=latest(ctx.jobs.filter(job=>job.autopilot.kind==='research'));
      let researchDue=last?created(last)+AUTOPILOT_INTERVAL_MS:ctx.time;
      if(!aiAvailable(ctx))researchDue=Math.max(researchDue,Date.parse(`${ctx.at.slice(0,10)}T00:00:00.000Z`)+24*60*60*1000);
      due.push(researchDue);
    }
    if(due.length)nextAt=new Date(Math.max(ctx.time,Math.min(...due))).toISOString();
    summary=ctx.tracks.every(track=>['validation','blocked'].includes(track.status))?'연구 초안의 자동 반복을 멈추고 실제 검증 자료를 기다립니다. 공개 재난 관측은 설정에 따라 계속합니다.':'호출 한도와 실행 간격을 지키며 다음 작업을 기다립니다.';
  }
  return {mind:motivationStatus(state,rankedCandidates(state,ctx),decision,ctx.at),enabled:ctx.settings.enabled,dailyAiLimit:ctx.settings.dailyAiLimit,aiUsedToday:ctx.aiUsedToday,globalLimit:ctx.globalLimit,globalUsedToday:ctx.globalUsedToday,activeJobId:active?.id??null,nextAt,summary,tracks:ctx.tracks.map(({code,name,phase,status,reason,lastJobId})=>({code,name,phase,status,reason,lastJobId})),blockers,recentJobs:[...ctx.jobs].sort((a,b)=>created(b)-created(a)).slice(0,12).map(job=>job.id),lastError:ctx.settings.lastError};
}
