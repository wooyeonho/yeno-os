// Seven bounded motives rank only already-authorized, executable candidates.
// They cannot grant tools, create budgets, retry uncertain calls or prove quality.
export const DRIVE_DEFINITIONS=Object.freeze([
  {id:'greed',name:'강욕',description:'저장된 결과를 재사용 가능한 자산으로 축적'},
  {id:'gluttony',name:'폭식',description:'비어 있거나 오래된 공개 근거를 보충'},
  {id:'envy',name:'질투',description:'같은 포트폴리오 안에서 뒤처진 검증 단계를 보충'},
  {id:'pride',name:'오만',description:'결과의 근거와 전달 형식의 검증 공백을 축소'},
  {id:'lust',name:'색욕',description:'소유자가 바로 읽고 볼 수 있는 결과를 완성'},
  {id:'wrath',name:'분노',description:'실제 실패를 분석하고 불확실한 실행을 회피'},
  {id:'sloth',name:'나태',description:'추가 모델 호출 없이 기존 결과와 체크포인트를 재사용'}
]);
export const DRIVE_IDS=Object.freeze(DRIVE_DEFINITIONS.map(item=>item.id));
export const MISSING_MEASUREMENTS=Object.freeze(['revenue','audience','independent_research_validation','owner_result_rating']);
export const SIGNAL_IDS=Object.freeze(['assetGap','knowledgeGap','coverageGap','verificationGap','deliveryGap','repairNeed','reuseArtifacts','estimatedCalls','ownFailures','unknownCalls','missingArtifacts']);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>object(value)&&Object.keys(value).sort().join() === [...keys].sort().join();
const iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const plain=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&value===value.trim()&&!/[\u0000-\u001f\u007f]/u.test(value);
const HASH=/^[a-f0-9]{64}$/;
const fixed=(n)=>Math.round(n*100)/100;
const bounded=n=>Number.isFinite(n)?Math.max(0,Math.min(1000000,n)):0;
const ordered=components=>DRIVE_IDS.map(id=>({id,value:components[id]})).sort((a,b)=>b.value-a.value||DRIVE_IDS.indexOf(a.id)-DRIVE_IDS.indexOf(b.id));
const dominant=components=>ordered(components).filter(item=>item.value>0).slice(0,2).map(item=>item.id);
export function emptySignals(overrides={}){return Object.fromEntries(SIGNAL_IDS.map(id=>[id,bounded(overrides[id]??0)]));}

export function scoreMotivation(signals){
  // The declared weights are policy priorities, not measured wealth or quality.
  const s=signals;
  return {
    greed:fixed(s.reuseArtifacts*6+s.assetGap*8),
    gluttony:fixed(s.knowledgeGap*16),
    envy:fixed(s.coverageGap*9),
    pride:fixed(s.verificationGap*12),
    lust:fixed(s.deliveryGap*10),
    wrath:fixed(s.repairNeed*20-s.ownFailures*28-s.unknownCalls*36-s.missingArtifacts*8),
    sloth:fixed((1-s.estimatedCalls)*14+s.reuseArtifacts*4)
  };
}
export function validateMotivation(value){
  if(!exact(value,['version','decidedAt','goal','successCriterion','dominantDrives','score','components','signals','missingMeasurements'])||value.version!==1||!iso(value.decidedAt)||!plain(value.goal,500)||!plain(value.successCriterion,500)||!Number.isFinite(value.score)||Math.abs(value.score)>100000000||!exact(value.components,DRIVE_IDS)||!exact(value.signals,SIGNAL_IDS)||!Array.isArray(value.dominantDrives)||value.dominantDrives.length<1||value.dominantDrives.length>2||new Set(value.dominantDrives).size!==value.dominantDrives.length||value.dominantDrives.some(id=>!DRIVE_IDS.includes(id))||!Array.isArray(value.missingMeasurements)||value.missingMeasurements.join()!==MISSING_MEASUREMENTS.join())throw new TypeError('Invalid persisted motivation');
  if(SIGNAL_IDS.some(id=>!Number.isFinite(value.signals[id])||value.signals[id]<0||value.signals[id]>1000000)||value.signals.estimatedCalls>1)throw new TypeError('Invalid motivation signals');
  const expected=scoreMotivation(value.signals);
  if(DRIVE_IDS.some(id=>value.components[id]!==expected[id])||value.score!==fixed(DRIVE_IDS.reduce((sum,id)=>sum+expected[id],0))||value.dominantDrives.join()!==dominant(expected).join())throw new TypeError('Inconsistent motivation scores');
  return true;
}

function artifactStats(state,job){
  const seen=new Set();let count=0,bytes=0;
  for(const reference of job.artifacts??[]){
    const entry=state.artifacts?.[reference.id];
    if(!seen.has(reference.id)&&entry&&entry.jobId===job.id&&entry.name===reference.name&&HASH.test(entry.sha256??'')&&Number.isSafeInteger(entry.bytes)&&entry.bytes>0){seen.add(reference.id);count++;bytes+=entry.bytes;}
  }
  return {count,bytes};
}
export function observedFeedback(state,{limit=12}={}){
  return (state.jobs??[]).filter(job=>job.autopilot).sort((a,b)=>(Date.parse(b.updatedAt??b.createdAt)||0)-(Date.parse(a.updatedAt??a.createdAt)||0)||a.id.localeCompare(b.id)).slice(0,limit).map(job=>{
    const files=artifactStats(state,job),unknown=(job.agentJournal?.calls??[]).some(call=>call.status!=='settled');
    const outcome=unknown?'unknown':job.status==='completed'?(files.count?'artifact_saved':'completed_without_verified_artifact'):['failed','paused','cancelled'].includes(job.status)?job.status:'pending';
    const criterionMet=job.status==='completed'?files.count>0&&!unknown:['failed','cancelled'].includes(job.status)?false:null;
    const lessons={artifact_saved:'해시와 크기가 있는 결과 참조를 저장했습니다. 내용의 정확성·수익·연구 효과는 아직 측정하지 않았습니다.',completed_without_verified_artifact:'완료 표시는 있으나 확인 가능한 결과 참조가 없습니다. 이 실행의 우선순위를 낮춥니다.',failed:'실패한 입력과 단계는 자동 재전송하지 않으며 같은 실행 종류의 우선순위를 낮춥니다.',unknown:'모델 호출 결과가 미확인입니다. 같은 입력을 재전송하지 않고 불확실성 비용을 반영합니다.',paused:'중지 사유를 지킵니다. 허용된 재시작 체크포인트만 같은 작업에서 이어갑니다.',cancelled:'소유자 취소를 보존하고 같은 단계를 다시 만들지 않습니다.',pending:'이미 접수된 결과를 기다리며 다른 자율 작업을 중복 생성하지 않습니다.'};
    return {jobId:job.id,kind:job.autopilot.kind,status:job.status,at:job.updatedAt??job.createdAt,outcome,artifactCount:files.count,artifactBytes:files.bytes,criterionMet,lesson:lessons[outcome],goal:job.autopilot.motivation?.goal??null,dominantDrives:job.autopilot.motivation?.dominantDrives??[]};
  });
}
export function executionEvidence(state,kind){
  const all=observedFeedback(state,{limit:1000000}).filter(item=>item.kind===kind).slice(0,8);
  return {ownFailures:all.filter(item=>['failed','cancelled'].includes(item.outcome)).length,unknownCalls:all.filter(item=>item.outcome==='unknown').length,missingArtifacts:all.filter(item=>item.outcome==='completed_without_verified_artifact').length};
}

export function rankMotivatedCandidates(state,candidates,at){
  return candidates.map(candidate=>{
    const signals=emptySignals({...candidate.signals,...executionEvidence(state,candidate.action.kind)}),components=scoreMotivation(signals);
    const motivation={version:1,decidedAt:at,goal:candidate.goal,successCriterion:candidate.successCriterion,dominantDrives:dominant(components),score:fixed(DRIVE_IDS.reduce((sum,id)=>sum+components[id],0)),components,signals,missingMeasurements:[...MISSING_MEASUREMENTS]};
    validateMotivation(motivation);
    return {...candidate,action:{...candidate.action,motivation},motivation};
  }).sort((a,b)=>b.motivation.score-a.motivation.score||a.action.taskKey.localeCompare(b.action.taskKey));
}
const publicCandidate=candidate=>({kind:candidate.action.kind,taskKey:candidate.action.taskKey,goal:candidate.motivation.goal,successCriterion:candidate.motivation.successCriterion,score:candidate.motivation.score,dominantDrives:candidate.motivation.dominantDrives,components:candidate.motivation.components,signals:candidate.motivation.signals,selected:false});
export function motivationStatus(state,ranked,selected,at){
  const candidates=ranked.slice(0,20).map(candidate=>({...publicCandidate(candidate),selected:candidate.action.taskKey===selected?.taskKey}));
  const feedback=observedFeedback(state);
  const drives=DRIVE_DEFINITIONS.map(drive=>{
    const measured=ranked.map(candidate=>candidate.motivation.components[drive.id]);
    const peak=measured.length?Math.max(...measured):0;
    const leader=ranked.find(candidate=>candidate.motivation.components[drive.id]===peak);
    return {...drive,pressure:Math.min(100,Math.max(0,peak)),reason:leader?`${leader.goal} · 기여 ${peak}점`: '현재 실행 가능한 후보가 없어 새 작업을 만들지 않습니다.'};
  });
  const last=(state.jobs??[]).filter(job=>job.autopilot?.motivation).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt))[0];
  const lastDecision=last?{...last.autopilot.motivation,kind:last.autopilot.kind,jobId:last.id}:null;
  return {version:1,at,lastDecision,drives,candidates,selected:candidates.find(candidate=>candidate.selected)??(selected?.kind==='resume'?{kind:'resume',jobId:selected.jobId,goal:'저장된 작업을 같은 ID로 마무리',successCriterion:'추가 호출 없이 가능한 체크포인트를 보존해 기존 결과 파일을 완성',score:null,dominantDrives:['sloth'],components:null,signals:null,selected:true}:null),feedback,missingMeasurements:[...MISSING_MEASUREMENTS]};
}
