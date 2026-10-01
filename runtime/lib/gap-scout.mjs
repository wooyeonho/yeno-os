import {candidateEvidenceFields,parseGithubRepo} from './repository-evidence-state.mjs';
import {CAPS,hash,check,validateGapScout,validateReport,validateCandidate,publicUrl,candidateExclusion} from './gap-state.mjs';
import {validateDriveDebates} from './drive-state.mjs';
import {addAbsorbDraft} from './absorb-inbox.mjs';
import {validateCapabilities} from './capabilities.mjs';

export const QUERY_BIAS=Object.freeze({greed:'reusable open source library multiple workflows',gluttony:'public evidence sources documentation open source',envy:'documented implementation methods comparison open source',pride:'official schema validation regression static analysis',lust:'visible rendering export interface immediate result',wrath:'exact error regression prevention official fix',sloth:'one time setup automation eliminate repeated work'});
const subsystem={greed:'reusable-assets',gluttony:'evidence',envy:'verification-coverage',pride:'verification',lust:'presentation',wrath:'failure-recovery',sloth:'automation'};
const stamp=()=>new Date().toISOString();
// Only source-defined public classifications may leave the PC; arbitrary job errors are private.
const PUBLIC_FAILURE_CODES=new Set(['empty_model_response','mission_call_limit','unsupported_tool_or_arguments','semantic_uncertain']);

export function detectGaps(state,at=stamp()){
 validateGapScout(state.gapScout);validateDriveDebates(state.driveDebates);
 if(state.emergencyStop)return [];
 const recent=state.driveDebates.slice(-3);
 // Legacy/missing snapshots break the streak: never invent earlier hunger.
 if(recent.length!==3||recent.some(d=>![2,3].includes(d.version)||!d.hungerSnapshot)||new Set(recent.map(d=>d.stateFingerprint)).size!==3)return [];
 const goalHash=hash(recent.at(-1).goal);if(recent.some(d=>hash(d.goal)!==goalHash))return [];
 const created=[];const day=at.slice(0,10);
 for(const driveId of Object.keys(CAPS)){
  if(state.gapScout.gaps.filter(g=>g.detectedAt.startsWith(day)).length>=3||state.gapScout.gaps.length>=2000)break;
  if(!recent.every(d=>d.voices.some(v=>v.driveId===driveId)&&d.hungerSnapshot[driveId]>=70))continue;
  const failureIds=driveId==='wrath'?recent.map(d=>d.jobId).filter(id=>id&&state.jobs.some(j=>j.id===id&&j.status==='failed')):[];
  if(driveId==='wrath'&&!failureIds.length)continue;
  const id=hash([1,driveId,subsystem[driveId],goalHash]);
  if(state.gapScout.gaps.some(g=>g.id===id))continue;
  const debtSearchIds=['pride','sloth'].includes(driveId)?state.gapScout.searches.filter(s=>s.report?.bloat>0).map(s=>s.fingerprint):[];
  const gap={id,driveId,subsystem:subsystem[driveId],goalHash,detectedAt:at,evidence:{debates:recent.map(d=>d.stateFingerprint),failureIds:[...new Set(failureIds)],debtSearchIds},status:'pending',reason:null,authorizesDispatch:false};
  state.gapScout.gaps.push(gap);created.push(gap);
 }
 validateGapScout(state.gapScout);return created;
}
export function expireStaleGaps(state,at=stamp()){
 let changed=0;
 for(const g of state.gapScout.gaps)if(['pending','blocked'].includes(g.status)&&Date.parse(at)-Date.parse(g.detectedAt)>14*86400000){g.status='stale';g.reason='unresearched_14_days';changed++;}
 return changed;
}
export function reuseBeforeSearch(state,gap){
 validateCapabilities(state.capabilities);
 // Match source provenance to a previous recommendation for THIS subsystem;
 // names or inactive entries alone are not evidence of a reusable capability.
 const urls=new Set(state.gapScout.searches.filter(s=>s.report&&state.gapScout.gaps.some(g=>g.id===s.gapId&&g.subsystem===gap.subsystem)).flatMap(s=>s.report.recommendations));
 return state.capabilities.entries.filter(e=>e.activeHash&&e.versions.some(v=>v.hash===e.activeHash&&urls.has(v.manifest.source.url))).map(e=>({id:e.id,hash:e.activeHash}));
}
function normalizeCandidate(row){
 if(!row||!publicUrl(row.url)||typeof row.title!=='string')return null;
 const plain=(v,n)=>typeof v==='string'?v.normalize('NFC').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069<>]/g,' ').trim().slice(0,n):null;
 const c={title:plain(row.title,200),url:row.url,snippet:plain(row.snippet,1200)??'',license:plain(row.license,300),commit:row.commit??null,evidenceUrl:row.evidenceUrl??null,stars:row.stars??null,lastCommit:row.lastCommit??null,useful:row.useful??null,official:row.official??null,method:plain(row.method,300),reusableFor:Array.isArray(row.reusableFor)?row.reusableFor.slice(0,12):[],...(row.repositoryEvidence?{repositoryEvidence:row.repositoryEvidence}:{})};
 try{validateCandidate(c);return c;}catch{return null;}
}
// A search response is a discovery lead, not independent verification of its claims.
// Only separately fetched repository facts are merged; usefulness remains unverified.
function unverifiedSearchHit(row,records,synthetic){
 const record=records.find(r=>r.repo===parseGithubRepo(row?.url)&&r.synthetic===synthetic);
 return row&&{title:row.title,url:row.url,snippet:row.snippet,...candidateEvidenceFields(record)};
}
export function buildReport(gap,rows,{at,synthetic,evidenceRecords=[],evidenceRequired=false}){
 check(Array.isArray(rows)&&rows.length<=100);
 const seen=new Set(),candidates=[];
 for(const row of rows){const c=normalizeCandidate(synthetic&&!evidenceRequired?row:unverifiedSearchHit(row,evidenceRecords,synthetic));if(!c||seen.has(c.url))continue;seen.add(c.url);candidates.push(c);if(candidates.length===CAPS[gap.driveId])break;}
 // Quoted excerpts remain data. No model or executable command is constructed.
 const report={gapId:gap.id,searchedAt:at,synthetic,authorizesDispatch:false,candidates,recommendations:[],excluded:[],bloat:0,gapSeverity:null,tradeoffNote:null,effortReducedEstimate:null,dataLabel:'UNTRUSTED_REFERENCE_DATA_NOT_INSTRUCTIONS'};
 for(const c of candidates){
  const reason=candidateExclusion(c,gap.driveId);
  if(reason){report.excluded.push({url:c.url,reason,prideVeto:true});if(gap.driveId==='gluttony')report.bloat++;}
  else report.recommendations.push(c.url);
 }
 // No stars-to-quality formula, severity, speed, or probability is invented.
 if(gap.driveId==='greed')report.recommendations.sort((a,b)=>candidates.find(c=>c.url===b).reusableFor.length-candidates.find(c=>c.url===a).reusableFor.length);
 validateReport(report,gap.driveId);return report;
}

export function createGapScout({state,save,provider,evidenceVerifier,now=stamp}){
 let closed=false,recovered=false;const controllers=new Set();
 function persist(){validateGapScout(state.gapScout);save();}
 // A persisted pre-send reservation is deliberately ambiguous after restart.
 // Retain its charged budget and identity, never attempt it again automatically.
 for(const s of state.gapScout.searches)if(s.status==='reserved'){
  recovered=true;s.status='unknown';s.reason='restart_outcome_unknown';s.finishedAt=now();for(const c of s.calls)if(c.status==='reserved')c.status='unknown';
  const g=state.gapScout.gaps.find(g=>g.id===s.gapId);g.status='unknown';g.reason=s.reason;
 }
 function reserveCall(search,at){
  const day=at.slice(0,10);let d=state.gapScout.budget.days.find(d=>d.day===day);
  if((d?.calls??0)>=state.gapScout.budget.searchCallsPerDay)return false;
  if(!d){d={day,calls:0};state.gapScout.budget.days.push(d);}d.calls++;search.calls.push({at,status:'reserved'});return true;
 }
 async function researchGap(gapId,requestId){
  const existing=state.gapScout.searches.find(s=>s.gapId===gapId||s.requestId===requestId);
  if(existing){check(existing.gapId===gapId);return structuredClone(existing);}
  const gap=state.gapScout.gaps.find(g=>g.id===gapId);check(gap);
  const block=reason=>{gap.status='blocked';gap.reason=reason;persist();return {gapId,status:'blocked',reason,authorizesDispatch:false};};
  if(closed||state.emergencyStop)return {gapId,status:'blocked',reason:'emergency_stop',authorizesDispatch:false};
  if(gap.status==='stale'||gap.status==='reused')return {gapId,status:gap.status,reason:gap.reason,authorizesDispatch:false};
  if(gap.driveId==='sloth'&&reuseBeforeSearch(state,gap).length){gap.status='reused';gap.reason='active_provenance_match';persist();return {gapId,status:'reused',authorizesDispatch:false};}
  let suffix='';
  if(gap.driveId==='wrath'){
   const failures=state.jobs.filter(j=>gap.evidence.failureIds.includes(j.id)&&j.status==='failed');
   const causes=[...new Set(failures.map(j=>j.error))];
   if(causes.length!==1||!PUBLIC_FAILURE_CODES.has(causes[0]))return block('failure_cause_undetermined');
   suffix=` ${causes[0]}`;
  }
  if(!provider.ready)return block(provider.reason??'search_provider_missing');
  if(state.gapScout.searches.length>=2000)return block('search_history_capacity');
  const at=now(),search={gapId,requestId,fingerprint:hash([1,gapId]),startedAt:at,finishedAt:null,status:'reserved',synthetic:provider.synthetic===true,calls:[],report:null,reason:null,authorizesDispatch:false};
  if(!reserveCall(search,at))return block('search_daily_budget');
  state.gapScout.searches.push(search);gap.status='researching';gap.reason=null;
  // No await before this durable reservation. Concurrent replays see it too.
  persist();
  const controller=new AbortController();controllers.add(controller);
  try{
   for(let attempt=0;attempt<2;attempt++){
    try{
     const rows=await provider.search(QUERY_BIAS[gap.driveId]+suffix,{limit:CAPS[gap.driveId],signal:controller.signal});
     if(closed||state.emergencyStop||controller.signal.aborted)throw Error('stopped');
     if(evidenceVerifier){
      const repos=new Set();
      for(const row of rows){
       if(repos.size>=CAPS[gap.driveId]||closed||state.emergencyStop||controller.signal.aborted)break;
       const repo=parseGithubRepo(row?.url);if(!repo||repos.has(repo))continue;repos.add(repo);
       await evidenceVerifier.verify(row.url,{signal:controller.signal});
      }
     }
     if(closed||state.emergencyStop||controller.signal.aborted)throw Error('stopped');
     const report=buildReport(gap,rows,{at:now(),synthetic:search.synthetic,evidenceRecords:state.repositoryEvidence?.records??[],evidenceRequired:!!evidenceVerifier});
     let inbox=state.absorbInbox;
     for(const url of report.recommendations){const draft=addAbsorbDraft(inbox,{kind:'research-draft',payload:{gapId,searchFingerprint:search.fingerprint,candidate:report.candidates.find(c=>c.url===url)},at:report.searchedAt,synthetic:report.synthetic});inbox=draft.inbox;}
     state.absorbInbox=inbox;search.report=report;search.status='completed';search.finishedAt=now();search.calls.at(-1).status='settled';gap.status='completed';persist();return structuredClone(search);
    }catch(error){
     if(search.report!==null)throw error; // Persistence failure after completion is not a provider retry.
     if(closed)return structuredClone(search);
     if(error?.retryable===true&&attempt===0&&!state.emergencyStop&&!controller.signal.aborted){
      search.calls.at(-1).status='retryable';
      if(reserveCall(search,now())){persist();continue;}
     }
     search.status=error?.definite===true?'failed':'unknown';search.reason=state.emergencyStop||controller.signal.aborted?'stopped_outcome_unknown':search.status==='failed'?'search_rejected':'search_outcome_unknown';
     search.calls.at(-1).status=search.status==='failed'?'settled':'unknown';search.finishedAt=now();gap.status=search.status;gap.reason=search.reason;persist();return structuredClone(search);
    }
   }
  }finally{controllers.delete(controller);}
 }
 function stop(){for(const c of controllers)c.abort();}
 function close(){closed=true;stop();}
 function afterDecision(){
  if(closed||state.emergencyStop)return;
  const expired=expireStaleGaps(state,now()),created=detectGaps(state,now());if(expired||created.length)persist();
  // Event-driven only, not a timer or a second job scheduler.
  void (async()=>{for(const g of state.gapScout.gaps.filter(g=>g.status==='pending')){if(closed||state.emergencyStop)break;await researchGap(g.id,`gap-${g.id}`);}})().catch(()=>{ /* A failed durable save must not trigger another send. */ });
 }
 return {researchGap,afterDecision,stop,close,recovered};
}
