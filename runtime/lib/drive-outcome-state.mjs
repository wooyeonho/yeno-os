import {DRIVE_IDS} from './seven-drives.mjs';
const exact=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===k.sort().join();
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(v);
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const drives=v=>Array.isArray(v)&&v.length>0&&v.length<=2&&new Set(v).size===v.length&&v.every(d=>DRIVE_IDS.includes(d));
export const DRIVE_OUTCOME_LIMIT=200;
export function validateDriveAttempts(rows){
 if(!Array.isArray(rows)||rows.length>DRIVE_OUTCOME_LIMIT)throw new TypeError('drive_attempt_capacity_or_schema');
 const ids=new Set();for(const r of rows){if(!exact(r,['jobId','questId','kind','drives','at'])||!uuid(r.jobId)||(r.questId!==null&&!uuid(r.questId))||!['owner','autopilot'].includes(r.kind)||!drives(r.drives)||!iso(r.at)||ids.has(r.jobId))throw new TypeError('invalid_drive_attempt');ids.add(r.jobId);}return true;
}
export function validateDriveOutcomes(rows){
 if(!Array.isArray(rows)||rows.length>DRIVE_OUTCOME_LIMIT)throw new TypeError('drive_outcome_capacity_or_schema');
 const ids=new Set();for(const r of rows){if(!exact(r,['jobId','questId','kind','drives','outcome','verification','artifactCount','settledAt','effect','authorizesDispatch'])||!uuid(r.jobId)||(r.questId!==null&&!uuid(r.questId))||!['owner','autopilot'].includes(r.kind)||!drives(r.drives)||!['fulfilled','unfulfilled','unknown'].includes(r.outcome)||!['semantic_pass','artifact_reference_only','semantic_fail','none'].includes(r.verification)||!Number.isSafeInteger(r.artifactCount)||r.artifactCount<0||!iso(r.settledAt)||!exact(r.effect,[...r.drives])||r.drives.some(d=>!Number.isFinite(r.effect[d])||Math.abs(r.effect[d])>100)||r.authorizesDispatch!==false||ids.has(r.jobId))throw new TypeError('invalid_drive_outcome');ids.add(r.jobId);}return true;
}
