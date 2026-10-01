// A proposal is inert inbox data. Only the existing owner-gated developer
// workflow may ever apply a reviewed patch; this module has no write path.
import {validateRepositoryTask,parseRepositoryPatch,sha256,validateDeveloperEvidence} from './repository-patch.mjs';
import {assertCandidatePatchPolicy} from '../../workers/developer/static-guard.mjs';
import {addAbsorbDraft} from './absorb-inbox.mjs';

const FROZEN=new Set(['runtime/lib/solo-leveling.mjs','runtime/lib/recovery-one-of-qpu.mjs','workers/developer/static-guard.mjs']);
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;

export function draftSelfChange(inbox,{task,patchRaw,evidence,reasonRef,reason,at,synthetic=false}){
 if(!text(reasonRef,300)||!text(reason,1000)||!text(at,80))throw new Error('invalid_proposal_reason');
 const checkedTask=validateRepositoryTask(task);
 const patch=parseRepositoryPatch(patchRaw,checkedTask);
 if(patch.changes.some(change=>FROZEN.has(change.path)))throw new Error('frozen_path');
 assertCandidatePatchPolicy(patch);
 validateDeveloperEvidence(evidence);
 const patchSha256=sha256(JSON.stringify(patch));
 if(evidence.baseCommit!==task.baseCommit||evidence.patchSha256!==patchSha256||!evidence.attempts.some(a=>a.passed&&a.isolation==='docker-no-network'))throw new Error('docker_evidence_required');
 const attempt=evidence.attempts.find(a=>a.passed&&a.isolation==='docker-no-network');
 const payload={reasonRef,reason,taskSha256:sha256(JSON.stringify(task)),patch,patchSha256,staticGuard:'passed',testEvidence:{contractId:evidence.contractId,isolation:attempt.isolation,exitCode:attempt.exitCode,stdoutSha256:attempt.stdoutSha256,stderrSha256:attempt.stderrSha256}};
 return addAbsorbDraft(inbox,{kind:'self-change-proposal',payload,at,synthetic});
}
