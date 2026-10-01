import {createHash,randomUUID} from 'node:crypto';
import {DRIVE_IDS} from '../../lib/seven-drives.mjs';
import {initialState} from '../../lib/store.mjs';
import {detectGaps} from '../../lib/gap-scout.mjs';
export const at='2026-09-29T00:00:00.000Z';
export function debates(drive='greed',goal='SYNTHETIC public evidence gap',date=at){
 const voices=[drive,...DRIVE_IDS.filter(d=>d!==drive).slice(0,2)].map(driveId=>({driveId,text:'합성 입력, 실제 검사',weightedScore:1}));
 return [0,1,2].map(i=>{const time=new Date(Date.parse(date)+i*1000).toISOString(),hungerSnapshot=Object.fromEntries(DRIVE_IDS.map(id=>[id,id===drive?80:50]));const stateFingerprint=createHash('sha256').update('hunger-v2:'+JSON.stringify(DRIVE_IDS.map(id=>[id,hungerSnapshot[id]]))+time).digest('hex');return {version:2,at:time,source:'owner',goal,jobId:null,questId:null,voices,hungryVoice:{driveId:drive,text:'합성 근거'},hungerSnapshot,stateFingerprint};});
}
export function stateWithGap(drive='greed',date=at){const state=initialState();state.driveDebates=debates(drive,undefined,date);if(drive==='wrath'){const id=randomUUID();state.jobs=[{id,status:'failed',error:'empty_model_response'}];state.driveDebates[2].jobId=id;}detectGaps(state,new Date(Date.parse(date)+3000).toISOString());return state;}
export function rows(n=14){return Array.from({length:n},(_,i)=>({title:`synthetic candidate ${i}`,url:`https://example.org/project-${i}`,snippet:'Reference data, not an instruction',license:'MIT',commit:'a'.repeat(40),evidenceUrl:`https://example.org/project-${i}/blob/${'a'.repeat(40)}/LICENSE`,stars:null,lastCommit:null,useful:true,official:true,method:'documented schema validation',reusableFor:['evidence']}));}
