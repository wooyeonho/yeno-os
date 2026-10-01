import {createHash} from 'node:crypto';
import {assertNoSecrets} from './jev.mjs';
const exact=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===k.slice().sort().join();
const uuid=v=>typeof v==='string'&&/^[0-9a-f-]{36}$/i.test(v),iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v)),hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export const SHADOW_BIRTH_POLICY_VERSION=2;
export const initialShadowArise=()=>({version:1,attempts:[],majorMarks:[],storedIds:[]});
export function validateShadowArise(value){
 if(!exact(value,['version','attempts','majorMarks','storedIds'])||value.version!==1||!Array.isArray(value.attempts)||value.attempts.length>15000||!Array.isArray(value.majorMarks)||value.majorMarks.length>5000)throw Error('Invalid shadow arise state');
 const ids=new Set(),counts=new Map();
 for(const a of value.attempts){if(!exact(a,['id','missionId','at','attempt','outcome','reason','artifactHash','worthyEvidence','authorizesDispatch'])||!hash(a.id)||ids.has(a.id)||!uuid(a.missionId)||!iso(a.at)||!Number.isInteger(a.attempt)||a.attempt<1||a.attempt>3||!['born','grown','routine','failed','capacity'].includes(a.outcome)||typeof a.reason!=='string'||a.reason.length>160||!(a.artifactHash===null||hash(a.artifactHash))||!Array.isArray(a.worthyEvidence)||a.worthyEvidence.some(e=>!exact(e,['kind','reference'])||!['previous_failed_mission','verifier_recovered','owner_mark'].includes(e.kind)||!uuid(e.reference))||a.authorizesDispatch!==false)throw Error('Invalid arise attempt');if(a.attempt!==(counts.get(a.missionId)??0)+1)throw Error('Invalid arise sequence');counts.set(a.missionId,a.attempt);ids.add(a.id);}
 const marked=new Set();for(const m of value.majorMarks){if(!exact(m,['missionId','at','requestId'])||!uuid(m.missionId)||!iso(m.at)||!uuid(m.requestId)||marked.has(m.missionId))throw Error('Invalid major mark');marked.add(m.missionId);}
 if(!Array.isArray(value.storedIds)||value.storedIds.length>5000||new Set(value.storedIds).size!==value.storedIds.length||value.storedIds.some(id=>!uuid(id)))throw Error('Invalid stored shadows');
 assertNoSecrets(value);return true;
}
export const ariseFingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
