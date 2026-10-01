import {createHash} from 'node:crypto';
import {missionStatus} from './shadow-army.mjs';
import {resolveVerifiedResult} from './blackhole-core.mjs';
import {levelingHistoriesFromState} from './leveling-evidence.mjs';
import {SHADOW_BIRTH_POLICY_VERSION,initialShadowArise,validateShadowArise,ariseFingerprint} from './shadow-arise-state.mjs';

export const SHADOW_ROSTER_VERSION=1;
export const EXTRACTABLE_ROLES=Object.freeze(['scout','researcher','builder','verifier']);
const LABEL=Object.freeze({scout:'정찰자',researcher:'연구자',builder:'건설자',verifier:'검증자'});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const HASH=/^[0-9a-f]{64}$/;
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const exact=(value,fields)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===fields.length&&fields.every(k=>Object.hasOwn(value,k));
const ENTRY_FIELDS=['id','name','role','skillId','bornFromMissionId','bornAt','missions','renamedBy','fingerprint'];
const ROSTER_FIELDS=['version','entries','fingerprint'];
const EXTRA_FIELDS=['birthPolicyVersion','status','bornFromArtifactHash'];
const entryBody=entry=>Object.fromEntries([...ENTRY_FIELDS.slice(0,-1),...(entry.birthPolicyVersion===2?EXTRA_FIELDS:[])].map(key=>[key,entry[key]]));
const rosterBody=roster=>({version:roster.version,entries:roster.entries});
const sealedEntry=body=>({...body,fingerprint:hash(body)});
const sealedRoster=entries=>({version:SHADOW_ROSTER_VERSION,entries,fingerprint:hash({version:SHADOW_ROSTER_VERSION,entries})});

export const initialShadowRoster=()=>sealedRoster([]);

export function validateShadowRoster(roster){
  if(!exact(roster,ROSTER_FIELDS)||roster.version!==SHADOW_ROSTER_VERSION||!Array.isArray(roster.entries)||roster.entries.length>5000||!HASH.test(roster.fingerprint))throw new Error('Invalid shadow roster');
  const ids=new Set();
  for(const entry of roster.entries){
    if(!(exact(entry,ENTRY_FIELDS)||(exact(entry,[...ENTRY_FIELDS,...EXTRA_FIELDS])&&entry.birthPolicyVersion===2&&['active','stored'].includes(entry.status)&&HASH.test(entry.bornFromArtifactHash)))||!UUID.test(entry.id)||ids.has(entry.id)||!EXTRACTABLE_ROLES.includes(entry.role)||entry.skillId!==`shadow:${entry.role}`||!UUID.test(entry.bornFromMissionId)||!ISO.test(entry.bornAt)||!Array.isArray(entry.missions)||!entry.missions.length||entry.missions.length>5000||entry.missions[0]!==entry.bornFromMissionId||new Set(entry.missions).size!==entry.missions.length||entry.missions.some(id=>!UUID.test(id))||!['owner',null].includes(entry.renamedBy)||typeof entry.name!=='string'||!entry.name.trim()||entry.name!==entry.name.normalize('NFC')||entry.name.length>24||/[\x00-\x1f\x7f-\x9f]/.test(entry.name)||entry.fingerprint!==hash(entryBody(entry)))throw new Error('Invalid shadow roster entry');
    ids.add(entry.id);
  }
  if(roster.fingerprint!==hash(rosterBody(roster)))throw new Error('Shadow roster fingerprint mismatch');
  return roster;
}

function deterministicId(missionId,role){
  const hex=createHash('sha256').update(`shadow-roster-v1:${missionId}:${role}`).digest('hex').slice(0,32).split('');
  hex[12]='4';hex[16]='8';
  return `${hex.slice(0,8).join('')}-${hex.slice(8,12).join('')}-${hex.slice(12,16).join('')}-${hex.slice(16,20).join('')}-${hex.slice(20).join('')}`;
}

export function verifiedMission(state,missionId){
  const mission=missionStatus(missionId,state);
  if(mission?.phase!=='completed'||mission.verify?.result?.verified!==true||mission.semantic?.verdict?.verdict!=='pass')return null;
  const semantic=state.jobs.find(job=>job.id===mission.semantic.jobId);
  if(!resolveVerifiedResult(semantic,state).ref)return null;
  const workers=EXTRACTABLE_ROLES.map(role=>state.jobs.find(job=>job.shadowAssignment?.missionId===missionId&&job.shadowAssignment.role===role));
  if(workers.some(job=>!job||job.status!=='completed'))return null;
  return {mission,workers};
}

// Shadow run records are derived from persisted jobs and verified artifacts.
// The roster stores identity, while Solo Leveling grades are rebuilt on read.
export function shadowRank(state,entry){
  if(!EXTRACTABLE_ROLES.includes(entry.role))throw new Error('Unknown shadow role');
  const evidenceState={...state,shadowRoster:state.shadowRoster??{entries:[entry]}};
  const history=levelingHistoriesFromState(evidenceState,'shadow').find(item=>item.skillId===`shadow-${entry.id}`);
  const next=['E','D','C','B','A','S'][['E','D','C','B','A','S'].indexOf(history?.grade??'E')+1];
  return {grade:history?.grade??'E',reason:next?history?.checks?.[next]?.reason??null:null,fingerprint:history?.fingerprint??null};
}

export function extractShadows(roster,state,missionId,at){
  validateShadowRoster(roster);
  if(!UUID.test(missionId)||!ISO.test(at))throw new Error('Invalid shadow extraction request');
  const passed=verifiedMission(state,missionId);
  if(!passed)return {roster,born:[],grown:[]};
  const worth=worthyVictory(state,missionId);
  const entries=roster.entries.map(entry=>({...entry,missions:[...entry.missions]}));
  const born=[],grown=[];
  for(const role of EXTRACTABLE_ROLES){
    const same=entries.filter(entry=>entry.role===role&&entry.status!=='stored'&&!state.shadowArise?.storedIds?.includes(entry.id));
    if(entries.some(entry=>entry.role===role&&entry.missions.includes(missionId)))continue;
    const target=same.slice().sort((a,b)=>a.missions.length-b.missions.length||a.bornAt.localeCompare(b.bornAt)||a.id.localeCompare(b.id))[0];
    if(target){
      const atIndex=entries.findIndex(entry=>entry.id===target.id);
      entries[atIndex]=sealedEntry({...entryBody(target),missions:[...target.missions,missionId]});
      grown.push(entries[atIndex]);
    }else{
      if(!worth.worthy||entries.length>=lordLevel(state).rosterCap)continue;
      const ordinal=entries.filter(e=>e.role===role).length+1;
      const entry=sealedEntry({id:deterministicId(missionId,role),name:shadowName(state,missionId,role,entries,ordinal),role,skillId:`shadow:${role}`,bornFromMissionId:missionId,bornAt:at,missions:[missionId],renamedBy:null,birthPolicyVersion:SHADOW_BIRTH_POLICY_VERSION,status:'active',bornFromArtifactHash:state.artifacts[passed.mission.semantic.verdict.artifactRefs[0]].sha256});
      entries.push(entry);born.push(entry);
    }
  }
  const next=sealedRoster(entries);validateShadowRoster(next);
  return {roster:next,born,grown};
}

export function renameShadow(roster,id,name,_at){
  validateShadowRoster(roster);
  if(!UUID.test(id)||typeof name!=='string')throw new Error('Invalid rename request');
  if(/[\x00-\x1f\x7f-\x9f]/.test(name))throw new Error('Invalid shadow name');
  const normalized=name.trim().normalize('NFC');
  if(!normalized||normalized.length>24||/[\x00-\x1f\x7f-\x9f]/.test(normalized))throw new Error('Invalid shadow name');
  let found=false;
  const entries=roster.entries.map(entry=>{
    if(entry.id!==id)return entry;
    found=true;return sealedEntry({...entryBody(entry),name:normalized,renamedBy:'owner'});
  });
  if(!found)throw new Error('Shadow not found');
  const next=sealedRoster(entries);validateShadowRoster(next);return next;
}

export function rosterOverview(roster,state={}){
  validateShadowRoster(roster);
  const members=roster.entries.map(entry=>{
    const rank=shadowRank(state,entry);
    return {id:entry.id,missionId:entry.missions.at(-1),status:state.shadowArise?.storedIds?.includes(entry.id)?'stored':entry.status??'active',name:entry.name,rank:rank.grade,rankTitle:rankTitle(rank.grade),rankReason:rank.reason};
  });
  const byRole=Object.fromEntries(EXTRACTABLE_ROLES.map(role=>[role,roster.entries.filter(entry=>entry.role===role).length]));
  const byRank=Object.fromEntries(['E','D','C','B','A','S'].map(rank=>[rank,members.filter(member=>member.rank===rank).length]));
  return {total:roster.entries.length,byRank,byRole,newestBorn:roster.entries.at(-1)?.name??null,members};
}
const goalOf=(state,id)=>state.jobs.find(j=>j.shadowAssignment?.missionId===id)?.shadowAssignment?.goal?.normalize('NFC').trim();
export function worthyVictory(state,missionId){
 const current=state.jobs.filter(j=>j.shadowAssignment?.missionId===missionId),goal=goalOf(state,missionId),evidence=[];
 const createdAt=current[0]?.createdAt;
 if(goal&&createdAt){
  const prior=[...new Set(state.jobs.filter(j=>j.shadowAssignment&&j.shadowAssignment.missionId!==missionId&&j.createdAt<createdAt&&j.projectId===current[0]?.projectId&&goalOf(state,j.shadowAssignment.missionId)===goal).map(j=>j.shadowAssignment.missionId))];
  const firstSuccess=!prior.some(id=>verifiedMission(state,id));
  const failed=prior.find(id=>state.jobs.some(j=>j.shadowAssignment?.missionId===id&&j.status==='failed'));
  if(firstSuccess&&failed)evidence.push({kind:'previous_failed_mission',reference:failed});
 }
 const failedAttempt=state.shadowArise?.attempts.find(a=>a.missionId===missionId&&a.reason==='deterministic_verification_failed');
 if(failedAttempt&&verifiedMission(state,missionId))evidence.push({kind:'verifier_recovered',reference:missionId});
 if(state.shadowArise?.majorMarks.some(m=>m.missionId===missionId))evidence.push({kind:'owner_mark',reference:missionId});
 return {worthy:evidence.length>0,evidence,authorizesDispatch:false};
}
export function lordLevel(state){
 const missions=[...new Set((state.jobs??[]).map(j=>j.shadowAssignment?.missionId).filter(Boolean))];
 const verifiedMissions=missions.filter(id=>verifiedMission(state,id)).length;
 const level=verifiedMissions?Math.floor(Math.log2(verifiedMissions))+1:0;
 return {policyVersion:1,verifiedMissions,level,rosterCap:4*level};
}
export const rankTitle=grade=>({E:'일반병',D:'정예병',C:'기사',B:'정예기사',A:'원수',S:'대원수'}[grade]??null);
function shadowName(state,missionId,role,entries,ordinal){
 const keyword=(goalOf(state,missionId)??'기록된 목표').replace(/[\x00-\x1f\x7f-\x9f]/g,'').slice(0,12);
 const base=keyword+'의 '+LABEL[role];return entries.some(e=>e.name===base)?base.slice(0,19)+' '+ordinal:base.slice(0,24);
}
export function setShadowStored(roster,id,stored){
 validateShadowRoster(roster);if(typeof stored!=='boolean')throw Error('Invalid storage action');
 const target=roster.entries.find(e=>e.id===id);if(!target)throw Error('Shadow not found');
 if(target.birthPolicyVersion!==2)return roster;
 return sealedRoster(roster.entries.map(e=>e.id===id?sealedEntry({...entryBody(e),status:stored?'stored':'active'}):e));
}
export function attemptArise(state,missionId,at){
 const arise=state.shadowArise??initialShadowArise();validateShadowArise(arise);
 if(!state.jobs.some(j=>j.shadowAssignment?.missionId===missionId))throw Error('Unknown mission');
 const prior=arise.attempts.filter(a=>a.missionId===missionId);
 if(prior.length>=3||prior.some(a=>['born','grown','capacity'].includes(a.outcome))||(prior.some(a=>a.outcome==='routine')&&!worthyVictory(state,missionId).worthy))return {roster:state.shadowRoster,shadowArise:arise,born:[],grown:[],reason:'already_settled'};
 const mission=missionStatus(missionId,state),worth=worthyVictory(state,missionId);
 const result=extractShadows(state.shadowRoster,state,missionId,at);
 const passed=verifiedMission(state,missionId);
 const artifactHash=passed?state.artifacts[passed.mission.semantic.verdict.artifactRefs[0]].sha256:null;
 const reason=!passed?(mission?.verify?.result?.verified===false?'deterministic_verification_failed':mission?.semantic?.verdict?.verdict==='uncertain'?'semantic_uncertain':'verified_result_unavailable'):result.born.length?'worthy_victory':result.grown.length?'existing_shadow_growth':worth.worthy?'roster_capacity':'routine_victory';
 const outcome=!passed?'failed':result.born.length?'born':result.grown.length?'grown':worth.worthy?'capacity':'routine';
 const attempt=prior.length+1,entry={id:ariseFingerprint([missionId,attempt]),missionId,at,attempt,outcome,reason,artifactHash,worthyEvidence:worth.evidence,authorizesDispatch:false};
 const shadowArise={...arise,attempts:[...arise.attempts,entry]};validateShadowArise(shadowArise);return {...result,shadowArise,attempt:entry};
}
