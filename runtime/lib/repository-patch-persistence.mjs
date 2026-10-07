import {RepositoryPatchError,validateJobEvidence,validateRepositoryJob} from './repository-patch.mjs';
import {validateDeveloperEvidenceBinding} from './repository-worker-evidence.mjs';
import {validateDeveloperOrder} from './repository-developer-order.mjs';

// Integration invariant: developer evidence is meaningful only as an extension
// of the repository task whose base commit and patch it describes. Keep this
// association rule outside the byte-identical upstream contract.
export function validatePersistedRepositoryJob(job) {
  if((job.developerEvidence!==undefined||job.developerEvidenceBinding!==undefined||job.developerOrder!==undefined)&&job.repositoryTask===undefined)throw new RepositoryPatchError('evidence_without_repository_task');
  validateRepositoryJob(job);
  validateJobEvidence(job);
  validateDeveloperEvidenceBinding(job);
  if(job.developerRequestId!==undefined&&(typeof job.developerRequestId!=='string'||!job.developerRequestId.trim()||job.developerRequestId.length>160))throw new RepositoryPatchError('invalid_developer_identity');
  if(job.developerAgent!==undefined&&(!job.developerAgent||typeof job.developerAgent!=='object'||Array.isArray(job.developerAgent)||Object.keys(job.developerAgent).sort().join()!==['schema','id','kind','attributes'].sort().join()||job.developerAgent.schema!==1||typeof job.developerAgent.id!=='string'||!job.developerAgent.id.trim()||job.developerAgent.id.length>80||typeof job.developerAgent.kind!=='string'||!job.developerAgent.kind.trim()||job.developerAgent.kind.length>80||!job.developerAgent.attributes||typeof job.developerAgent.attributes!=='object'||Array.isArray(job.developerAgent.attributes)||Buffer.byteLength(JSON.stringify(job.developerAgent.attributes))>2048))throw new RepositoryPatchError('invalid_developer_identity');
  if((job.developerRequestId===undefined)!==(job.developerAgent===undefined))throw new RepositoryPatchError('invalid_developer_identity');
  if(job.developerOrder!==undefined)validateDeveloperOrder(job,job.developerOrder);
  return true;
}

export function validateRepositoryDeveloperOrders(state){
  if(!state||typeof state!=='object'||!state.artifacts||typeof state.artifacts!=='object'||Array.isArray(state.artifacts))throw new RepositoryPatchError('invalid_developer_order');
  for(const job of state.jobs??[]){if(job.developerOrder!==undefined)validateDeveloperOrder(job,job.developerOrder,state.artifacts[job.developerOrder.artifactId]);}
  return true;
}

export function validateRepositoryEvidenceArtifacts(state){
  if(!state||typeof state!=='object'||!state.artifacts||typeof state.artifacts!=='object'||Array.isArray(state.artifacts))throw new RepositoryPatchError('invalid_evidence_artifact');
  for(const job of state.jobs??[]){
    if(job.developerEvidenceBinding===undefined)continue;
    validatePersistedRepositoryJob(job);
    const binding=job.developerEvidenceBinding,artifact=state.artifacts[binding.artifactId],reference=job.artifacts[0],expectedName=`repository-patch-${job.id.slice(0,8)}.json`;
    if(!artifact||artifact.id!==binding.artifactId||artifact.jobId!==job.id||artifact.name!==expectedName||artifact.mimeType!=='application/json'||reference?.id!==artifact.id||reference?.name!==artifact.name||artifact.sha256!==binding.patchSha256||artifact.sha256!==job.developerEvidence.patchSha256)throw new RepositoryPatchError('evidence_artifact_conflict');
    if(job.developerOrder&&(job.developerOrder.status!=='evidence-received'||job.developerOrder.workerDeviceId!==binding.workerDeviceId||job.developerOrder.artifactId!==binding.artifactId||job.developerOrder.patchSha256!==binding.patchSha256||job.developerOrder.requestId!==job.developerRequestId||JSON.stringify(job.developerOrder.agent)!==JSON.stringify(job.developerAgent)))throw new RepositoryPatchError('evidence_order_conflict');
  }
  return true;
}
