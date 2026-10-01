import {createHash} from 'node:crypto';
import {validateRecoveryOneOfCircuit} from './recovery-one-of-qpu.mjs';
import {simulateRecoveryCircuit,sampleStatevector} from './quantum-statevector.mjs';
import {assertNoSecrets} from './jev.mjs';
export const quantumHash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const initialQuantumDecisions=()=>({version:1,entries:[]});
export const entropy=probabilities=>probabilities.reduce((h,p)=>p>0?h-p*Math.log2(p):h,0);
export const sealQuantum=body=>({...body,fingerprint:quantumHash(body)});
const exact=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===k.slice().sort().join(),iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
export function quantumSample(entry){
 const seed=parseInt(entry.id.slice(0,8),16)||1,bitstring=sampleStatevector(entry.simulation,1,seed)[0].bitstring;
 const validOneHot=bitstring.split('1').length===2,probability=entry.simulation.probabilities[parseInt(bitstring,2)];
 // quantum-circuit uses qubit 0 as the leftmost index bit. This is a local
 // simulator observation, never the frozen decoder's qpu_counts label.
 const outcome=validOneHot?entry.circuit.variableOrder[bitstring.indexOf('1')]:entry.circuit.classicalFallbackAlternativeId;
 return {outcome,sample:{seed,bitstring,probability,validOneHot,lowProbabilitySample:probability<1/entry.simulation.probabilities.length,source:'local-statevector'}};
}
export function validateQuantumDecisions(state){
 if(!exact(state,['version','entries'])||state.version!==1||!Array.isArray(state.entries)||state.entries.length>128)throw Error('Invalid quantum decisions');
 const ids=new Set();for(const e of state.entries){
  const base=['id','createdAt','expiresAt','synthetic','context','circuit','simulation','uncertainty','status','authorizesDispatch','fingerprint'];
  const terminal=e.status==='measured'?['measuredAt','outcome','sample','ownerTriggeredSampling']:e.status==='expired'?['expiredAt','classicalFallback']:[];
  if(!exact(e,[...base,...terminal])||!['pending','measured','expired'].includes(e.status)||!iso(e.createdAt)||!iso(e.expiresAt)||Date.parse(e.expiresAt)<=Date.parse(e.createdAt)||typeof e.synthetic!=='boolean'||e.authorizesDispatch!==false||ids.has(e.id))throw Error('Invalid quantum record');
  const {fingerprint,...body}=e;if(fingerprint!==quantumHash(body)||e.id!==quantumHash([e.context.decision.fingerprint,e.context.result.fingerprint,e.synthetic]))throw Error('Quantum fingerprint mismatch');
  validateRecoveryOneOfCircuit(e.circuit,e.context);const simulation=simulateRecoveryCircuit(e.circuit);
  if(JSON.stringify(simulation)!==JSON.stringify(e.simulation)||e.uncertainty!==entropy(simulation.probabilities))throw Error('Quantum distribution mismatch');
  if(e.status==='measured'){const expected=quantumSample(e);if(!iso(e.measuredAt)||Date.parse(e.measuredAt)<Date.parse(e.createdAt)||Date.parse(e.measuredAt)>=Date.parse(e.expiresAt)||e.ownerTriggeredSampling!==true||e.outcome!==expected.outcome||JSON.stringify(e.sample)!==JSON.stringify(expected.sample))throw Error('Quantum sample mismatch');}
  if(e.status==='expired'&&(!iso(e.expiredAt)||Date.parse(e.expiredAt)<Date.parse(e.expiresAt)||e.classicalFallback!==e.circuit.classicalFallbackAlternativeId))throw Error('Quantum expiration mismatch');
  ids.add(e.id);assertNoSecrets(e);
 }
 return true;
}
