import {buildRecoveryOneOfCircuit} from './recovery-one-of-qpu.mjs';
import {simulateRecoveryCircuit} from './quantum-statevector.mjs';
import {quantumHash,sealQuantum,entropy,quantumSample,validateQuantumDecisions} from './quantum-decision-state.mjs';
export function recordQuantumDecision(state,context,{at,synthetic=false,lifetimeMs=300000}={}){
 validateQuantumDecisions(state);
 if(!Number.isInteger(lifetimeMs)||lifetimeMs<1||lifetimeMs>300000||!Number.isFinite(Date.parse(at)))throw Error('Invalid quantum lifetime');
 const id=quantumHash([context.decision.fingerprint,context.result.fingerprint,synthetic]);
 const old=state.entries.find(e=>e.id===id);if(old)return {state,entry:old};
 const circuit=buildRecoveryOneOfCircuit(context),simulation=simulateRecoveryCircuit(circuit);
 const entry=sealQuantum({id,createdAt:at,expiresAt:new Date(Date.parse(at)+lifetimeMs).toISOString(),synthetic,context:structuredClone(context),circuit,simulation,uncertainty:entropy(simulation.probabilities),status:'pending',authorizesDispatch:false});
 const next={version:1,entries:[...state.entries,entry]};validateQuantumDecisions(next);return {state:next,entry};
}
export function measureQuantumDecision(state,id,at){
 validateQuantumDecisions(state);const old=state.entries.find(e=>e.id===id);
 if(!old||old.status!=='pending')throw Error('quantum_single_commit');
 if(!Number.isFinite(Date.parse(at))||Date.parse(at)>=Date.parse(old.expiresAt))throw Error('quantum_expired');
 const {fingerprint,...body}=old,entry=sealQuantum({...body,status:'measured',measuredAt:at,...quantumSample(old),ownerTriggeredSampling:true});
 const next={version:1,entries:state.entries.map(e=>e.id===id?entry:e)};validateQuantumDecisions(next);return {state:next,entry};
}
export function expireQuantumDecisions(state,at){
 validateQuantumDecisions(state);if(!Number.isFinite(Date.parse(at)))throw Error('Invalid quantum clock');
 let changed=false;const entries=state.entries.map(e=>{
  if(e.status!=='pending'||Date.parse(at)<Date.parse(e.expiresAt))return e;
  changed=true;const {fingerprint,...body}=e;return sealQuantum({...body,status:'expired',expiredAt:at,classicalFallback:e.circuit.classicalFallbackAlternativeId});
 });const next=changed?{version:1,entries}:state;validateQuantumDecisions(next);return next;
}
export function quantumOverview(state){return state.entries.map(e=>({id:e.id,status:e.status,synthetic:e.synthetic,candidates:e.circuit.variableOrder,probabilities:e.simulation.probabilities,uncertainty:e.uncertainty,createdAt:e.createdAt,expiresAt:e.expiresAt,...(e.status==='measured'?{outcome:e.outcome,sample:e.sample,measuredAt:e.measuredAt}:e.status==='expired'?{classicalFallback:e.classicalFallback,expiredAt:e.expiredAt}:{}),authorizesDispatch:false}));}
