import {createHash} from 'node:crypto';
import {addAbsorbDraft,validateAbsorbInbox} from './absorb-inbox.mjs';
import {recordBeautyGap} from './drive-state.mjs';
import {assertNoSecrets} from './jev.mjs';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export const BEAUTY_FINDING_THRESHOLD=0;
export function inspectOwnBeauty(_state,artifacts){
 const findings=[];
 for(const artifact of artifacts){
  if(!Buffer.isBuffer(artifact.bytes)||artifact.bytes.length>65536||digest(artifact.bytes)!==artifact.sha256)throw new Error('beauty_evidence_mismatch');
  const report=JSON.parse(artifact.bytes.toString('utf8'));assertNoSecrets(report);
  if(report.version!==1||report.surface!=='jarvis'||typeof report.synthetic!=='boolean'||!Array.isArray(report.measurements)||report.measurements.length>100)throw new Error('invalid_beauty_measurement');
  for(const m of report.measurements){
   if(typeof m.where!=='string'||!m.where.trim()||m.where.length>120||/[\x00-\x1f]/.test(m.where))throw new Error('invalid_beauty_location');
   let failed=false,evidence;
   if(m.kind==='horizontal-overflow'){
    if(!Number.isFinite(m.scrollWidth)||!Number.isFinite(m.clientWidth)||m.clientWidth<=0||m.scrollWidth<0)throw new Error('invalid_beauty_dimensions');
    failed=m.scrollWidth>m.clientWidth;evidence={scrollWidth:m.scrollWidth,clientWidth:m.clientWidth};
   }else if(m.kind==='contrast'){
    if(!Number.isFinite(m.ratio)||m.ratio<1||m.ratio>21||![3,4.5,7].includes(m.requiredRatio))throw new Error('invalid_beauty_contrast');
    failed=m.ratio<m.requiredRatio;evidence={ratio:m.ratio,requiredRatio:m.requiredRatio};
   }else if(m.kind==='diff-check'){
    if(!Number.isInteger(m.warningCount)||m.warningCount<0)throw new Error('invalid_beauty_warnings');
    failed=m.warningCount>0;evidence={warningCount:m.warningCount};
   }else throw new Error('unsupported_beauty_measurement');
   if(failed)findings.push({kind:m.kind,where:m.where,evidence:{...evidence,artifactId:artifact.id,sha256:artifact.sha256},synthetic:report.synthetic});
  }
 }
 // Count of measured violations, deliberately not a beauty score.
 return {findingCount:findings.length,findings,authorizesDispatch:false};
}
export function draftSelfBeautification(state,artifacts,at){
 validateAbsorbInbox(state.absorbInbox);
 const report=inspectOwnBeauty(state,artifacts);let inbox=state.absorbInbox;const added=[];
 for(const finding of report.findings){
  const payload={surface:'jarvis',evidenceSha256:finding.evidence.sha256,finding:`${finding.kind} @ ${finding.where}: ${JSON.stringify(finding.evidence)}`};
  const result=addAbsorbDraft(inbox,{kind:'self-beautification',payload,at,synthetic:finding.synthetic});
  if(result.inbox!==inbox)added.push(result.entry);inbox=result.inbox;
 }
 return {report,absorbInbox:inbox,driveState:added.length>BEAUTY_FINDING_THRESHOLD?recordBeautyGap(state.driveState,at):state.driveState,added,authorizesDispatch:false};
}
