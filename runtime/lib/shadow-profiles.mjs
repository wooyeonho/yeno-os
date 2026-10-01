import {initialShadowProfiles,validateShadowProfiles} from './shadow-profiles-state.mjs';

const RANKS=['E','D','C','B','A','S'];
const CONNECTOR={local:'ollama',openai:'openai',gemini:'gemini',nvidia:'nvidia',xai:'xai',anthropic:'anthropic',moonshot:'moonshot'};
const SCOPE={
  scout:{E:['project_sources'],D:['project_sources','project_read'],C:['project_sources','project_read','source_read_release']},
  researcher:{E:['project_read'],D:['project_read','project_sources'],C:['project_read','project_sources','source_read_release']},
  builder:{E:['project_read']},verifier:{E:[]},semanticVerifier:{E:[]},
};

// Declared access policy. A higher rank never receives code-writing, dispatch,
// Vault write, browser automation, or a credentialed tool through this table.
export function allowedShadowTools(role,rank='E'){
  if(!Object.hasOwn(SCOPE,role)||!RANKS.includes(rank))throw Error('Invalid shadow role or rank');
  const tier=RANKS.indexOf(rank)>=2?'C':rank==='D'?'D':'E';
  return [...(SCOPE[role][tier]??SCOPE[role].E)];
}

export function profileForShadow(state,shadowId,rank='E'){
  const member=state.shadowRoster.entries.find(entry=>entry.id===shadowId);
  if(!member)throw Error('Shadow not found');
  const saved=(state.shadowProfiles??initialShadowProfiles()).entries.find(row=>row.shadowId===shadowId);
  if(saved)return {...structuredClone(saved),toolScope:saved.toolScope.filter(name=>allowedShadowTools(member.role,rank).includes(name))};
  return {shadowId,modelBinding:null,toolScope:allowedShadowTools(member.role,rank),budgetShare:4};
}

export function setShadowProfile(state,input,connectors,{rank='E'}={}){
  validateShadowProfiles(state.shadowProfiles);
  const member=state.shadowRoster.entries.find(entry=>entry.id===input?.shadowId);
  if(!member||member.status==='stored'||state.shadowArise.storedIds.includes(member.id))throw Error('Active shadow required');
  const row={shadowId:input.shadowId,modelBinding:input.modelBinding,toolScope:input.toolScope,budgetShare:input.budgetShare};
  validateShadowProfiles({version:1,entries:[row]});
  const allowed=new Set(allowedShadowTools(member.role,rank));
  if(row.toolScope.some(name=>!allowed.has(name)))throw Error('Tool outside role or current rank');
  if(row.modelBinding!==null){
    const connector=connectors.find(item=>item.id===CONNECTOR[row.modelBinding]);
    if(connector?.kind!=='inference'||connector.status!=='connected')throw Error('Inference connector not connected');
  }
  const next={version:1,entries:[...state.shadowProfiles.entries.filter(item=>item.shadowId!==row.shadowId),row]};
  validateShadowProfiles(next);return next;
}
