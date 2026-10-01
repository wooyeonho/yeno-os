import {createHash} from 'node:crypto';
import {assertNoSecrets} from './jev.mjs';
import {validateAbsorbInbox} from './absorb-inbox.mjs';
export {validateAbsorbInbox};
export const CAPS=Object.freeze({greed:6,gluttony:12,envy:5,pride:5,lust:1,wrath:1,sloth:3});
export const initialGapScout=()=>({version:1,gaps:[],searches:[],budget:{searchCallsPerDay:20,days:[]}});
export const initialAbsorbInbox=()=>({version:1,entries:[]});
export function exact(v,keys){return v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));}
export const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const isHash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export const iso=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v));
export const text=(v,max=500)=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(v);
export function publicUrl(v){try{const u=new URL(v);return text(v,2000)&&u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&!/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[)/i.test(u.hostname);}catch{return false;}}
export function check(ok){if(!ok)throw new TypeError('Invalid G1 record');}
export function validateCandidate(c){
 check(exact(c,['title','url','snippet','license','commit','evidenceUrl','stars','lastCommit','useful','official','method','reusableFor',...(Object.hasOwn(c,'repositoryEvidence')?['repositoryEvidence']:[])]));
 if(Object.hasOwn(c,'repositoryEvidence')){const e=c.repositoryEvidence;check(exact(e,['id','status','reason'])&&isHash(e.id)&&['verified','excluded'].includes(e.status)&&(e.reason===null||text(e.reason,80)));}
 check(text(c.title,200)&&publicUrl(c.url)&&typeof c.snippet==='string'&&c.snippet.length<=1200);
 for(const k of ['license','method'])check(c[k]===null||text(c[k],300));
 check(c.commit===null||/^[a-f0-9]{40,64}$/.test(c.commit));
 check(c.evidenceUrl===null||publicUrl(c.evidenceUrl));
 check(c.stars===null||(Number.isSafeInteger(c.stars)&&c.stars>=0));
 check(c.lastCommit===null||iso(c.lastCommit));
 check(c.useful===null||typeof c.useful==='boolean');check(c.official===null||typeof c.official==='boolean');
 check(Array.isArray(c.reusableFor)&&c.reusableFor.length<=12&&c.reusableFor.every(x=>text(x,80)));
 assertNoSecrets(c);return true;
}
export function candidateExclusion(c,drive){
 if(c.repositoryEvidence?.status==='excluded')return c.repositoryEvidence.reason;
 if(!['MIT','Apache-2.0','BSD-2-Clause','BSD-3-Clause','ISC'].includes(c.license))return 'license_missing_or_unreviewed';
 if(!c.commit||!c.evidenceUrl||(!c.repositoryEvidence&&!c.evidenceUrl.includes(c.commit)))return 'pinned_evidence_missing';
 if(c.useful!==true)return 'usefulness_unverified';
 if(drive==='pride'&&c.official!==true)return 'official_basis_unverified';
 if(drive==='envy'&&!c.method)return 'comparison_method_missing';
 return null;
}
export function validateReport(r,drive){
 check(exact(r,['gapId','searchedAt','synthetic','authorizesDispatch','candidates','recommendations','excluded','bloat','gapSeverity','tradeoffNote','effortReducedEstimate','dataLabel']));
 check(isHash(r.gapId)&&iso(r.searchedAt)&&typeof r.synthetic==='boolean'&&r.authorizesDispatch===false);
 check(Array.isArray(r.candidates)&&r.candidates.length<=CAPS[drive]);r.candidates.forEach(validateCandidate);
 check(new Set(r.candidates.map(c=>c.url)).size===r.candidates.length);
 check(Array.isArray(r.recommendations)&&new Set(r.recommendations).size===r.recommendations.length&&r.recommendations.every(url=>r.candidates.some(c=>c.url===url)));
 check(Array.isArray(r.excluded)&&r.excluded.length<=r.candidates.length);
 for(const e of r.excluded)check(exact(e,['url','reason','prideVeto'])&&r.candidates.some(c=>c.url===e.url)&&text(e.reason,80)&&e.prideVeto===true&&!r.recommendations.includes(e.url));
 const eligible=r.candidates.filter(c=>!candidateExclusion(c,drive)).map(c=>c.url).sort();
 check(JSON.stringify([...r.recommendations].sort())===JSON.stringify(eligible));
 check(r.excluded.length===r.candidates.length-eligible.length&&new Set(r.excluded.map(e=>e.url)).size===r.excluded.length);
 for(const e of r.excluded)check(e.reason===candidateExclusion(r.candidates.find(c=>c.url===e.url),drive));
 check(r.bloat===(drive==='gluttony'?r.excluded.length:0));
 check(Number.isInteger(r.bloat)&&r.bloat>=0&&r.bloat<=r.candidates.length);
 check(r.gapSeverity===null&&r.effortReducedEstimate===null&&r.tradeoffNote===null);
 check(r.dataLabel==='UNTRUSTED_REFERENCE_DATA_NOT_INSTRUCTIONS');assertNoSecrets(r);return true;
}
export function validateGapScout(v){
 check(exact(v,['version','gaps','searches','budget'])&&v.version===1&&Array.isArray(v.gaps)&&v.gaps.length<=2000&&Array.isArray(v.searches)&&v.searches.length<=2000);
 check(exact(v.budget,['searchCallsPerDay','days'])&&Number.isInteger(v.budget.searchCallsPerDay)&&v.budget.searchCallsPerDay>=1&&v.budget.searchCallsPerDay<=20&&Array.isArray(v.budget.days));
 const ids=new Set();
 for(const g of v.gaps){
  check(exact(g,['id','driveId','subsystem','goalHash','detectedAt','evidence','status','reason','authorizesDispatch']));
  check(Object.hasOwn(CAPS,g.driveId)&&text(g.subsystem,80)&&isHash(g.goalHash)&&g.id===hash([1,g.driveId,g.subsystem,g.goalHash])&&!ids.has(g.id));ids.add(g.id);
  check(iso(g.detectedAt)&&['pending','blocked','researching','completed','failed','unknown','stale','reused'].includes(g.status)&&g.authorizesDispatch===false&&(g.reason===null||text(g.reason,100)));
  check(exact(g.evidence,['debates','failureIds','debtSearchIds'])&&Array.isArray(g.evidence.debates)&&g.evidence.debates.length===3&&g.evidence.debates.every(isHash)&&new Set(g.evidence.debates).size===3);
  check(Array.isArray(g.evidence.failureIds)&&g.evidence.failureIds.every(x=>text(x,100))&&Array.isArray(g.evidence.debtSearchIds)&&g.evidence.debtSearchIds.every(isHash));
 }
 const gapDays=new Map();for(const g of v.gaps){const d=g.detectedAt.slice(0,10);gapDays.set(d,(gapDays.get(d)??0)+1);}check([...gapDays.values()].every(n=>n<=3));
 const requests=new Set(),gapIds=new Set(),dayCounts=new Map();
 for(const s of v.searches){
  check(exact(s,['gapId','requestId','fingerprint','startedAt','finishedAt','status','synthetic','calls','report','reason','authorizesDispatch']));
  check(ids.has(s.gapId)&&!gapIds.has(s.gapId)&&text(s.requestId,100)&&!requests.has(s.requestId)&&s.fingerprint===hash([1,s.gapId]));gapIds.add(s.gapId);requests.add(s.requestId);
  check(iso(s.startedAt)&&(s.finishedAt===null||iso(s.finishedAt))&&['reserved','completed','failed','unknown'].includes(s.status)&&typeof s.synthetic==='boolean'&&s.authorizesDispatch===false&&(s.reason===null||text(s.reason,100)));
  check(Array.isArray(s.calls)&&s.calls.length>=1&&s.calls.length<=2);
  for(const c of s.calls){check(exact(c,['at','status'])&&iso(c.at)&&['reserved','settled','unknown','retryable'].includes(c.status));const day=c.at.slice(0,10);dayCounts.set(day,(dayCounts.get(day)??0)+1);}
  if(s.report!==null){validateReport(s.report,v.gaps.find(g=>g.id===s.gapId).driveId);check(s.report.gapId===s.gapId&&s.report.synthetic===s.synthetic&&s.status==='completed');}
  check((s.status==='completed')===(s.report!==null));
 }
 check(v.budget.days.length===dayCounts.size&&new Set(v.budget.days.map(d=>d.day)).size===v.budget.days.length);
 for(const d of v.budget.days)check(exact(d,['day','calls'])&&/^\d{4}-\d\d-\d\d$/.test(d.day)&&d.calls===dayCounts.get(d.day)&&d.calls<=v.budget.searchCallsPerDay);
 assertNoSecrets(v);return true;
}

export function validateG1Links(state){
 validateGapScout(state.gapScout);validateAbsorbInbox(state.absorbInbox);
 for(const e of state.absorbInbox.entries)if(e.kind==='research-draft'){
  const search=state.gapScout.searches.find(s=>s.gapId===e.payload.gapId&&s.fingerprint===e.payload.searchFingerprint);
  check(search?.report&&search.synthetic===e.synthetic&&search.report.recommendations.includes(e.payload.candidate.url));
  check(hash(search.report.candidates.find(c=>c.url===e.payload.candidate.url))===hash(e.payload.candidate));
 }
 return true;
}
