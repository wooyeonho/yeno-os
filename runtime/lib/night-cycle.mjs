import {createHash} from 'node:crypto';
import {expireStaleGaps} from './gap-scout.mjs';
import {validateNightCycle} from './night-cycle-state.mjs';

const parts = (at,timeZone) => Object.fromEntries(new Intl.DateTimeFormat('en-CA',{
  timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',
}).formatToParts(new Date(at)).filter(item=>item.type!=='literal').map(item=>[item.type,item.value]));

export function nightCycleDate(window,at) {
  if(window===null)return null;
  const p=parts(at,window.timeZone),minute=Number(p.hour)*60+Number(p.minute);
  const wraps=window.startMinute>window.endMinute;
  const inside=wraps?minute>=window.startMinute||minute<window.endMinute:minute>=window.startMinute&&minute<window.endMinute;
  if(!inside)return null;
  const localDate=`${p.year}-${p.month}-${p.day}`;
  if(wraps&&minute<window.endMinute)return new Date(Date.parse(`${localDate}T00:00:00Z`)-86400000).toISOString().slice(0,10);
  return localDate;
}

function failureCode(error) { return typeof error==='string' && /^[a-z][a-z0-9_]{1,79}$/.test(error) ? error : 'unclassified'; }
function markdown(cycleDate,s) {
  const lines=[`# 밤사이 보고 · ${cycleDate}`,'','실제 저장 기록만 정리했습니다. 모델 호출 0건. 이 보고는 결과의 내용 품질을 검증하지 않습니다.','',
    `- 실패 코드 묶음 ${s.failures.length}종`,...s.failures.map(row=>`  - ${row.code}: ${row.count}건 (${row.jobIds.join(', ')})`),
    `- 만료 표시된 갭 ${s.staleGapIds.length}건`,...s.staleGapIds.map(id=>`  - ${id}`),
    `- 중복 산출물 해시 후보 ${s.duplicateArtifactHashes.length}건`,...s.duplicateArtifactHashes.map(id=>`  - ${id}`),
    `- 활성 능력 ${s.reusableCapabilityIds.length}건`,...s.reusableCapabilityIds.map(id=>`  - ${id}`),
    `- 자기 미화 초안 ${s.beautyDraftIds.length}건`,...s.beautyDraftIds.map(id=>`  - ${id}`),''];
  return lines.join('\n');
}

export function runNightCycle(state,at) {
  validateNightCycle(state.nightCycle);
  const cycleDate=nightCycleDate(state.nightCycle.window,at);
  if(cycleDate===null||state.emergencyStop)return {ran:false,reason:cycleDate===null?'outside_or_unconfigured':'emergency_stop',report:null};
  const previous=state.nightCycle.reports.find(report=>report.cycleDate===cycleDate);
  if(previous)return {ran:false,reason:'already_recorded',report:previous};
  if(state.nightCycle.reports.length>=366)throw Error('Night report capacity reached');
  const groups=new Map();
  for(const job of state.jobs??[])if(job.status==='failed'){
    const code=failureCode(job.error),ids=groups.get(code)??[];
    ids.push(job.id);groups.set(code,ids);
  }
  const nextGapScout=structuredClone(state.gapScout);
  const nextState={...state,gapScout:nextGapScout};
  const before=new Set(nextGapScout.gaps.filter(gap=>gap.status==='pending'||gap.status==='blocked').map(gap=>gap.id));
  expireStaleGaps(nextState,at);
  const staleGapIds=nextGapScout.gaps.filter(gap=>gap.status==='stale'&&before.has(gap.id)).map(gap=>gap.id).sort();
  const artifacts=new Map();
  for(const item of Object.values(state.artifacts??{}))if(typeof item.sha256==='string')artifacts.set(item.sha256,(artifacts.get(item.sha256)??0)+1);
  const summary={
    failures:[...groups].sort(([a],[b])=>a.localeCompare(b)).map(([code,jobIds])=>({code,count:jobIds.length,jobIds:jobIds.sort()})),
    staleGapIds,duplicateArtifactHashes:[...artifacts].filter(([,count])=>count>1).map(([sha])=>sha).sort(),
    reusableCapabilityIds:(state.capabilities?.entries??[]).filter(entry=>entry.activeHash).map(entry=>entry.id).sort(),
    beautyDraftIds:(state.absorbInbox?.entries??[]).filter(entry=>entry.kind==='self-beautification'&&entry.status==='draft').map(entry=>entry.id).sort(),
    modelCalls:0,
  };
  const content=markdown(cycleDate,summary);
  const report={cycleDate,ranAt:at,summary,markdown:content,sha256:createHash('sha256').update(content).digest('hex'),authorizesDispatch:false};
  const nextNightCycle={...state.nightCycle,reports:[...state.nightCycle.reports,report]};
  validateNightCycle(nextNightCycle);
  state.gapScout=nextGapScout;
  state.nightCycle=nextNightCycle;
  return {ran:true,reason:null,report};
}
