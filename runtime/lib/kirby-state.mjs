import {assertNoSecrets} from './jev.mjs';
const exact=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===k.slice().sort().join();
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),id=v=>typeof v==='string'&&/^[a-z][a-z0-9-]{1,63}$/.test(v),iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
export const initialKirby=()=>({version:1,currentAbilityId:null,absorptions:[],stars:[],helpers:[]});
export function validateKirby(k){
 if(!exact(k,['version','currentAbilityId','absorptions','stars','helpers'])||k.version!==1||!(k.currentAbilityId===null||id(k.currentAbilityId))||![k.absorptions,k.stars,k.helpers].every(a=>Array.isArray(a)&&a.length<=4000))throw Error('Invalid Kirby state');
 const seen=new Set();for(const a of k.absorptions){if(!exact(a,['inboxId','capabilityId','hash','at'])||!hash(a.inboxId)||!id(a.capabilityId)||!hash(a.hash)||!iso(a.at)||seen.has(a.inboxId))throw Error('Invalid absorption receipt');seen.add(a.inboxId);}
 for(const a of k.stars)if(!exact(a,['capabilityId','hash','jobIds','at'])||!id(a.capabilityId)||!hash(a.hash)||!iso(a.at)||!Array.isArray(a.jobIds)||a.jobIds.length!==3||new Set(a.jobIds).size!==3||a.jobIds.some(j=>typeof j!=='string'||!/^[a-f0-9-]{36}$/i.test(j)))throw Error('Invalid star evidence');
 for(const h of k.helpers)if(!exact(h,['capabilityId','role','at'])||!id(h.capabilityId)||!['scout','researcher','builder','verifier'].includes(h.role)||!iso(h.at))throw Error('Invalid helper link');
 assertNoSecrets(k);return true;
}
