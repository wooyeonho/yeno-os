import {createHash} from 'node:crypto';
import {initialKirby,validateKirby} from './kirby-state.mjs';
import {recordNoAbility,validateAbsorbInbox} from './absorb-inbox.mjs';
import {importCapability,verifyCapability,disableCapability,validateCapabilities} from './capabilities.mjs';
import {executionsFromState,levelingHistoriesFromState} from './leveling-evidence.mjs';
export const STAR_FAILURE_LIMIT=3;
export function inhale(state,inboxId,manifest,at){
 validateKirby(state.kirby);validateAbsorbInbox(state.absorbInbox);
 const source=state.absorbInbox.entries.find(e=>e.id===inboxId);if(!source)throw Error('Absorption draft missing');
 const previous=state.kirby.absorptions.find(a=>a.inboxId===inboxId);if(previous)return {capabilities:state.capabilities,absorbInbox:state.absorbInbox,kirby:state.kirby,receipt:previous};
 if(source.status!=='draft')throw Error('Absorption draft is not pending');
 let imported,verified;
 try{
  if(!manifest)throw Error('executable_manifest_missing');
  if(source.kind==='local-document'){
   const artifact=state.artifacts[source.payload.artifactId];
   if(!artifact||artifact.sha256!==source.payload.artifactSha256||!state.jobs.some(j=>j.id===artifact.jobId&&j.status==='completed'&&j.artifacts?.some(a=>a.id===artifact.id)))throw Error('completed_source_artifact_missing');
  }
  if(source.kind==='ledger-tool'&&!(state.ledger.fingerprint===source.payload.ledgerFingerprint&&state.ledger.entries.some(e=>e.id===source.payload.ledgerId&&e.nature==='tool')))throw Error('ledger_tool_missing');
  if(source.kind==='self-beautification')throw Error('design_draft_not_executable_manifest');
  if(source.kind==='research-draft'&&(manifest.source?.url!==source.payload.candidate.url||manifest.source?.license!==source.payload.candidate.license))throw Error('source_provenance_mismatch');
  imported=importCapability(state.capabilities,manifest,{at});verified=verifyCapability(imported.registry,manifest.id,imported.result.hash,{at});
 }catch{
  // A failed fixture never pollutes the capability registry.
  return {capabilities:state.capabilities,kirby:state.kirby,absorbInbox:recordNoAbility(state.absorbInbox,inboxId,'executable_manifest_or_fixture_unavailable'),receipt:null};
 }
 const receipt={inboxId,capabilityId:manifest.id,hash:imported.result.hash,at};const kirby={...state.kirby,absorptions:[...state.kirby.absorptions,receipt]};validateKirby(kirby);
 return {capabilities:verified.registry,absorbInbox:state.absorbInbox,kirby,receipt};
}
export function copyAbilities(state){
 validateCapabilities(state.capabilities);validateKirby(state.kirby);
 return state.capabilities.entries.filter(e=>e.activeHash).map(e=>{
  const version=e.versions.find(v=>v.hash===e.activeHash),receipt=state.kirby.absorptions.find(a=>a.capabilityId===e.id&&a.hash===e.activeHash),source=receipt&&state.absorbInbox.entries.find(i=>i.id===receipt.inboxId);
  const sourceHash=source?.payload.evidenceSha256??source?.payload.artifactSha256??source?.payload.ledgerFingerprint??(source?createHash('sha256').update(JSON.stringify(source.payload)).digest('hex'):e.activeHash);
  return {id:e.id,version:version.manifest.version,hash:e.activeHash,name:version.manifest.name,sourceKind:source?.kind??'reviewed-manifest',sourceHash,hat:{glyph:['✦','◇','△','○'][parseInt(sourceHash.slice(0,2),16)%4],colorIndex:parseInt(sourceHash.slice(2,4),16)%7}};
 });
}
export function equipAbility(state,id){
 const ability=copyAbilities(state).find(a=>a.id===id);if(!ability)throw Error('Only an active verified capability can be equipped');
 const star=state.kirby.stars.filter(a=>a.capabilityId===id&&a.hash===ability.hash).at(-1);
 const version=state.capabilities.entries.find(e=>e.id===id).versions.find(v=>v.hash===ability.hash);
 if(star&&version.verifiedAt<=star.at)throw Error('Reverify and owner activate after star rejection');
 return {...state.kirby,currentAbilityId:id};
}
export function rejectFailedCopies(state){
 let registry=state.capabilities,kirby=structuredClone(state.kirby);validateKirby(kirby);
 const executions=executionsFromState(state,'capability');
 for(const entry of registry.entries.filter(e=>e.activeHash)){
  const failures=executions.filter(x=>x.skillId===entry.id&&state.jobs.find(j=>j.id===x.jobId)?.capabilityRequest?.hash===entry.activeHash).slice(-STAR_FAILURE_LIMIT);
  if(failures.length!==STAR_FAILURE_LIMIT||failures.some(x=>x.executionVerified))continue;
  const jobIds=failures.map(x=>x.jobId);if(kirby.stars.some(s=>s.capabilityId===entry.id&&s.jobIds.join()===jobIds.join()))continue;
  const at=failures.at(-1).at;registry=disableCapability(registry,entry.id,{at}).registry;
  kirby.stars.push({capabilityId:entry.id,hash:entry.activeHash,jobIds,at});if(kirby.currentAbilityId===entry.id)kirby.currentAbilityId=null;
 }
 if(kirby.currentAbilityId&&!registry.entries.some(e=>e.id===kirby.currentAbilityId&&e.activeHash))kirby.currentAbilityId=null;
 validateKirby(kirby);return {capabilities:registry,kirby};
}
export function linkAbilityToShadowRole(state,abilityId,role,at){
 if(!copyAbilities(state).some(a=>a.id===abilityId)||!['scout','researcher','builder','verifier'].includes(role))throw Error('Active ability and known role required');
 if(state.kirby.helpers.some(h=>h.capabilityId===abilityId&&h.role===role))return state.kirby;
 const kirby={...state.kirby,helpers:[...state.kirby.helpers,{capabilityId:abilityId,role,at}]};validateKirby(kirby);return kirby;
}
export function kirbyOverview(state){
 const abilities=copyAbilities(state),active=new Set(abilities.map(a=>a.id));
 const mixedAbilities=levelingHistoriesFromState(state,'capability').flatMap(h=>h.compositions.filter(c=>active.has(h.skillId)&&active.has(c.upstreamSkillId)).map(c=>({name:c.upstreamSkillId+' + '+h.skillId,evidenceRef:{runId:c.jobId,upstreamRunId:c.upstreamJobId},authorizesDispatch:false})));
 return {...state.kirby,currentAbilityId:active.has(state.kirby.currentAbilityId)?state.kirby.currentAbilityId:null,abilities,mixedAbilities,authorizesDispatch:false};
}
