import {DRIVE_IDS} from './seven-drives.mjs';
import {observedFeedback} from './motivation.mjs';
import {applyDriveEffects,HUNGER_RULES_V2} from './drive-state.mjs';
import {validateDriveAttempts,validateDriveOutcomes,DRIVE_OUTCOME_LIMIT} from './drive-outcome-state.mjs';
// Declared policy, not measured utility or quality.
export const HUNGER_RULES_V3=Object.freeze({frustration:6,cueUnit:5,cueLimit:2});
export function driveCues(state){const counts=Object.fromEntries(DRIVE_IDS.map(d=>[d,0]));for(const e of state.absorbInbox?.entries??[]){if(e.kind!=='research-draft'||e.status!=='draft'||state.kirby?.absorptions?.some(a=>a.inboxId===e.id))continue;const gap=state.gapScout?.gaps?.find(g=>g.id===e.payload.gapId);if(gap&&DRIVE_IDS.includes(gap.driveId))counts[gap.driveId]++;}return counts;}
export function driveFulfillment(state){return Object.fromEntries(DRIVE_IDS.map(d=>{const rows=(state.driveOutcomes??[]).filter(r=>r.drives.includes(d));let consecutive=0;for(const r of [...rows].reverse()){if(r.outcome!=='unfulfilled')break;consecutive++;}return [d,{attempts:(state.driveAttempts??[]).filter(a=>a.drives.includes(d)).length,fulfilled:rows.filter(r=>r.outcome==='fulfilled').length,unfulfilled:rows.filter(r=>r.outcome==='unfulfilled').length,unknown:rows.filter(r=>r.outcome==='unknown').length,lastOutcome:rows.at(-1)?.outcome??null,lastJobId:rows.at(-1)?.jobId??null,consecutiveUnfulfilled:consecutive,stuck:consecutive>=3}];}));}
export function trackDriveAttempt(state,{jobId,questId,kind,drives,at}){const rows=state.driveAttempts??[];if(!jobId||rows.some(r=>r.jobId===jobId))return rows;if(rows.length>=DRIVE_OUTCOME_LIMIT)throw new Error('drive_attempt_capacity');const next=[...rows,{jobId,questId,kind,drives:[...drives],at}];validateDriveAttempts(next);return next;}
export function settleDriveOutcomes(state,at){
 const attempts=state.driveAttempts??[],outcomes=state.driveOutcomes??[];validateDriveAttempts(attempts);validateDriveOutcomes(outcomes);let driveState=state.driveState;const rows=[...outcomes];let error=null;
 for(const a of attempts){if(rows.some(r=>r.jobId===a.jobId))continue;const job=state.jobs?.find(j=>j.id===a.jobId);if(!job||!['completed','failed','cancelled','paused'].includes(job.status))continue;
 const f=observedFeedback({...state,jobs:[{...job,autopilot:job.autopilot??{kind:a.kind}}]},{limit:1})[0];if(['pending','paused'].includes(f.outcome))continue;
 const verifiers=state.jobs.filter(j=>j.semanticVerifyRequest?.builderJobId===job.id);if(verifiers.some(j=>!j.semanticVerdict&&!['failed','cancelled'].includes(j.status)))continue;
 const verdicts=[job.semanticVerdict,...verifiers.map(j=>j.semanticVerdict)].filter(Boolean);const semanticFail=verdicts.some(v=>v.verdict!=='pass')||verifiers.some(j=>!j.semanticVerdict);const semanticPass=verdicts.length>0&&!semanticFail;
 const outcome=f.outcome==='unknown'?'unknown':f.outcome==='artifact_saved'&&f.criterionMet&&!semanticFail?'fulfilled':'unfulfilled';
 const verification=outcome==='unknown'?'none':semanticFail?'semantic_fail':semanticPass?'semantic_pass':outcome==='fulfilled'?'artifact_reference_only':'none';
 if(rows.length>=DRIVE_OUTCOME_LIMIT){error='drive_outcome_capacity';break;}
 const requested=Object.fromEntries(a.drives.map(d=>[d,outcome==='fulfilled'?HUNGER_RULES_V2[d].fed-Math.round(HUNGER_RULES_V2[d].fed/3):outcome==='unfulfilled'?HUNGER_RULES_V3.frustration:0]));
 const next=applyDriveEffects(driveState,requested,at);const effect=Object.fromEntries(a.drives.map(d=>[d,Math.round((next.hunger[d]-driveState.hunger[d])*100)/100]));driveState=next;
 rows.push({...a,outcome,verification,artifactCount:f.artifactCount,settledAt:at,effect,authorizesDispatch:false});delete rows.at(-1).at;
 }
 validateDriveOutcomes(rows);return {driveState,driveOutcomes:rows,settlementError:error};
}
export function outcomeSpeech(state,d){const f=driveFulfillment(state)[d],cue=driveCues(state)[d];return `${f.stuck?' · 막힘':''}${f.unfulfilled?' · 미충족 '+f.unfulfilled+'회':''}${f.unknown?' · 미확인 '+f.unknown+'회':''}${cue?' · 검토 대기 '+cue+'건':''}`;}
